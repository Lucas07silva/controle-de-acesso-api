"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    extrairNotificacao,
    interpretarTextoIntelbras
} = require("../services/intelbras-notificacao-service");
const { eventoEhFaceNaoIdentificada } = require("../services/ocorrencia-facial-service");
const { montarImagensPorEvento } = require("../services/intelbras-notificacao-service");
const { requisicaoSegura, validarOrigem, senhaAdminValida, adminConfigurado } = require("../services/seguranca-biometria-service");
const { criarCabecalhoDigest } = require("../services/intelbras-device-service");
const { validarFotoFacialDataUrl } = require("../services/face-image-service");

function criarJpeg200x400() {
    return Buffer.from([
        0xff, 0xd8,
        0xff, 0xc0, 0x00, 0x11, 0x08,
        0x01, 0x90, // altura 400
        0x00, 0xc8, // largura 200
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
        0xff, 0xd9
    ]);
}

test("identifica somente tentativa facial local negada e sem UserID", () => {
    const evento = { Code: "AccessControl", Data: { Status: 0, Method: 15 } };
    assert.equal(eventoEhFaceNaoIdentificada(evento, evento.Data), true);
    assert.equal(eventoEhFaceNaoIdentificada({ Code: "AccessControl", Data: { Status: 0, Method: 15, UserID: "0" } }, { Status: 0, Method: 15, UserID: "0" }), true);
    assert.equal(eventoEhFaceNaoIdentificada({ Code: "AccessControl", Data: { Status: 1, Method: 15 } }, { Status: 1, Method: 15 }), false);
    assert.equal(eventoEhFaceNaoIdentificada({ Code: "AccessControl", Data: { Status: 0, Method: 1 } }, { Status: 0, Method: 1 }), false);
    assert.equal(eventoEhFaceNaoIdentificada({ Code: "AccessControl", Data: { Status: 0, Method: 15, UserID: "109" } }, { Status: 0, Method: 15, UserID: "109" }), false);
    assert.equal(eventoEhFaceNaoIdentificada({ Code: "KeepAlive", Data: { Status: 0, Method: 15 } }, { Status: 0, Method: 15 }), false);
});

test("interpreta campos planos do evento Intelbras sem perder EventBaseInfo", () => {
    const payload = interpretarTextoIntelbras([
        "Events[0].EventBaseInfo.Code=AccessControl",
        "Events[0].EventBaseInfo.Action=Pulse",
        "Events[0].Data.Status=0",
        "Events[0].Data.Method=15",
        "Events[0].Data.UserID=",
        "Events[0].Data.UTC=1794388500"
    ].join("\r\n"));
    assert.equal(payload.Events[0].EventBaseInfo.Code, "AccessControl");
    assert.equal(payload.Events[0].EventBaseInfo.Action, "Pulse");
    assert.equal(payload.Events[0].Data.Status, 0);
    assert.equal(payload.Events[0].Data.Method, 15);
});

