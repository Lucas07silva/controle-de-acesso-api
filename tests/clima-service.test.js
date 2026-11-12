"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Banco em memória: valida o cache sem precisar de um MongoDB instalado.
process.env.CLIMA_LATITUDE = "0";
process.env.CLIMA_LONGITUDE = "0";
process.env.CLIMA_TIMEZONE = "America/Bahia";
process.env.CLIMA_LOCALIDADE = "Localidade de teste";
const cacheMeteorologico = new Map();
const colecaoCache = {
    async findOne(filtro) {
        return cacheMeteorologico.get(filtro._id) || null;
    },
    async updateOne(filtro, atualizacao) {
        cacheMeteorologico.set(filtro._id, { _id: filtro._id, ...atualizacao.$set });
    }
};
const caminhoDb = require.resolve("../services/db");
require.cache[caminhoDb] = {
    id: caminhoDb,
    filename: caminhoDb,
    loaded: true,
    exports: { obterBanco: () => ({ collection: () => colecaoCache }) }
};

const clima = require("../services/clima-service");

test("converte o horário do evento para a hora local da Bahia", () => {
    const resultado = clima.obterDataHoraLocalBahia(new Date("2026-11-10T12:15:00.000Z"));
    assert.deepEqual(resultado, {
        data: "2026-11-10",
        hora: "09:00",
        chaveHora: "2026-11-10T09:00"
    });
});

test("extrai temperaturas horárias da resposta meteorológica", () => {
    const resultado = clima.extrairTemperaturasHorarias({
        hourly: {
            time: ["2026-11-10T08:00", "2026-11-10T09:00", "2026-11-10T10:00"],
            temperature_2m: [24.24, 25.56, null]
        }
    });

    assert.deepEqual(resultado, [
        { hora: "08:00", temperaturaC: 24.2 },
        { hora: "09:00", temperaturaC: 25.6 },
        { hora: "10:00", temperaturaC: null }
    ]);
});

test("encontra a temperatura da hora exata de referência", () => {
    const resposta = {
        hourly: {
            time: ["2026-11-10T08:00", "2026-11-10T09:00"],
            temperature_2m: [23.5, 27.1]
        }
    };

    assert.equal(clima.encontrarTemperatura(resposta, "2026-11-10T09:00"), 27.1);
    assert.equal(clima.encontrarTemperatura(resposta, "2026-11-10T11:00"), null);
});

test("rejeita resposta sem série horária válida", () => {
    assert.throws(() => clima.extrairTemperaturasHorarias({ hourly: {} }), /série horária de temperatura válida/);
});


test("prioriza a API de previsão com dados passados para datas recentes", async () => {
    const fetchOriginal = global.fetch;
    const urls = [];
    global.fetch = async url => {
        urls.push(String(url));
        return {
            ok: true,
            json: async () => ({
                hourly: {
                    time: ["2026-11-10T09:00"],
                    temperature_2m: [28.2]
                }
            })
        };
    };

    try {
        const dados = await clima.consultarTemperaturaDoDia("2026-11-10");
        assert.equal(dados.disponivel, true);
        assert.equal(dados.temperaturas[0].temperaturaC, 28.2);
        assert.match(urls[0], /api\.open-meteo\.com\/v1\/forecast/);
        assert.match(urls[0], /past_days=/);
        assert.match(urls[0], /timezone=America%2FBahia/);
    } finally {
        global.fetch = fetchOriginal;
    }
});

test("usa a API de reanálise como alternativa quando a previsão histórica falha", async () => {
    const fetchOriginal = global.fetch;
    const urls = [];
    global.fetch = async url => {
        urls.push(String(url));
        if (urls.length < 3) return { ok: false, status: 503 };
        return {
            ok: true,
            json: async () => ({
                hourly: { time: ["2026-11-10T09:00"], temperature_2m: [26.4] }
            })
        };
    };

    try {
        const dados = await clima.consultarTemperaturaDoDia("2026-11-10");
        assert.equal(urls.length, 3);
        assert.match(urls[0], /api\.open-meteo\.com\/v1\/forecast/);
        assert.match(urls[1], /historical-forecast-api\.open-meteo\.com/);
        assert.match(urls[2], /archive-api\.open-meteo\.com/);
        assert.equal(dados.fonte, "Open-Meteo Historical Weather API");
    } finally {
        global.fetch = fetchOriginal;
    }
});


test("consulta a temperatura no horário local do evento e reutiliza o cache", async () => {
    const fetchOriginal = global.fetch;
    let chamadas = 0;
    global.fetch = async () => {
        chamadas++;
        return {
            ok: true,
            json: async () => ({
                hourly: {
                    time: ["2026-11-10T09:00"],
                    temperature_2m: [29.2],
                    apparent_temperature: [30.1],
                    relative_humidity_2m: [64],
                    precipitation: [0],
                    weather_code: [2],
                    wind_speed_10m: [8.2]
                }
            })
        };
    };

    try {
        const instante = new Date("2026-11-10T12:15:00.000Z");
        const primeira = await clima.obterTemperaturaHistorica(instante);
        const segunda = await clima.obterTemperaturaHistorica(instante);

        assert.equal(primeira.disponivel, true);
        assert.equal(primeira.temperaturaC, 29.2);
        assert.equal(primeira.condicao, "Parcialmente nublado");
        assert.equal(primeira.sensacaoC, 30.1);
        assert.equal(primeira.umidadePct, 64);
        assert.equal(primeira.ventoKmh, 8.2);
        assert.equal(primeira.horaReferencia, "2026-11-10 09:00");
        assert.equal(segunda.temperaturaC, 29.2);
        assert.equal(chamadas, 1);
    } finally {
        global.fetch = fetchOriginal;
    }
});


test("interpreta condição meteorológica e detalhes horários", () => {
    const resultado = clima.extrairDadosMeteorologicosHorarios({
        hourly: {
            time: ["2026-11-10T09:00"],
            temperature_2m: [28.24],
            apparent_temperature: [30.46],
            relative_humidity_2m: [67],
            precipitation: [0.2],
            weather_code: [61],
            wind_speed_10m: [9.6]
        }
    });

    assert.deepEqual(resultado[0], {
        data: "2026-11-10",
        hora: "09:00",
        temperaturaC: 28.2,
        sensacaoC: 30.5,
        umidadePct: 67,
        precipitacaoMm: 0.2,
        ventoKmh: 9.6,
        codigoTempo: 61,
        condicao: "Chuva leve",
        icone: "🌧️"
    });
});

test("mapeia códigos WMO desconhecidos sem interromper a ficha", () => {
    assert.equal(clima.descreverCondicaoMeteorologica(999).descricao, "Condição meteorológica não identificada");
});
