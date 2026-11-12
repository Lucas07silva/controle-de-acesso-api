"use strict";

function separarMultipart(corpo, contentType) {
    const correspondencia = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!correspondencia) throw new Error("Boundary multipart não informado.");

    const boundary = (correspondencia[1] || correspondencia[2]).trim();
    const delimitador = Buffer.from(`--${boundary}`);
    const separador = Buffer.from("\r\n\r\n");
    const partes = [];
    let cursor = 0;

    while (cursor < corpo.length) {
        const inicio = corpo.indexOf(delimitador, cursor);
        if (inicio < 0) break;
        let inicioParte = inicio + delimitador.length;
        const sufixo = corpo.subarray(inicioParte, inicioParte + 2).toString();
        if (sufixo === "--") break;
        if (sufixo === "\r\n") inicioParte += 2;

        const fimCabecalho = corpo.indexOf(separador, inicioParte);
        if (fimCabecalho < 0) break;
        const cabecalhos = corpo.subarray(inicioParte, fimCabecalho).toString("utf8");
        const inicioConteudo = fimCabecalho + separador.length;
        const proximoMarcador = corpo.indexOf(delimitador, inicioConteudo);
        let fimConteudo = proximoMarcador < 0 ? corpo.length : proximoMarcador;
        if (proximoMarcador >= 0 && corpo.subarray(fimConteudo - 2, fimConteudo).toString() === "\r\n") fimConteudo -= 2;

        const tipo = cabecalhos.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() || "application/octet-stream";
        partes.push({ cabecalhos, contentType: tipo, conteudo: corpo.subarray(inicioConteudo, fimConteudo) });
        if (proximoMarcador < 0) break;
        cursor = proximoMarcador;
    }
    return partes;
}

function converterValor(texto) {
    const valor = String(texto ?? "").trim();
    if (valor === "true") return true;
    if (valor === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(valor)) return Number(valor);
    return valor;
}