test("extrai a fotografia JPEG anexada ao evento multipart", () => {
    const foto = criarJpeg200x400();
    const payload = {
        Events: [{
            Code: "AccessControl",
            Data: { Status: 0, Method: 15, ImageInfo: [{ Offset: 0, Length: foto.length }] }
        }]
    };
    const boundary = "----intelbras-test-boundary";
    const partes = [
        Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
        foto,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    const resultado = extrairNotificacao(Buffer.concat(partes), `multipart/mixed; boundary=${boundary}`);
    assert.equal(resultado.payload.Events.length, 1);
    assert.equal(resultado.quantidadeImagensRecebidas, 1);
    assert.deepEqual(resultado.imagensPorEvento[0], foto);
});


test("extrai foto JPEG multipart/form-data mesmo quando o firmware declara application/octet-stream", () => {
    const foto = criarJpeg200x400();
    const payload = {
        Events: [{
            Code: "AccessControl",
            Data: { Status: 0, Method: 15, ImageInfo: [{ Offset: 0, Length: foto.length }] }
        }]
    };
    const boundary = "----intelbras-form-data-boundary";
    const partes = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="Events"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="Picture"; filename="event.jpg"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        foto,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    const resultado = extrairNotificacao(Buffer.concat(partes), `multipart/form-data; boundary=${boundary}`);
    assert.equal(resultado.quantidadeImagensRecebidas, 1);
    assert.equal(resultado.quantidadeImagensAssociadas, 1);
    assert.deepEqual(resultado.imagensPorEvento[0], foto);
});

test("associa imagem a eventos quando Events chega como objeto indexado", () => {
    const imagem = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const resultado = montarImagensPorEvento({
        Events: { "0": { Data: { ImageInfo: [{ Offset: 0, Length: imagem.length }] } } }
    }, [imagem]);
    assert.deepEqual(resultado[0], imagem);
});

test("exige canal seguro para ações remotas e permite loopback local", () => {
    assert.equal(requisicaoSegura({ secure: true, socket: { remoteAddress: "192.0.2.10" } }), true);
    assert.equal(requisicaoSegura({ secure: false, socket: { remoteAddress: "127.0.0.1" } }), true);
    assert.equal(requisicaoSegura({ secure: false, socket: { remoteAddress: "192.0.2.10" }, get: () => "https" }), false);
});

test("valida origem pelo host e rejeita uma origem externa", () => {
    assert.equal(validarOrigem({ get: nome => nome === "origin" ? "https://radio.local" : "radio.local" }), true);
    assert.equal(validarOrigem({ get: nome => nome === "origin" ? "https://outro.local" : "radio.local" }), false);
});

test("gera cabeçalho de autenticação Digest com nonce e qop", () => {
    const cabecalho = criarCabecalhoDigest({
        usuario: "admin",
        senha: "segredo",
        desafio: { realm: "Intelbras", nonce: "abc123", qop: "auth", algorithm: "MD5" },
        metodo: "GET",
        uri: "/cgi-bin/magicBox.cgi?action=getSystemInfo"
    });
    assert.match(cabecalho, /^Digest username="admin"/);
    assert.match(cabecalho, /qop=auth/);
    assert.match(cabecalho, /response="[a-f0-9]{32}"/);
});

test("valida a fotografia de cadastro facial pela assinatura, tamanho e resolução", () => {
    const foto = criarJpeg200x400();
    const validada = validarFotoFacialDataUrl(`data:image/jpeg;base64,${foto.toString("base64")}`);
    assert.equal(validada.mime, "image/jpeg");
    assert.equal(validada.largura, 200);
    assert.equal(validada.altura, 400);
    assert.equal(validada.bytes, foto.length);
    assert.throws(() => validarFotoFacialDataUrl("data:image/gif;base64,AAAA"), /JPG\/JPEG/);
});


test("aceita PIN administrativo de 4 dígitos ou senha longa", () => {
    assert.equal(senhaAdminValida("2468"), true);
    assert.equal(senhaAdminValida("0000"), true);
    assert.equal(senhaAdminValida("123"), false);
    assert.equal(senhaAdminValida("abcd"), false);
    assert.equal(senhaAdminValida("senha-administrativa-longa"), true);
});

test("considera o administrador configurado com PIN de 4 dígitos e segredo longo", () => {
    const originais = {
        user: process.env.BIOMETRIA_ADMIN_USER,
        password: process.env.BIOMETRIA_ADMIN_PASSWORD,
        secret: process.env.BIOMETRIA_SESSION_SECRET
    };
    try {
        process.env.BIOMETRIA_ADMIN_USER = "admin-teste";
        process.env.BIOMETRIA_ADMIN_PASSWORD = "4826";
        process.env.BIOMETRIA_SESSION_SECRET = "x".repeat(48);
        assert.equal(adminConfigurado(), true);
        process.env.BIOMETRIA_ADMIN_PASSWORD = "123";
        assert.equal(adminConfigurado(), false);
    } finally {
        if (originais.user === undefined) delete process.env.BIOMETRIA_ADMIN_USER; else process.env.BIOMETRIA_ADMIN_USER = originais.user;
        if (originais.password === undefined) delete process.env.BIOMETRIA_ADMIN_PASSWORD; else process.env.BIOMETRIA_ADMIN_PASSWORD = originais.password;
        if (originais.secret === undefined) delete process.env.BIOMETRIA_SESSION_SECRET; else process.env.BIOMETRIA_SESSION_SECRET = originais.secret;
    }
});
