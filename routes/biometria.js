"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { obterBanco } = require("../services/db");
const {
    adminConfigurado,
    requisicaoSegura,
    definirCookie,
    limparCookie,
    criarToken,
    obterSessao,
    validarOrigem,
    middlewareCanalSeguro,
    middlewareAdmin,
    autenticar
} = require("../services/seguranca-biometria-service");
const { obterConfiguracaoDispositivo, testarConexaoIntelbras, enviarFotoFacial, normalizarNovoUsuario, consultarUsuarioAcesso, criarUsuarioAcesso } = require("../services/intelbras-device-service");
const { validarFotoFacialDataUrl } = require("../services/face-image-service");
const {
    listarOcorrencias,
    obterFotoOcorrencia,
    revisarOcorrencia
} = require("../services/ocorrencia-facial-service");

const router = express.Router();
const tentativasLogin = new Map();
const JANELA_LOGIN_MS = 15 * 60 * 1000;
// PIN curto exige um limite mais conservador de tentativas por endereço IP.
const MAX_TENTATIVAS_LOGIN = 5;

function obterIp(req) {
    return String(req.socket?.remoteAddress || "desconhecido").slice(0, 100);
}

function origemDaRequisicaoEstaCorreta(req) {
    const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
    if (fetchSite === "cross-site") return false;
    return validarOrigem(req);
}

function verificarOrigem(req, res) {
    if (origemDaRequisicaoEstaCorreta(req)) return true;
    res.status(403).json({ sucesso: false, mensagem: "Origem da solicitação não autorizada." });
    return false;
}

function verificarTentativas(ip) {
    const agora = Date.now();
    const atual = tentativasLogin.get(ip);
    if (!atual || agora - atual.inicio > JANELA_LOGIN_MS) {
        tentativasLogin.set(ip, { inicio: agora, quantidade: 0 });
        return { permitido: true, restante: MAX_TENTATIVAS_LOGIN };
    }
    if (atual.quantidade >= MAX_TENTATIVAS_LOGIN) {
        return { permitido: false, restante: 0, aguardarMs: JANELA_LOGIN_MS - (agora - atual.inicio) };
    }
    return { permitido: true, restante: MAX_TENTATIVAS_LOGIN - atual.quantidade };
}

async function gravarAuditoria({ usuarioAdmin, acao, userId = null, resultado, ip, detalhes = {}, hashFoto = null }) {
    const colecao = obterBanco().collection("auditoria_biometria");
    const documento = {
        usuarioAdmin: String(usuarioAdmin || "sistema"),
        acao,
        userId: userId === null ? null : String(userId),
        resultado,
        ipOrigem: String(ip || "desconhecido"),
        hashFoto,
        detalhes,
        createdAt: new Date()
    };
    const insercao = await colecao.insertOne(documento);
    return insercao.insertedId;
}

router.get("/sessao", (req, res) => {
    const sessao = obterSessao(req);
    return res.json({
        sucesso: true,
        canalSeguro: requisicaoSegura(req),
        httpsObrigatorio: true,
        administradorConfigurado: adminConfigurado(),
        autenticado: Boolean(sessao),
        usuario: sessao?.usuario || null,
        dispositivoConfigurado: Boolean(obterConfiguracaoDispositivo())
    });
});

router.post("/login", middlewareCanalSeguro, async (req, res) => {
    if (!verificarOrigem(req, res)) return;
    const ip = obterIp(req);
    const limite = verificarTentativas(ip);
    if (!limite.permitido) {
        return res.status(429).json({ sucesso: false, mensagem: "Muitas tentativas. Aguarde antes de tentar novamente." });
    }

    const usuario = String(req.body?.usuario || "").trim();
    const senha = String(req.body?.senha || "");
    const resultado = autenticar(usuario, senha);

    if (!resultado.sucesso) {
        const registro = tentativasLogin.get(ip) || { inicio: Date.now(), quantidade: 0 };
        registro.quantidade++;
        tentativasLogin.set(ip, registro);
        return res.status(resultado.configurado ? 401 : 503).json({
            sucesso: false,
            mensagem: resultado.configurado ? "Usuário ou senha incorretos." : "A autenticação administrativa ainda não foi configurada no servidor."
        });
    }

    tentativasLogin.delete(ip);
    await gravarAuditoria({ usuarioAdmin: resultado.usuario, acao: "login", resultado: "sucesso", ip });
    definirCookie(res, criarToken(resultado.usuario), req.secure);
    return res.json({ sucesso: true, usuario: resultado.usuario });
});

