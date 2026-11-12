"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");

function extrairParametrosDigest(valor) {
    const texto = String(valor || "").replace(/^Digest\s+/i, "");
    const parametros = {};
    const regex = /([a-zA-Z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let correspondencia;
    while ((correspondencia = regex.exec(texto)) !== null) {
        parametros[correspondencia[1].toLowerCase()] = correspondencia[2]
            .trim().replace(/^"|"$/g, "").replace(/\\(["\\])/g, "$1");
    }
    return parametros;
}

function md5(valor) {
    return crypto.createHash("md5").update(valor, "utf8").digest("hex");
}

function criarCabecalhoDigest({ usuario, senha, desafio, metodo, uri, nonceCount = "00000001" }) {
    const realm = desafio.realm;
    const nonce = desafio.nonce;
    const algoritmo = String(desafio.algorithm || "MD5").toUpperCase();
    const qops = String(desafio.qop || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    const qop = qops.includes("auth") ? "auth" : "";
    if (!realm || !nonce) throw new Error("Desafio Digest do equipamento incompleto.");
    if (!(algoPermitido(algoritmo))) throw new Error(`Algoritmo Digest não suportado: ${algoritmo}.`);
    if (desafio.qop && !qop) throw new Error("O equipamento não ofereceu qop=auth para autenticação Digest.");

    const cnonce = crypto.randomBytes(16).toString("hex");
    let ha1 = md5(`${usuario}:${realm}:${senha}`);
    if (algoritmo === "MD5-SESS") ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
    const ha2 = md5(`${metodo}:${uri}`);
    const resposta = qop
        ? md5(`${ha1}:${nonce}:${nonceCount}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${nonce}:${ha2}`);

    const campos = [
        `username="${usuario.replace(/(["\\])/g, "\\$1")}"`,
        `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`,
        `response="${resposta}"`, `algorithm=${algoritmo}`
    ];
    if (desafio.opaque) campos.push(`opaque="${desafio.opaque}"`);
    if (qop) campos.push(`qop=${qop}`, `nc=${nonceCount}`, `cnonce="${cnonce}"`);
    return `Digest ${campos.join(", ")}`;
}

function algoPermitido(valor) {
    return ["MD5", "MD5-SESS"].includes(valor);
}

function obterConfiguracaoDispositivo() {
    const base = String(process.env.INTELBRAS_DEVICE_URL || "").trim();
    const usuario = String(process.env.INTELBRAS_DEVICE_USER || "").trim();
    const senha = String(process.env.INTELBRAS_DEVICE_PASSWORD || "");
    if (!base || !usuario || !senha) return null;
    let url;
    try { url = new URL(base); } catch { return null; }
    if (url.protocol !== "https:") return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), usuario, senha };
}

function solicitarHttps(url, opcoes = {}) {
    return new Promise((resolve, reject) => {
        const timeoutMs = Math.max(3000, Math.min(Number(process.env.INTELBRAS_TIMEOUT_MS) || 12000, 30000));
        const tlsOptions = {};
        const caPath = String(process.env.INTELBRAS_CA_PATH || "").trim();
        if (caPath) tlsOptions.ca = fs.readFileSync(caPath);

        const req = https.request(url, {
            method: opcoes.method || "GET",
            headers: opcoes.headers || {},
            timeout: timeoutMs,
            rejectUnauthorized: true,
            ...tlsOptions
        }, resposta => {
            const partes = [];
            resposta.on("data", parte => partes.push(Buffer.from(parte)));
            resposta.on("end", () => resolve({
                statusCode: resposta.statusCode || 0,
                headers: resposta.headers,
                body: Buffer.concat(partes).toString("utf8")
            }));
        });
        req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao comunicar com a Intelbras.")));
        req.on("error", reject);
        if (opcoes.body !== undefined) req.write(opcoes.body);
        req.end();
    });
}

async function requisitarDigest(caminho, opcoes = {}) {
    const config = obterConfiguracaoDispositivo();
    if (!config) {
        throw new Error("Configure INTELBRAS_DEVICE_URL em HTTPS, INTELBRAS_DEVICE_USER e INTELBRAS_DEVICE_PASSWORD no .env.");
    }
    const url = new URL(caminho, `${config.baseUrl}/`);
    if (url.origin !== new URL(config.baseUrl).origin || !url.pathname.startsWith("/cgi-bin/")) {
        throw new Error("Destino CGI inválido.");
    }

    const metodo = String(opcoes.method || "GET").toUpperCase();
    const headersBase = { Accept: "application/json, text/plain, */*", ...(opcoes.headers || {}) };
    const primeira = await solicitarHttps(url, { method: metodo, headers: headersBase, body: opcoes.body });
    if (primeira.statusCode !== 401) {
        if (primeira.statusCode < 200 || primeira.statusCode >= 300) {
            throw new Error(`Equipamento respondeu HTTP ${primeira.statusCode}: ${primeira.body.slice(0, 240)}`);
        }
        return primeira.body;
    }

    const desafioHeader = primeira.headers["www-authenticate"] || "";
    if (!/^Digest\s/i.test(String(desafioHeader))) throw new Error("O equipamento não ofereceu autenticação Digest.");
    const desafio = extrairParametrosDigest(desafioHeader);
    const uri = `${url.pathname}${url.search}`;
    const authorization = criarCabecalhoDigest({ usuario: config.usuario, senha: config.senha, desafio, metodo, uri });
    const segunda = await solicitarHttps(url, {
        method: metodo,
        headers: { ...headersBase, Authorization: authorization },
        body: opcoes.body
    });
    if (segunda.statusCode < 200 || segunda.statusCode >= 300) {
        throw new Error(`Equipamento recusou a operação (HTTP ${segunda.statusCode}): ${segunda.body.slice(0, 240)}`);
    }
    return segunda.body;
}

async function testarConexaoIntelbras() {
    const resposta = await requisitarDigest("/cgi-bin/magicBox.cgi?action=getSystemInfo");
    return { conectado: true, resposta: resposta.slice(0, 1200) };
}

async function enviarFotoFacial({ userId, nome, fotoBase64, operacao = "add" }) {
    if (!["add", "update"].includes(operacao)) throw new Error("Operação facial inválida. Use add ou update.");
    const corpo = JSON.stringify({
        UserID: String(userId),
        Info: { UserName: String(nome || "").slice(0, 64), PhotoData: [fotoBase64] }
    });
    const resposta = await requisitarDigest(`/cgi-bin/FaceInfoManager.cgi?action=${operacao}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(corpo)) },
        body: corpo
    });
    const texto = String(resposta || "").trim();
    if (texto && !/^OK\b/i.test(texto) && !/^\{\s*\}\s*$/.test(texto)) {
        throw new Error(`A Intelbras não confirmou o cadastro facial: ${texto.slice(0, 240)}`);
    }
    return { sucesso: true, resposta: texto || "Resposta vazia do equipamento" };
}

function normalizarNovoUsuario({ userId, nome, situacao = "congelado", validadeInicio = "", validadeFim = "" }) {
    const id = String(userId ?? "").trim();
    const nomeNormalizado = String(nome ?? "").trim().replace(/\s+/g, " ");
    if (!/^\d{1,20}$/.test(id)) throw new Error("O ID Intelbras deve conter somente números e ter até 20 dígitos.");
    if (!nomeNormalizado || nomeNormalizado.length > 64) throw new Error("Informe o nome completo com até 64 caracteres.");
    if (!["congelado", "normal"].includes(situacao)) throw new Error("Situação do usuário inválida.");

    function validarData(valor, campo) {
        if (!valor) return "";
        const data = String(valor).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`${campo}: data inválida.`);
        const teste = new Date(`${data}T00:00:00.000Z`);
        if (Number.isNaN(teste.getTime()) || teste.toISOString().slice(0, 10) !== data) {
            throw new Error(`${campo}: data inválida.`);
        }
        return data;
    }

    const inicio = validarData(validadeInicio, "Validade inicial");
    const fim = validarData(validadeFim, "Validade final");
    if (inicio && fim && inicio > fim) throw new Error("A validade inicial não pode ser posterior à validade final.");

    return {
        userId: id,
        nome: nomeNormalizado,
        situacao,
        validadeInicio: inicio,
        validadeFim: fim
    };
}

function montarPayloadNovoUsuario(dados) {
    const usuario = normalizarNovoUsuario(dados);
    const registro = {
        UserID: usuario.userId,
        UserName: usuario.nome,
        UserType: 0, // Usuário geral, nunca administrador.
        UserStatus: usuario.situacao === "normal" ? 0 : 1, // congelado por padrão até liberação administrativa.
        Authority: 2 // Usuário comum no terminal; a conta admin do dashboard é separada.
    };
    if (usuario.validadeInicio) registro.ValidFrom = `${usuario.validadeInicio} 00:00:00`;
    if (usuario.validadeFim) registro.ValidTo = `${usuario.validadeFim} 23:59:59`;
    return { UserList: [registro] };
}

function interpretarRespostaBuscaUsuario(texto) {
    const bruto = String(texto ?? "").trim();
    if (!bruto) throw new Error("O terminal retornou uma resposta vazia ao consultar o ID. Nenhum cadastro foi enviado.");
    let dados;
    try { dados = JSON.parse(bruto); } catch { dados = null; }
    if (dados && typeof dados === "object") {
        const total = Number(dados.Total ?? dados.total ?? dados.TotalCount);
        const token = dados.Token ?? dados.token;
        if (Number.isFinite(total) && total >= 0) return { total, token: token ?? null };
    }
    const totalTexto = bruto.match(/(?:^|\r?\n)\s*(?:Total|total)\s*=\s*(\d+)/i);
    const tokenTexto = bruto.match(/(?:^|\r?\n)\s*(?:Token|token)\s*=\s*(\d+)/i);
    if (totalTexto) return { total: Number(totalTexto[1]), token: tokenTexto ? tokenTexto[1] : null };
    throw new Error("Não foi possível interpretar a resposta de consulta de usuários do terminal. Nenhum cadastro foi enviado.");
}

async function consultarUsuarioAcesso(userId) {
    const id = String(userId ?? "").trim();
    if (!/^\d{1,20}$/.test(id)) throw new Error("ID Intelbras inválido para consulta.");
    const consulta = new URLSearchParams({ "Condition.UserID": id });
    const resposta = await requisitarDigest(`/cgi-bin/AccessUser.cgi?action=startFind&${consulta.toString()}`);
    const busca = interpretarRespostaBuscaUsuario(resposta);
    if (busca.token !== null && busca.token !== undefined) {
        const token = encodeURIComponent(String(busca.token));
        await requisitarDigest(`/cgi-bin/AccessUser.cgi?action=stopFind&Token=${token}`).catch(() => {});
    }
    return { existe: busca.total > 0, total: busca.total };
}

async function criarUsuarioAcesso(dados) {
    const payload = montarPayloadNovoUsuario(dados);
    const corpo = JSON.stringify(payload);
    const resposta = await requisitarDigest("/cgi-bin/AccessUser.cgi?action=insertMulti", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(corpo)) },
        body: corpo
    });
    const texto = String(resposta || "").trim();
    if (!/^OK\b/i.test(texto)) {
        throw new Error(`O terminal não confirmou a criação do usuário: ${texto.slice(0, 240) || "resposta vazia"}`);
    }
    return { sucesso: true, resposta: texto, usuario: payload.UserList[0] };
}

module.exports = {
    extrairParametrosDigest,
    criarCabecalhoDigest,
    obterConfiguracaoDispositivo,
    requisitarDigest,
    testarConexaoIntelbras,
    enviarFotoFacial,
    normalizarNovoUsuario,
    montarPayloadNovoUsuario,
    interpretarRespostaBuscaUsuario,
    consultarUsuarioAcesso,
    criarUsuarioAcesso
};
