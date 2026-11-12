"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
function obterBanco() { return require("./db").obterBanco(); }
function obterObjectId() { return require("mongodb").ObjectId; }
const { identificarImagemEvento } = require("./face-image-service");

function obterDiretorioPrivado() {
    const configurado = String(process.env.BIOMETRIA_STORAGE_DIR || "./storage/ocorrencias-face");
    return path.resolve(process.cwd(), configurado);
}

function diasRetencao() {
    const dias = Number(process.env.BIOMETRIA_RETENCAO_DIAS || 30);
    return Number.isInteger(dias) && dias >= 1 && dias <= 3650 ? dias : 30;
}

function eventoEhFaceNaoIdentificada(evento, dados) {
    const code = String(evento?.Code ?? evento?.EventBaseInfo?.Code ?? dados?.Code ?? "").toLowerCase();
    const status = dados?.Status ?? evento?.Status;
    const method = Number(dados?.Method ?? evento?.Method);
    const userId = dados?.UserID ?? evento?.UserID;
    const negado = status === 0 || status === "0" || status === false;
    const identificador = String(userId ?? "").trim().toLowerCase();
    const semIdentificador = !identificador || ["0", "-1", "unknown", "none", "null"].includes(identificador);
    return code === "accesscontrol" && negado && method === 15 && semIdentificador;
}

async function removerArquivosERegistrosExpirados() {
    const banco = obterBanco();
    const colecao = banco.collection("ocorrencias_face");
    const limite = new Date(Date.now() - diasRetencao() * 24 * 60 * 60 * 1000);
    const expiradas = await colecao.find({ occurredAt: { $lt: limite } }).toArray();
    const diretorio = obterDiretorioPrivado();

    for (const item of expiradas) {
        if (item.photo?.fileName) {
            const caminho = path.resolve(diretorio, item.photo.fileName);
            if (caminho.startsWith(`${diretorio}${path.sep}`)) {
                await fs.rm(caminho, { force: true }).catch(() => {});
            }
        }
    }
    if (expiradas.length) {
        await colecao.deleteMany({ _id: { $in: expiradas.map(item => item._id) } });
    }
    return expiradas.length;
}

async function registrarOcorrenciaFace({ eventKey, evento, dados, imagemBuffer, ocorreuEm, device, ipOrigem }) {
    if (!eventoEhFaceNaoIdentificada(evento, dados)) {
        console.log("Imagem recebida não armazenada: evento não corresponde a tentativa facial local negada e sem UserID.");
        return false;
    }
    const imagem = identificarImagemEvento(imagemBuffer);
    if (!imagem) {
        console.warn("Imagem recebida não armazenada: assinatura do arquivo não corresponde a JPEG ou PNG válido.");
        return false;
    }
    if (imagemBuffer.length > 2 * 1024 * 1024) {
        console.warn("Imagem recebida não armazenada: arquivo ultrapassa o limite de 2 MB.");
        return false;
    }

    const banco = obterBanco();
    const colecao = banco.collection("ocorrencias_face");
    const existente = await colecao.findOne({ eventKey });
    if (existente) {
        console.log("Imagem não duplicada: esta ocorrência já foi registrada anteriormente.");
        return false;
    }

    const diretorio = obterDiretorioPrivado();
    await fs.mkdir(diretorio, { recursive: true });
    const hashFoto = crypto.createHash("sha256").update(imagemBuffer).digest("hex");
    const fileName = `${eventKey}.${imagem.extensao}`;
    const caminho = path.resolve(diretorio, fileName);
    if (!caminho.startsWith(`${diretorio}${path.sep}`)) throw new Error("Caminho privado da imagem inválido.");

    let arquivoCriadoPorEstaRequisicao = false;
    try {
        await fs.writeFile(caminho, imagemBuffer, { flag: "wx" });
        arquivoCriadoPorEstaRequisicao = true;
    } catch (erro) {
        if (erro.code !== "EEXIST") throw erro;
    }

    const documento = {
        eventKey,
        occurredAt: ocorreuEm || new Date(),
        receivedAt: new Date(),
        device: { deviceId: device?.deviceId || null, ip: ipOrigem || null },
        event: {
            code: evento?.Code ?? evento?.EventBaseInfo?.Code ?? "AccessControl",
            action: evento?.Action ?? evento?.EventBaseInfo?.Action ?? null,
            status: dados?.Status ?? evento?.Status ?? 0,
            method: Number(dados?.Method ?? evento?.Method ?? 15),
            errorCode: dados?.ErrorCode ?? evento?.ErrorCode ?? null,
            type: dados?.Type ?? evento?.Type ?? null,
            door: dados?.Door ?? evento?.Door ?? null
        },
        identification: {
            result: "nao_identificada",
            linkedEmployeeUserId: null
        },
        review: {
            status: "pendente",
            notes: "",
            reviewedBy: null,
            reviewedAt: null
        },
        photo: {
            fileName,
            contentType: imagem.mime,
            bytes: imagemBuffer.length,
            sha256: hashFoto
        },
        retention: {
            expiresAt: new Date(Date.now() + diasRetencao() * 24 * 60 * 60 * 1000),
            days: diasRetencao()
        }
    };

    try {
        const resultado = await colecao.updateOne(
            { eventKey },
            { $setOnInsert: documento },
            { upsert: true }
        );
        if (resultado.upsertedCount !== 1) {
            if (arquivoCriadoPorEstaRequisicao) await fs.rm(caminho, { force: true }).catch(() => {});
            return false;
        }
        return true;
    } catch (erro) {
        if (arquivoCriadoPorEstaRequisicao) await fs.rm(caminho, { force: true }).catch(() => {});
        throw erro;
    }
}