router.post("/logout", middlewareCanalSeguro, async (req, res) => {
    if (!verificarOrigem(req, res)) return;
    const sessao = obterSessao(req);
    if (sessao) {
        await gravarAuditoria({ usuarioAdmin: sessao.usuario, acao: "logout", resultado: "sucesso", ip: obterIp(req) }).catch(() => {});
    }
    limparCookie(res, req.secure);
    return res.json({ sucesso: true });
});

router.get("/dispositivo/teste", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    try {
        const teste = await testarConexaoIntelbras();
        await gravarAuditoria({ usuarioAdmin: req.usuarioAdmin, acao: "teste_conexao_terminal", resultado: "sucesso", ip: obterIp(req) });
        return res.json({ sucesso: true, conectado: true, resposta: teste.resposta });
    } catch (erro) {
        await gravarAuditoria({ usuarioAdmin: req.usuarioAdmin, acao: "teste_conexao_terminal", resultado: "falha", ip: obterIp(req), detalhes: { mensagem: erro.message.slice(0, 240) } }).catch(() => {});
        return res.status(502).json({ sucesso: false, mensagem: erro.message });
    }
});

router.post("/funcionarios/:userId/face", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    if (!verificarOrigem(req, res)) return;
    const userId = String(req.params.userId || "").trim();
    if (!userId || userId.length > 80) return res.status(400).json({ sucesso: false, mensagem: "ID Intelbras inválido." });
    if (req.body?.confirmacaoResponsavel !== true) {
        return res.status(400).json({ sucesso: false, mensagem: "Confirme que a rádio validou a base legal aplicável e informou a pessoa sobre o tratamento biométrico." });
    }

    let foto;
    try {
        foto = validarFotoFacialDataUrl(req.body?.fotoDataUrl);
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }

    const banco = obterBanco();
    const funcionario = await banco.collection("funcionarios").findOne({ userId });
    if (!funcionario) return res.status(404).json({ sucesso: false, mensagem: "Funcionário não encontrado na coleção funcionarios. Cadastre o usuário no terminal e sincronize o cadastro antes de enviar a face." });

    const operacao = String(req.body?.operacao || "add");
    if (! ["add", "update"].includes(operacao)) return res.status(400).json({ sucesso: false, mensagem: "Operação inválida." });

    // A auditoria da tentativa é gravada antes de transmitir a biometria.
    const hashFoto = crypto.createHash("sha256").update(foto.buffer).digest("hex");
    let auditoriaId;
    try {
        auditoriaId = await gravarAuditoria({
            usuarioAdmin: req.usuarioAdmin,
            acao: operacao === "add" ? "cadastro_facial_adicionar" : "cadastro_facial_atualizar",
            userId,
            resultado: "em_andamento",
            ip: obterIp(req),
            hashFoto,
            detalhes: {
                dispositivo: String(process.env.INTELBRAS_DEVICE_SERIAL || "não configurado"),
                tamanhoBytes: foto.bytes,
                largura: foto.largura,
                altura: foto.altura
            }
        });
    } catch (erro) {
        return res.status(503).json({ sucesso: false, mensagem: "Não foi possível registrar a auditoria. O cadastro facial não foi enviado." });
    }

    try {
        const resultado = await enviarFotoFacial({
            userId,
            nome: funcionario.nome || funcionario.CardName || userId,
            fotoBase64: foto.base64,
            operacao
        });
        await banco.collection("auditoria_biometria").updateOne(
            { _id: auditoriaId },
            { $set: { resultado: "sucesso", respostaDispositivo: String(resultado.resposta).slice(0, 240), concluidoAt: new Date() } }
        );
        return res.json({ sucesso: true, mensagem: "Fotografia enviada ao terminal Intelbras.", userId });
    } catch (erro) {
        await banco.collection("auditoria_biometria").updateOne(
            { _id: auditoriaId },
            { $set: { resultado: "falha", erro: erro.message.slice(0, 240), concluidoAt: new Date() } }
        ).catch(() => {});
        return res.status(502).json({ sucesso: false, mensagem: erro.message });
    }
});


