"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    analisarCSV,
    traduzirPermissao,
    converterCSVIntelbras
} = require("../services/intelbras-csv-service");

function criarLinha({ id = "109", nome = "LUCAS VINICIUS", permissao = "1", foto = "BASE64_FACIAL_NAO_IMPORTAR" } = {}) {
    const campos = Array(33).fill("");
    campos[0] = id;
    campos[1] = nome;
    campos[2] = "1970-02-01 00:00:00";
    campos[3] = "2037-12-31 23:59:59";
    campos[4] = permissao;
    campos[24] = foto;
    return campos.map(valor => /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor).join(",");
}

test("analisa CSV com BOM, aspas e quebras de linha", () => {
    const linhas = analisarCSV(`\uFEFF${criarLinha({ nome: "SILVA, JOÃO" })}\r\n`);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0][1], "SILVA, JOÃO");
});

test("mapeia os códigos de permissão do backup", () => {
    assert.equal(traduzirPermissao("1"), "Administrador");
    assert.equal(traduzirPermissao("2"), "Usuário comum");
    assert.equal(traduzirPermissao("9"), null);
});

test("importa somente ID, nome, permissão e validade, ignorando dados biométricos", () => {
    const resultado = converterCSVIntelbras(`${criarLinha()}\n${criarLinha({ id: "3", nome: "ELSON SANTOS", permissao: "1" })}`);
    assert.equal(resultado.length, 2);
    assert.deepEqual(resultado[0], {
        userId: "109",
        nome: "LUCAS VINICIUS",
        permissaoDispositivo: { codigo: 1, descricao: "Administrador" },
        validadeDispositivo: {
            inicio: "1970-02-01 00:00:00",
            fim: "2037-12-31 23:59:59"
        }
    });
    assert.equal(JSON.stringify(resultado).includes("BASE64_FACIAL_NAO_IMPORTAR"), false);
});

test("interrompe a validação quando o número de colunas não corresponde ao backup conhecido", () => {
    assert.throws(() => converterCSVIntelbras("1,João,1970,2037,1"), /33 colunas/);
});

test("interrompe quando há permissão desconhecida, ID vazio ou ID duplicado", () => {
    assert.throws(() => converterCSVIntelbras(criarLinha({ permissao: "9" })), /código de permissão não reconhecido/);
    assert.throws(() => converterCSVIntelbras(criarLinha({ id: "" })), /ID do usuário vazio/);
    assert.throws(() => converterCSVIntelbras(`${criarLinha()}\n${criarLinha()}`), /ID duplicado/);
});
