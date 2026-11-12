"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizarNovoUsuario,
    montarPayloadNovoUsuario,
    interpretarRespostaBuscaUsuario
} = require("../services/intelbras-device-service");

test("normaliza os dados do novo usuário e congela o cadastro por padrão", () => {
    const dados = normalizarNovoUsuario({ userId: " 125 ", nome: "  Maria   da   Silva  " });
    assert.deepEqual(dados, {
        userId: "125",
        nome: "Maria da Silva",
        situacao: "congelado",
        validadeInicio: "",
        validadeFim: ""
    });
});

test("monta payload com usuário comum e nunca com autoridade administrativa", () => {
    const payload = montarPayloadNovoUsuario({
        userId: "126",
        nome: "João Pereira",
        situacao: "congelado",
        validadeInicio: "2026-11-11",
        validadeFim: "2026-12-31"
    });
    assert.deepEqual(payload.UserList[0], {
        UserID: "126",
        UserName: "João Pereira",
        UserType: 0,
        UserStatus: 1,
        Authority: 2,
        ValidFrom: "2026-11-11 00:00:00",
        ValidTo: "2026-12-31 23:59:59"
    });
    assert.notEqual(payload.UserList[0].Authority, 1);
});

test("opção normal ativa um usuário comum sem atribuir privilégios de administrador", () => {
    const payload = montarPayloadNovoUsuario({ userId: "127", nome: "Ana Souza", situacao: "normal" });
    assert.equal(payload.UserList[0].UserStatus, 0);
    assert.equal(payload.UserList[0].Authority, 2);
    assert.equal(payload.UserList[0].UserType, 0);
});

test("rejeita ID, nome, situação e validade inválidos", () => {
    assert.throws(() => normalizarNovoUsuario({ userId: "abc", nome: "Nome" }), /somente números/);
    assert.throws(() => normalizarNovoUsuario({ userId: "1", nome: " " }), /nome completo/);
    assert.throws(() => normalizarNovoUsuario({ userId: "1", nome: "Nome", situacao: "admin" }), /Situação/);
    assert.throws(() => normalizarNovoUsuario({ userId: "1", nome: "Nome", validadeInicio: "2026-02-30" }), /data inválida/);
    assert.throws(() => normalizarNovoUsuario({ userId: "1", nome: "Nome", validadeInicio: "2026-12-01", validadeFim: "2026-11-01" }), /posterior/);
});

test("interpreta resposta JSON da busca por UserID", () => {
    assert.deepEqual(interpretarRespostaBuscaUsuario('{"Token":42,"Total":1,"Caps":[]}'), { total: 1, token: 42 });
    assert.deepEqual(interpretarRespostaBuscaUsuario('{"Token":17,"Total":0}'), { total: 0, token: 17 });
});

test("interpreta resposta textual do terminal e rejeita formato desconhecido", () => {
    assert.deepEqual(interpretarRespostaBuscaUsuario("Token=44\r\nTotal=0\r\n"), { total: 0, token: "44" });
    assert.throws(() => interpretarRespostaBuscaUsuario("erro desconhecido"), /interpretar a resposta/);
    assert.throws(() => interpretarRespostaBuscaUsuario(""), /resposta vazia/);
});