function formatarOcorrencia(documento) {
    return {
        id: documento._id.toString(),
        ocorreuEm: documento.occurredAt,
        recebidoEm: documento.receivedAt,
        event: documento.event,
        device: { deviceId: documento.device?.deviceId || null },
        identification: documento.identification,
        review: documento.review,
        foto: {
            url: `/api/biometria/ocorrencias/${documento._id.toString()}/foto`,
            contentType: documento.photo?.contentType || "image/jpeg",
            bytes: documento.photo?.bytes || 0
        },
        expiraEm: documento.retention?.expiresAt || null
    };
}

async function listarOcorrencias({ status = "pendente", limite = 50 } = {}) {
    await removerArquivosERegistrosExpirados();
    const colecao = obterBanco().collection("ocorrencias_face");
    const filtro = status === "todas" ? {} : { "review.status": status };
    const quantidade = Math.max(1, Math.min(Number(limite) || 50, 100));
    const documentos = await colecao.find(filtro)
        .sort({ occurredAt: -1, receivedAt: -1 })
        .limit(quantidade)
        .toArray();
    return documentos.map(formatarOcorrencia);
}

async function obterFotoOcorrencia(id) {
    const ObjectId = obterObjectId();
    if (!ObjectId.isValid(id)) return null;
    const documento = await obterBanco().collection("ocorrencias_face").findOne({ _id: new ObjectId(id) });
    if (!documento?.photo?.fileName) return null;

    const diretorio = obterDiretorioPrivado();
    const caminho = path.resolve(diretorio, documento.photo.fileName);
    if (!caminho.startsWith(`${diretorio}${path.sep}`)) return null;
    const buffer = await fs.readFile(caminho).catch(() => null);
    if (!buffer) return null;
    return { buffer, contentType: documento.photo.contentType || "image/jpeg" };
}

async function revisarOcorrencia(id, { status, observacoes = "", funcionarioUserId = null, usuarioAdmin }) {
    const ObjectId = obterObjectId();
    if (!ObjectId.isValid(id)) throw new Error("Identificador da ocorrência inválido.");
    if (!["pendente", "analisada"].includes(status)) throw new Error("Situação de análise inválida.");
    const notas = String(observacoes || "").trim();
    if (notas.length > 1000) throw new Error("As observações devem ter no máximo 1.000 caracteres.");

    const banco = obterBanco();
    let vinculo = null;
    if (funcionarioUserId !== null && String(funcionarioUserId).trim() !== "") {
        const userId = String(funcionarioUserId).trim();
        const funcionario = await banco.collection("funcionarios").findOne({ userId });
        if (!funcionario) throw new Error("Funcionário selecionado não foi encontrado no cadastro local.");
        vinculo = userId;
    }

    const atualizacao = {
        "review.status": status,
        "review.notes": notas,
        "review.reviewedBy": usuarioAdmin,
        "review.reviewedAt": new Date(),
        "identification.result": vinculo ? "associacao_manual" : "nao_identificada",
        "identification.linkedEmployeeUserId": vinculo,
        updatedAt: new Date()
    };
    const resultado = await banco.collection("ocorrencias_face").updateOne(
        { _id: new ObjectId(id) },
        { $set: atualizacao }
    );
    if (!resultado.matchedCount) throw new Error("Ocorrência não encontrada.");
    return { sucesso: true };
}

module.exports = {
    eventoEhFaceNaoIdentificada,
    registrarOcorrenciaFace,
    listarOcorrencias,
    obterFotoOcorrencia,
    revisarOcorrencia,
    removerArquivosERegistrosExpirados,
    obterDiretorioPrivado
};
