"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// A API meteorológica é simulada para que os testes não dependam da internet.
process.env.CLIMA_TIMEZONE = "America/Bahia";
process.env.CLIMA_LATITUDE = "0";
process.env.CLIMA_LONGITUDE = "0";
process.env.CLIMA_LOCALIDADE = "Localidade de teste";
global.fetch = async () => ({
    ok: true,
    json: async () => ({
        hourly: {
            time: ["2026-11-10T09:00"],
            temperature_2m: [27.4],
            apparent_temperature: [28.1],
            relative_humidity_2m: [68],
            precipitation: [0],
            weather_code: [2],
            wind_speed_10m: [7.5]
        }
    })
});

function valorCaminho(objeto, caminho) {
    return caminho.split(".").reduce((valor, chave) => valor?.[chave], objeto);
}

class CursorFalso {
    constructor(documentos) {
        this.documentos = [...documentos];
    }

    sort(ordem) {
        const [campo, direcao] = Object.entries(ordem)[0];
        this.documentos.sort((a, b) => {
            const valorA = valorCaminho(a, campo);
            const valorB = valorCaminho(b, campo);
            const comparacao = valorA < valorB ? -1 : valorA > valorB ? 1 : 0;
            return comparacao * direcao;
        });
        return this;
    }

    skip(quantidade) {
        this.documentos = this.documentos.slice(quantidade);
        return this;
    }

    limit(quantidade) {
        this.documentos = this.documentos.slice(0, quantidade);
        return this;
    }

    async toArray() {
        return this.documentos;
    }

    async *[Symbol.asyncIterator]() {
        for (const documento of this.documentos) yield documento;
    }
}

function combinarFiltro(documento, filtro) {
    for (const [campo, esperado] of Object.entries(filtro)) {
        const atual = valorCaminho(documento, campo);
        if (esperado && typeof esperado === "object" && ("$gte" in esperado || "$lt" in esperado)) {
            if (esperado.$gte && !(atual >= esperado.$gte)) return false;
            if (esperado.$lt && !(atual < esperado.$lt)) return false;
        } else if (atual !== esperado) {
            return false;
        }
    }
    return true;
}

const documentos = [
    {
        event: { code: "AccessControl", type: "Entry", status: 1, method: 15 },
        employee: { userId: "101", nome: "Ana" },
        timing: { occurredAt: new Date("2026-11-10T12:15:00.000Z") }
    },
    {
        event: { code: "AccessControl", type: "Exit", status: 1 },
        employee: { userId: "101", nome: "Ana" },
        timing: { occurredAt: new Date("2026-11-10T15:10:00.000Z") }
    },
    {
        event: { code: "AccessControl", type: "Entry", status: 0 },
        employee: { userId: "101", nome: "Ana" },
        timing: { occurredAt: new Date("2026-11-10T16:12:00.000Z") }
    },
    {
        event: { code: "AccessControl", type: "Entry" },
        employee: { userId: "202", nome: "Bruno" },
        timing: { occurredAt: new Date("2026-11-10T17:00:00.000Z") }
    },
    {
        event: { code: "System", type: "Start", status: 1 },
        employee: { userId: "101", nome: "Ana" },
        timing: { occurredAt: new Date("2026-11-10T18:00:00.000Z") }
    },
    {
        event: { code: "AccessControl", type: "Entry", status: 1 },
        employee: { userId: "303", nome: "Caio" },
        timing: { occurredAt: new Date("2026-11-09T12:00:00.000Z") }
    }
];

const cacheClima = new Map();
const colecao = {
    async updateOne(filtro, atualizacao) {
        cacheClima.set(filtro._id, { _id: filtro._id, ...atualizacao.$set });
    },
    async findOne(filtro) {
        return cacheClima.get(filtro._id) || null;
    },
    find(filtro) {
        return new CursorFalso(documentos.filter(documento => combinarFiltro(documento, filtro)));
    },
    async findOne(filtro) {
        return filtro.userId === "101"
            ? { userId: "101", nome: "Ana", ativo: true, createdAt: new Date("2026-10-01T12:00:00.000Z") }
            : null;
    },
    aggregate() {
        return { toArray: async () => [] };
    }
};

const bancoFalso = { collection: () => colecao };
const caminhoDb = require.resolve("../services/db");
require.cache[caminhoDb] = {
    id: caminhoDb,
    filename: caminhoDb,
    loaded: true,
    exports: { obterBanco: () => bancoFalso }
};

const consulta = require("../services/consulta-service");

test("calcula corretamente o intervalo diário no fuso da Bahia", () => {
    const intervalo = consulta.obterIntervaloDia("2026-11-10");
    assert.equal(intervalo.inicio.toISOString(), "2026-11-10T03:00:00.000Z");
    assert.equal(intervalo.fim.toISOString(), "2026-11-11T03:00:00.000Z");
});

test("rejeita datas e meses inválidos", () => {
    assert.throws(() => consulta.obterIntervaloDia("2026-02-30"), /não existe/);
    assert.throws(() => consulta.obterIntervaloMes("2026-13"), /não existe/);
});