router.post("/usuarios", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    if (!verificarOrigem(req, res)) return;
    if (req.body?.confirmacaoResponsavel !== true) {
        return res.status(400).json({ sucesso: false, mensagem: "Confirme que a pessoa foi informada e que a rádio validou a base legal aplicável ao tratamento biométrico." });
    }

    let dados;
    let foto;
    try {
        dados = normalizarNovoUsuario({
            userId: req.body?.userId,
            nome: req.body?.nome,
            situacao: req.body?.situacao || "congelado",
            validadeInicio: req.body?.validadeInicio || "",
            validadeFim: req.body?.validadeFim || ""
        });
        foto = validarFotoFacialDataUrl(req.body?.fotoDataUrl);
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }

    const banco = obterBanco();
    const funcionarios = banco.collection("funcionarios");
    const existenteLocal = await funcionarios.findOne({ userId: dados.userId });
    if (existenteLocal) {
        return res.status(409).json({ sucesso: false, mensagem: "Este ID já existe na base local. Abra a ficha do funcionário para atualizar o cadastro, ou escolha outro ID." });
    }

    // Consulta somente leitura no terminal para não sobrescrever um ID já utilizado.
    let existenteTerminal;
    try {
        existenteTerminal = await consultarUsuarioAcesso(dados.userId);
    } catch (erro) {
        await gravarAuditoria({
            usuarioAdmin: req.usuarioAdmin,
            acao: "novo_usuario_consulta_id",
            userId: dados.userId,
            resultado: "falha",
            ip: obterIp(req),
            detalhes: { mensagem: erro.message.slice(0, 240) }
        }).catch(() => {});
        return res.status(502).json({ sucesso: false, mensagem: `Não foi possível confirmar se o ID está livre no terminal. Nenhuma alteração foi feita. ${erro.message}` });
    }
    if (existenteTerminal.existe) {
        return res.status(409).json({ sucesso: false, mensagem: "Este ID já está cadastrado no terminal Intelbras. Atualize a lista de funcionários ou escolha outro ID." });
    }

    const hashFoto = crypto.createHash("sha256").update(foto.buffer).digest("hex");
    let auditoriaId;
    try {
        auditoriaId = await gravarAuditoria({
            usuarioAdmin: req.usuarioAdmin,
            acao: "novo_usuario_com_face",
            userId: dados.userId,
            resultado: "em_andamento",
            ip: obterIp(req),
            hashFoto,
            detalhes: {
                nome: dados.nome,
                permissaoDispositivo: "Usuário comum (Authority=2)",
                situacaoTerminal: dados.situacao,
                validadeInicio: dados.validadeInicio || null,
                validadeFim: dados.validadeFim || null,
                tamanhoFotoBytes: foto.bytes,
                larguraFoto: foto.largura,
                alturaFoto: foto.altura,
                dispositivo: String(process.env.INTELBRAS_DEVICE_SERIAL || "não configurado")
            }
        });
    } catch (erro) {
        return res.status(503).json({ sucesso: false, mensagem: "Não foi possível registrar a auditoria. O novo usuário não foi enviado ao terminal." });
    }

    let usuarioCriadoNoTerminal = false;
    try {
        await criarUsuarioAcesso(dados);
        usuarioCriadoNoTerminal = true;
    } catch (erro) {
        await banco.collection("auditoria_biometria").updateOne(
            { _id: auditoriaId },
            { $set: { resultado: "falha_criacao_usuario", erro: erro.message.slice(0, 240), concluidoAt: new Date() } }
        ).catch(() => {});
        return res.status(502).json({ sucesso: false, mensagem: `O terminal não confirmou a criação do usuário. A fotografia não foi enviada. ${erro.message}` });
    }

    let faceCadastrada = false;
    let erroFace = null;
    try {
        await enviarFotoFacial({
            userId: dados.userId,
            nome: dados.nome,
            fotoBase64: foto.base64,
            operacao: "add"
        });
        faceCadastrada = true;
    } catch (erro) {
        erroFace = erro.message;
    }

    const agora = new Date();
    const documentoFuncionario = {
        userId: dados.userId,
        nome: dados.nome,
        ativo: true,
        permissaoDispositivo: { codigo: 2, descricao: "Usuário comum" },
        validadeDispositivo: { inicio: dados.validadeInicio || null, fim: dados.validadeFim || null },
        origemCadastro: "dashboard",
        dispositivo: {
            modelo: "SS 3532 MF W",
            numeroSerie: String(process.env.INTELBRAS_DEVICE_SERIAL || "não configurado")
        },
        situacaoTerminal: dados.situacao,
        biometria: {
            fotoFacial: faceCadastrada ? "cadastrada" : "pendente",
            hashFotoCadastro: hashFoto,
            atualizadoEm: agora
        },
        sincronizadoEm: agora,
        createdAt: agora,
        updatedAt: agora,
        criadoPor: req.usuarioAdmin
    };

    try {
        await funcionarios.insertOne(documentoFuncionario);
    } catch (erro) {
        await banco.collection("auditoria_biometria").updateOne(
            { _id: auditoriaId },
            { $set: {
                resultado: faceCadastrada ? "terminal_criado_falha_local" : "terminal_criado_face_pendente_falha_local",
                erroLocal: erro.message.slice(0, 240),
                concluidoAt: new Date()
            } }
        ).catch(() => {});
        return res.status(503).json({
            sucesso: false,
            usuarioCriadoNoTerminal: true,
            faceCadastrada,
            mensagem: "O terminal criou o usuário, mas não foi possível gravar o cadastro local. Não repita o mesmo ID. Confira a auditoria e sincronize o funcionário antes de tentar novamente."
        });
    }

    const resultadoAuditoria = faceCadastrada ? "sucesso" : "usuario_criado_face_pendente";
    await banco.collection("auditoria_biometria").updateOne(
        { _id: auditoriaId },
        { $set: {
            resultado: resultadoAuditoria,
            terminalUsuarioCriado: true,
            faceCadastrada,
            ...(erroFace ? { erroFace: erroFace.slice(0, 240) } : {}),
            concluidoAt: new Date()
        } }
    ).catch(() => {});

    return res.status(faceCadastrada ? 201 : 207).json({
        sucesso: true,
        usuarioCriadoNoTerminal: true,
        faceCadastrada,
        userId: dados.userId,
        mensagem: faceCadastrada
            ? "Usuário criado no terminal e fotografia facial cadastrada com sucesso."
            : `Usuário criado no terminal, mas a fotografia facial não foi confirmada. O cadastro local foi salvo; use a ficha do funcionário para tentar adicionar a face novamente. ${erroFace || ""}`
    });
});

