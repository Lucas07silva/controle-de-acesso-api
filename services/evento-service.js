"use strict";

const crypto = require("node:crypto");
function obterBanco() { return require("./db").obterBanco(); }
const { registrarOcorrenciaFace } = require("./ocorrencia-facial-service");

function normalizarEventos(valor) {
    if (Array.isArray(valor)) return valor;
    if (valor && typeof valor === "object") {
        return Object.keys(valor)
            .filter(chave => /^\d+$/.test(chave))
            .sort((a, b) => Number(a) - Number(b))
            .map(chave => valor[chave]);
    }
    return [];
}

function obterDadosEvento(evento) {
    if (evento?.Data && typeof evento.Data === "object") return evento.Data;
    return evento && typeof evento === "object" ? evento : {};
}

function obterCampo(evento, dados, campo) {
    if (dados?.[campo] !== undefined && dados[campo] !== null) return dados[campo];
    if (evento?.[campo] !== undefined && evento[campo] !== null) return evento[campo];
    return null;
}

function obterCodigoEvento(evento) {
    return evento?.Code ?? evento?.EventBaseInfo?.Code ?? evento?.Data?.Code ?? null;
}

function obterAcaoEvento(evento) {
    return evento?.Action ?? evento?.EventBaseInfo?.Action ?? evento?.Data?.Action ?? null;
}

function converterDataEvento(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
        const dataTexto = new Date(valor);
        return Number.isNaN(dataTexto.getTime()) ? null : dataTexto;
    }
    const milissegundos = Math.abs(numero) < 1e12 ? numero * 1000 : numero;
    const data = new Date(milissegundos);
    return Number.isNaN(data.getTime()) ? null : data;
}

async function salvarEventosIntelbras(payload, eventos, ipOrigem, imagensPorEvento = [], opcoes = {}) {
    const banco = obterBanco();
    const colecaoEventos = banco.collection("eventos_acesso");
    const colecaoFuncionarios = banco.collection("funcionarios");

    let inseridos = 0;
    let duplicados = 0;
    let ocorrenciasFaciaisSalvas = 0;
    let fotosDescartadasPorSeguranca = 0;
    let falhasArmazenamentoFoto = 0;

    for (let indice = 0; indice < eventos.length; indice++) {
        const evento = eventos[indice];
        const dados = obterDadosEvento(evento);
        const userIdBruto = obterCampo(evento, dados, "UserID");
        const userIdTexto = String(userIdBruto ?? "").trim();
        const userId = !userIdTexto || ["0", "-1", "unknown", "none", "null"].includes(userIdTexto.toLowerCase())
            ? null
            : userIdTexto;
        const nomeBruto = obterCampo(evento, dados, "CardName") ?? obterCampo(evento, dados, "UserName");
        const nome = nomeBruto === null || nomeBruto === undefined ? null : String(nomeBruto).trim() || null;
        const timestamp = obterCampo(evento, dados, "UTC")
            ?? obterCampo(evento, dados, "RealUTC")
            ?? obterCampo(evento, dados, "CreateTime");
        const dataEvento = converterDataEvento(timestamp);
        const deviceId = payload.DeviceID == null ? null : String(payload.DeviceID);
        const codigo = obterCodigoEvento(evento);
        const acao = obterAcaoEvento(evento);
        const status = obterCampo(evento, dados, "Status");
        const tipo = obterCampo(evento, dados, "Type");
        const errorCode = obterCampo(evento, dados, "ErrorCode");
        const method = obterCampo(evento, dados, "Method");
        const door = obterCampo(evento, dados, "Door");
        const readerId = obterCampo(evento, dados, "ReaderID");

        const identidade = {
            deviceId: deviceId || ipOrigem,
            channel: payload.Channel ?? null,
            index: evento?.Index ?? evento?.EventBaseInfo?.Index ?? null,
            action: acao,
            code: codigo,
            timestamp,
            timeText: payload.Time ?? null,
            userId,
            type: tipo,
            status,
            errorCode,
            method,
            door,
            readerId
        };
        const eventKey = crypto.createHash("sha256").update(JSON.stringify(identidade)).digest("hex");

        if (userId) {
            const dadosAtualizacao = { updatedAt: new Date() };
            if (nome) dadosAtualizacao.nome = nome;
            await colecaoFuncionarios.updateOne(
                { userId },
                { $set: dadosAtualizacao, $setOnInsert: { userId, ativo: true, createdAt: new Date() } },
                { upsert: true }
            );
        }

        const documento = {
            eventKey,
            device: { deviceId, ip: ipOrigem, channel: payload.Channel ?? null },
            employee: { userId, nome },
            event: {
                index: evento?.Index ?? evento?.EventBaseInfo?.Index ?? null,
                action: acao,
                code: codigo,
                type: tipo,
                status,
                errorCode,
                method,
                door,
                doorTypeStr: obterCampo(evento, dados, "DoorTypeStr"),
                readerId,
                userType: obterCampo(evento, dados, "UserType")
            },
            timing: {
                timestamp,
                occurredAt: dataEvento,
                deviceTimeText: payload.Time ?? null,
                receivedAt: new Date()
            }
        };

        const resultado = await colecaoEventos.updateOne(
            { eventKey },
            { $setOnInsert: documento },
            { upsert: true }
        );

        if (resultado.upsertedCount === 1) inseridos++;
        else duplicados++;

        const imagemBuffer = imagensPorEvento[indice];
        if (imagemBuffer && !opcoes.permitirFotos) {
            fotosDescartadasPorSeguranca++;
        } else if (imagemBuffer && opcoes.permitirFotos) {
            try {
                const salva = await registrarOcorrenciaFace({
                    eventKey,
                    evento,
                    dados,
                    imagemBuffer,
                    ocorreuEm: dataEvento,
                    device: { deviceId },
                    ipOrigem
                });
                if (salva) ocorrenciasFaciaisSalvas++;
            } catch (erroFoto) {
                falhasArmazenamentoFoto++;
                // A falha ao guardar a foto não deve impedir o armazenamento do evento de acesso.
                console.error("Não foi possível armazenar uma fotografia de evento:", erroFoto.message);
            }
        }
    }

    return {
        recebidos: eventos.length,
        inseridos,
        duplicados,
        ocorrenciasFaciaisSalvas,
        fotosDescartadasPorSeguranca,
        falhasArmazenamentoFoto
    };
}

module.exports = {
    normalizarEventos,
    obterDadosEvento,
    obterCampo,
    obterCodigoEvento,
    obterAcaoEvento,
    converterDataEvento,
    salvarEventosIntelbras
};
