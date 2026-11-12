"use strict";

const crypto = require("node:crypto");

const COOKIE_NAME = "controle_acesso_admin";
const DURACAO_SESSAO_MS = 2 * 60 * 60 * 1000;

function compararSeguros(a, b) {
    const bufferA = Buffer.from(String(a ?? ""), "utf8");
    const bufferB = Buffer.from(String(b ?? ""), "utf8");
    if (bufferA.length !== bufferB.length) return false;
    return crypto.timingSafeEqual(bufferA, bufferB);
}

function obterConfiguracaoAdmin() {
    return {
        usuario: String(process.env.BIOMETRIA_ADMIN_USER || ""),
        senha: String(process.env.BIOMETRIA_ADMIN_PASSWORD || ""),
        segredo: String(process.env.BIOMETRIA_SESSION_SECRET || "")
    };
}

function senhaAdminValida(senha) {
    // Permite PIN numérico de 4 dígitos ou senha tradicional com pelo menos 12 caracteres.
    return /^\d{4}$/.test(String(senha || "")) || String(senha || "").length >= 12;
}

function adminConfigurado() {
    const config = obterConfiguracaoAdmin();
    return Boolean(config.usuario && senhaAdminValida(config.senha) && config.segredo.length >= 32);
}

function enderecoLoopback(endereco) {
    const valor = String(endereco || "").toLowerCase().replace(/^::ffff:/, "");
    return valor === "127.0.0.1" || valor === "::1";
}

// Não confia em X-Forwarded-Proto enviado diretamente pelo cliente.
// Em proxy reverso, configure app.set('trust proxy', ...) para que req.secure seja confiável.
function requisicaoSegura(req) {
    return Boolean(req.secure || enderecoLoopback(req.socket?.remoteAddress));
}

function criarAssinatura(conteudo, segredo = obterConfiguracaoAdmin().segredo) {
    return crypto.createHmac("sha256", segredo).update(conteudo).digest("base64url");
}

function criarToken(usuario, agora = Date.now()) {
    const segredo = obterConfiguracaoAdmin().segredo;
    if (segredo.length < 32) throw new Error("BIOMETRIA_SESSION_SECRET deve ter pelo menos 32 caracteres.");
    const payload = Buffer.from(JSON.stringify({
        usuario,
        expiraEm: agora + DURACAO_SESSAO_MS,
        nonce: crypto.randomBytes(16).toString("hex")
    })).toString("base64url");
    return `${payload}.${criarAssinatura(payload, segredo)}`;
}

function obterCookie(req) {
    const cabecalho = String(req.headers?.cookie || "");
    const item = cabecalho.split(";").map(parte => parte.trim())
        .find(parte => parte.startsWith(`${COOKIE_NAME}=`));
    if (!item) return "";
    try { return decodeURIComponent(item.slice(COOKIE_NAME.length + 1)); } catch { return ""; }
}

function validarToken(token, agora = Date.now()) {
    if (!token || !adminConfigurado()) return null;
    const partes = token.split(".");
    if (partes.length !== 2) return null;
    const [payload, assinatura] = partes;
    if (!compararSeguros(assinatura, criarAssinatura(payload))) return null;
    try {
        const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!dados.usuario || !Number.isFinite(dados.expiraEm) || dados.expiraEm <= agora) return null;
        if (dados.usuario !== obterConfiguracaoAdmin().usuario) return null;
        return { usuario: dados.usuario, expiraEm: dados.expiraEm };
    } catch { return null; }
}

function obterSessao(req) {
    return validarToken(obterCookie(req));
}

function definirCookie(res, token, secure) {
    const partes = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`,
        "HttpOnly",
        "SameSite=Strict"
    ];
    if (secure) partes.push("Secure");
    res.setHeader("Set-Cookie", partes.join("; "));
}

function limparCookie(res, secure) {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
}

function validarOrigem(req) {
    const origem = req.get?.("origin");
    if (!origem) return true;
    try {
        return new URL(origem).host === req.get("host");
    } catch { return false; }
}

function middlewareCanalSeguro(req, res, next) {
    if (requisicaoSegura(req)) return next();
    return res.status(426).json({
        sucesso: false,
        codigo: "HTTPS_OBRIGATORIO",
        mensagem: "A área biométrica exige HTTPS. O acesso HTTP só é permitido no próprio computador do servidor (localhost)."
    });
}

function middlewareAdmin(req, res, next) {
    if (!adminConfigurado()) {
        return res.status(503).json({
            sucesso: false,
            codigo: "ADMIN_NAO_CONFIGURADO",
            mensagem: "Configure usuário, PIN de 4 dígitos ou senha de pelo menos 12 caracteres e segredo de sessão com pelo menos 32 caracteres no .env."
        });
    }
    const sessao = obterSessao(req);
    if (!sessao) {
        return res.status(401).json({ sucesso: false, codigo: "LOGIN_NECESSARIO", mensagem: "Autenticação administrativa necessária." });
    }
    req.usuarioAdmin = sessao.usuario;
    return next();
}

function autenticar(usuario, senha) {
    const config = obterConfiguracaoAdmin();
    if (!adminConfigurado()) return { sucesso: false, configurado: false };
    const valido = compararSeguros(usuario, config.usuario) && compararSeguros(senha, config.senha);
    return valido ? { sucesso: true, usuario: config.usuario } : { sucesso: false, configurado: true };
}

module.exports = {
    COOKIE_NAME,
    DURACAO_SESSAO_MS,
    adminConfigurado,
    senhaAdminValida,
    requisicaoSegura,
    definirCookie,
    limparCookie,
    criarToken,
    obterSessao,
    validarOrigem,
    middlewareCanalSeguro,
    middlewareAdmin,
    autenticar
};