router.get("/ocorrencias", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    try {
        const status = String(req.query.status || "pendente");
        if (!["pendente", "analisada", "todas"].includes(status)) {
            return res.status(400).json({ sucesso: false, mensagem: "Filtro de situação inválido." });
        }
        const ocorrencias = await listarOcorrencias({ status, limite: req.query.limite });
        return res.json({ sucesso: true, quantidade: ocorrencias.length, ocorrencias });
    } catch (erro) {
        console.error("Erro ao listar ocorrências faciais:", erro.message);
        return res.status(500).json({ sucesso: false, mensagem: "Não foi possível consultar as ocorrências." });
    }
});

router.get("/ocorrencias/:id/foto", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    try {
        const foto = await obterFotoOcorrencia(req.params.id);
        if (!foto) return res.status(404).json({ sucesso: false, mensagem: "Fotografia não encontrada ou já expirada." });
        // A consulta da imagem também é auditada antes de a fotografia ser entregue.
        await gravarAuditoria({
            usuarioAdmin: req.usuarioAdmin,
            acao: "visualizar_fotografia_ocorrencia",
            resultado: "sucesso",
            ip: obterIp(req),
            detalhes: { ocorrenciaId: req.params.id }
        });
        res.setHeader("Content-Type", foto.contentType);
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.send(foto.buffer);
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: "Não foi possível abrir a fotografia." });
    }
});

router.patch("/ocorrencias/:id/revisao", middlewareCanalSeguro, middlewareAdmin, async (req, res) => {
    if (!verificarOrigem(req, res)) return;
    try {
        const resultado = await revisarOcorrencia(req.params.id, {
            status: String(req.body?.status || ""),
            observacoes: String(req.body?.observacoes || ""),
            funcionarioUserId: req.body?.funcionarioUserId ? String(req.body.funcionarioUserId) : null,
            usuarioAdmin: req.usuarioAdmin
        });
        await gravarAuditoria({
            usuarioAdmin: req.usuarioAdmin,
            acao: "revisao_ocorrencia_facial",
            resultado: "sucesso",
            ip: obterIp(req),
            detalhes: { ocorrenciaId: req.params.id, status: String(req.body?.status || "") }
        });
        return res.json(resultado);
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }
});

module.exports = router;