test("classifica Entry/Exit e os resultados do terminal", () => {
    assert.equal(consulta.obterTipoMovimento("Entry"), "entrada");
    assert.equal(consulta.obterTipoMovimento("Exit"), "saida");
    assert.equal(consulta.obterStatusAcesso(1), "liberado");
    assert.equal(consulta.obterStatusAcesso(0), "negado");
    assert.equal(consulta.obterStatusAcesso(undefined), "liberado");
});

test("monta o resumo diário sem contar eventos de sistema", async () => {
    const resultado = await consulta.obterResumoDiario("2026-11-10");
    assert.equal(resultado.resumo.totalMovimentacoes, 4);
    assert.equal(resultado.resumo.entradas, 2);
    assert.equal(resultado.resumo.saidas, 1);
    assert.equal(resultado.resumo.negados, 1);
    assert.equal(resultado.resumo.funcionariosComAcesso, 2);
    assert.equal(resultado.fluxoPorHora[9].entradas, 1);
    assert.equal(resultado.fluxoPorHora[13].negados, 1);
});

test("monta o resumo mensal por funcionário e por dia", async () => {
    const resultado = await consulta.obterResumoMensal("2026-11");
    assert.equal(resultado.resumo.totalMovimentacoes, 5);
    assert.equal(resultado.resumo.entradas, 3);
    assert.equal(resultado.resumo.saidas, 1);
    assert.equal(resultado.resumo.negados, 1);
    assert.equal(resultado.porFuncionario.length, 3);
    assert.equal(resultado.porFuncionario.find(item => item.userId === "101").entradas, 1);
    assert.equal(resultado.porDia.length, 2);
    assert.equal(resultado.porDia[0].data, "2026-11-09");
    assert.equal(resultado.porDia[1].data, "2026-11-10");
});

test("histórico individual conta todo o período e limita apenas as linhas exibidas", async () => {
    const resultado = await consulta.obterHistoricoFuncionario("101", "2026-11-10", "2026-11-10", 1, 1);
    assert.equal(resultado.resumo.totalMovimentacoes, 3);
    assert.equal(resultado.resumo.entradas, 1);
    assert.equal(resultado.resumo.saidas, 1);
    assert.equal(resultado.resumo.negados, 1);
    assert.equal(resultado.movimentacoes.length, 1);
    assert.equal(resultado.paginacao.pagina, 1);
    assert.equal(resultado.paginacao.totalRegistros, 3);
    assert.equal(resultado.paginacao.totalPaginas, 3);
    assert.equal(resultado.paginacao.temProxima, true);
});

test("a paginação apresenta os registros seguintes sem repetir a página anterior", async () => {
    const primeira = await consulta.obterHistoricoFuncionario("101", "2026-11-10", "2026-11-10", 1, 1);
    const segunda = await consulta.obterHistoricoFuncionario("101", "2026-11-10", "2026-11-10", 2, 1);
    assert.equal(primeira.movimentacoes.length, 1);
    assert.equal(segunda.movimentacoes.length, 1);
    assert.notEqual(primeira.movimentacoes[0].dataHora, segunda.movimentacoes[0].dataHora);
    assert.equal(segunda.paginacao.temAnterior, true);
    assert.equal(segunda.paginacao.temProxima, true);
});

test("gera frequência individual por hora, dia da semana e data", async () => {
    const resultado = await consulta.obterHistoricoFuncionario("101", "2026-11-10", "2026-11-10", 1, 25);
    assert.equal(resultado.frequencia.porHora[9].entradas, 1);
    assert.equal(resultado.frequencia.porHora[12].saidas, 1);
    assert.equal(resultado.frequencia.porHora[13].negados, 1);
    assert.equal(resultado.frequencia.porDiaSemana[1].total, 3);
    assert.equal(resultado.frequencia.porDiaSemana[1].rotulo, "Terça-feira");
    assert.equal(resultado.frequencia.porData.length, 1);
    assert.equal(resultado.frequencia.porData[0].data, "2026-11-10");
    assert.equal(resultado.frequencia.porData[0].total, 3);
});

test("sem filtro inicial, abre o histórico completo desde o primeiro evento", async () => {
    const resultado = await consulta.obterHistoricoFuncionario("101", undefined, "2026-11-10", 1, 25);
    assert.equal(resultado.periodo.inicio, "2026-11-10");
    assert.equal(resultado.periodo.fim, "2026-11-10");
    assert.equal(resultado.resumo.totalMovimentacoes, 3);
    assert.equal(resultado.movimentacoes.length, 3);
    const entradaLiberada = resultado.movimentacoes.find(item => item.movimento === "Entrada" && item.resultado === "Liberado");
    assert.equal(entradaLiberada.temperatura.disponivel, true);
    assert.equal(entradaLiberada.temperatura.temperaturaC, 27.4);
    assert.equal(entradaLiberada.temperatura.condicao, "Parcialmente nublado");
});

test("calcula corretamente o dia da semana no fuso da Bahia", () => {
    assert.equal(consulta.obterIndiceDiaSemanaBahia(new Date("2026-11-10T12:00:00.000Z")), 1);
});

test("traduz os métodos de autenticação conhecidos", () => {
    assert.equal(consulta.descreverMetodoAcesso(15), "Reconhecimento facial");
    assert.equal(consulta.descreverMetodoAcesso(1), "Cartão de acesso");
    assert.equal(consulta.descreverMetodoAcesso(999), "Código 999");
});