function atribuirCaminho(alvo, caminho, valor) {
    const tokens = [];
    const regex = /([^.[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = regex.exec(caminho)) !== null) {
        tokens.push(match[1] !== undefined ? match[1] : Number(match[2]));
    }
    if (!tokens.length) return;
    let atual = alvo;
    for (let indice = 0; indice < tokens.length - 1; indice++) {
        const atualToken = tokens[indice];
        const proximoToken = tokens[indice + 1];
        if (atual[atualToken] === undefined) atual[atualToken] = typeof proximoToken === "number" ? [] : {};
        atual = atual[atualToken];
    }
    atual[tokens[tokens.length - 1]] = valor;
}

function interpretarTextoIntelbras(texto) {
    const linhas = String(texto || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const payload = { Events: [] };
    for (const linha of linhas) {
        const indiceIgual = linha.indexOf("=");
        if (indiceIgual < 1) continue;
        const caminho = linha.slice(0, indiceIgual).trim();
        const valor = linha.slice(indiceIgual + 1).trim();
        const evento = caminho.match(/^Events\[(\d+)\]\.(.+)$/i);
        if (evento) {
            const numero = Number(evento[1]);
            if (!payload.Events[numero]) payload.Events[numero] = {};
            atribuirCaminho(payload.Events[numero], evento[2], converterValor(valor));
        } else if (!/^--/.test(caminho)) {
            atribuirCaminho(payload, caminho, converterValor(valor));
        }
    }
    payload.Events = payload.Events.filter(Boolean);
    if (!payload.Events.length) throw new Error("A parte textual não contém eventos reconhecíveis.");
    return payload;
}

function interpretarParteTexto(buffer, contentType = "") {
    const texto = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    if (!texto) throw new Error("A parte textual da notificação está vazia.");
    try {
        return JSON.parse(texto);
    } catch {
        if (/application\/x-www-form-urlencoded/i.test(contentType)) {
            const campos = new URLSearchParams(texto);
            const linhas = [];
            for (const [chave, valor] of campos.entries()) linhas.push(`${chave}=${valor}`);
            return interpretarTextoIntelbras(linhas.join("\r\n"));
        }
        return interpretarTextoIntelbras(texto);
    }
}

function parteEhImagem(parte) {
    const tipo = String(parte?.contentType || "").split(";")[0].trim().toLowerCase();
    if (/^image\/(jpeg|jpg|png)$/.test(tipo)) return true;
    const buffer = parte?.conteudo;
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return jpeg || png;
}

function obterInfoImagem(evento) {
    const dados = evento?.Data && typeof evento.Data === "object" ? evento.Data : evento;
    const info = dados?.ImageInfo ?? evento?.ImageInfo ?? [];
    if (Array.isArray(info)) return info[0] || null;
    if (info && typeof info === "object") return info["0"] || info;
    return null;
}

function montarImagensPorEvento(payload, imagens) {
    const eventosBrutos = payload?.Events;
    const eventos = Array.isArray(eventosBrutos)
        ? eventosBrutos
        : eventosBrutos && typeof eventosBrutos === "object"
            ? Object.keys(eventosBrutos).filter(chave => /^\d+$/.test(chave)).sort((a, b) => Number(a) - Number(b)).map(chave => eventosBrutos[chave])
            : [];
    const resultado = Array(eventos.length).fill(null);
    if (!eventos.length || !imagens.length) return resultado;

    if (imagens.length >= eventos.length) {
        eventos.forEach((evento, indice) => {
            const parte = imagens[indice];
            const info = obterInfoImagem(evento);
            if (info && Number.isFinite(Number(info.Offset)) && Number.isFinite(Number(info.Length))) {
                const inicio = Math.max(0, Number(info.Offset));
                const fim = inicio + Math.max(0, Number(info.Length));
                resultado[indice] = fim <= parte.length ? parte.subarray(inicio, fim) : parte;
            } else {
                resultado[indice] = parte;
            }
        });
        return resultado;
    }

    if (imagens.length === 1) {
        const buffer = imagens[0];
        eventos.forEach((evento, indice) => {
            const info = obterInfoImagem(evento);
            if (!info) return;
            const inicio = Math.max(0, Number(info.Offset) || 0);
            const tamanho = Number(info.Length);
            if (Number.isFinite(tamanho) && tamanho > 0 && inicio + tamanho <= buffer.length) {
                resultado[indice] = buffer.subarray(inicio, inicio + tamanho);
            } else if (eventos.length === 1) {
                resultado[indice] = buffer;
            }
        });
        if (eventos.length === 1 && !resultado[0]) resultado[0] = buffer;
    }
    return resultado;
}

function extrairNotificacao(corpo, contentType, bodyObjeto = null) {
    if (Buffer.isBuffer(corpo)) {
        const partes = separarMultipart(corpo, contentType);
        const parteTexto = partes.find(parte => /^(text\/plain|application\/json|text\/json|application\/x-www-form-urlencoded)$/.test(parte.contentType));
        if (!parteTexto) throw new Error("Parte textual dos eventos não encontrada.");
        const payload = interpretarParteTexto(parteTexto.conteudo, parteTexto.contentType);
        // Alguns firmwares declaram as fotos como application/octet-stream; nesse caso,
        // identificamos JPEG/PNG pela assinatura binária, sem confiar apenas no MIME.
        const partesImagem = partes.filter(parteEhImagem);
        const imagens = partesImagem.map(parte => parte.conteudo);
        const imagensPorEvento = montarImagensPorEvento(payload, imagens);
        return {
            payload,
            imagensPorEvento,
            quantidadeImagensRecebidas: imagens.length,
            quantidadeImagensAssociadas: imagensPorEvento.filter(Buffer.isBuffer).length,
            tiposConteudo: partes.map(parte => parte.contentType)
        };
    }
    if (bodyObjeto && typeof bodyObjeto === "object") {
        return {
            payload: bodyObjeto,
            imagensPorEvento: [],
            quantidadeImagensRecebidas: 0,
            quantidadeImagensAssociadas: 0,
            tiposConteudo: [contentType || "application/json"]
        };
    }
    throw new Error("Formato de requisição não reconhecido.");
}

module.exports = {
    separarMultipart,
    interpretarTextoIntelbras,
    interpretarParteTexto,
    montarImagensPorEvento,
    parteEhImagem,
    extrairNotificacao
};
