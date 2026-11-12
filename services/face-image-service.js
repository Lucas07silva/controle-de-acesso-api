"use strict";

function lerDimensoesJpeg(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    const marcadoresSof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

    while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        while (buffer[offset] === 0xff) offset++;
        const marcador = buffer[offset++];
        if (marcador === 0xd9 || marcador === 0xda) break;
        if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) continue;
        if (offset + 2 > buffer.length) return null;
        const tamanho = buffer.readUInt16BE(offset);
        if (tamanho < 2 || offset + tamanho > buffer.length) return null;
        if (marcadoresSof.has(marcador)) {
            if (offset + 7 > buffer.length) return null;
            return { largura: buffer.readUInt16BE(offset + 5), altura: buffer.readUInt16BE(offset + 3), mime: "image/jpeg", extensao: "jpg" };
        }
        offset += tamanho;
    }
    return null;
}

function lerDimensoesPng(buffer) {
    const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(assinatura)) return null;
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
    return {
        largura: buffer.readUInt32BE(16),
        altura: buffer.readUInt32BE(20),
        mime: "image/png",
        extensao: "png"
    };
}

function validarFotoFacialDataUrl(dataUrl) {
    if (typeof dataUrl !== "string") throw new Error("Selecione uma fotografia facial.");
    const correspondencia = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/i);
    if (!correspondencia) throw new Error("Para cadastro facial no terminal, selecione uma fotografia JPG/JPEG.");

    const base64 = correspondencia[1];
    // A API CGI recebe a fotografia codificada em Base64 e limita o campo PhotoData a 200 kB.
    const limiteBase64 = Math.min(Number(process.env.BIOMETRIA_FOTO_MAX_BASE64_CHARS) || 200000, 200000);
    if (!base64.length || base64.length > limiteBase64) {
        throw new Error(`A fotografia codificada deve ter no máximo ${Math.round(limiteBase64 / 1024)} KB em Base64.`);
    }

    const buffer = Buffer.from(base64, "base64");
    const dimensoes = lerDimensoesJpeg(buffer);
    if (!dimensoes || dimensoes.mime !== "image/jpeg") throw new Error("O arquivo não parece ser uma imagem JPG/JPEG válida.");
    if (dimensoes.largura < 150 || dimensoes.altura < 300 || dimensoes.largura > 600 || dimensoes.altura > 1200) {
        throw new Error("A resolução deve ficar entre 150 × 300 e 600 × 1200 pixels.");
    }

    return { buffer, base64, mime: dimensoes.mime, largura: dimensoes.largura, altura: dimensoes.altura, bytes: buffer.length, extensao: dimensoes.extensao };
}

function identificarImagemEvento(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { mime: "image/jpeg", extensao: "jpg" };
    }
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.subarray(0, 8).equals(png)) return { mime: "image/png", extensao: "png" };
    return null;
}

module.exports = { lerDimensoesJpeg, lerDimensoesPng, validarFotoFacialDataUrl, identificarImagemEvento };
