"use strict";

const bancoService = require("./db");

const FUSO_HORARIO = process.env.CLIMA_TIMEZONE || "America/Sao_Paulo";
const LOCALIDADE = process.env.CLIMA_LOCALIDADE || "Localidade configurada";
const LATITUDE_CONFIG = process.env.CLIMA_LATITUDE === undefined || process.env.CLIMA_LATITUDE.trim() === ""
    ? Number.NaN
    : Number(process.env.CLIMA_LATITUDE);
const LONGITUDE_CONFIG = process.env.CLIMA_LONGITUDE === undefined || process.env.CLIMA_LONGITUDE.trim() === ""
    ? Number.NaN
    : Number(process.env.CLIMA_LONGITUDE);
const LATITUDE = Number.isFinite(LATITUDE_CONFIG) && LATITUDE_CONFIG >= -90 && LATITUDE_CONFIG <= 90
    ? LATITUDE_CONFIG
    : null;
const LONGITUDE = Number.isFinite(LONGITUDE_CONFIG) && LONGITUDE_CONFIG >= -180 && LONGITUDE_CONFIG <= 180
    ? LONGITUDE_CONFIG
    : null;
const CACHE_SUCESSO_MS = 30 * 24 * 60 * 60 * 1000;
// Falhas externas ficam em cache por pouco tempo para permitir nova tentativa rápida.
const CACHE_FALHA_MS = 60 * 1000;
const TEMPO_LIMITE_MS = 15000;
const VARIAVEIS_HORARIAS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "wind_speed_10m"
].join(",");

const CONDICOES_WMO = {
    0: { descricao: "Céu limpo", icone: "☀️" },
    1: { descricao: "Predominantemente limpo", icone: "🌤️" },
    2: { descricao: "Parcialmente nublado", icone: "⛅" },
    3: { descricao: "Nublado", icone: "☁️" },
    45: { descricao: "Nevoeiro", icone: "🌫️" },
    48: { descricao: "Nevoeiro com geada", icone: "🌫️" },
    51: { descricao: "Garoa leve", icone: "🌦️" },
    53: { descricao: "Garoa moderada", icone: "🌦️" },
    55: { descricao: "Garoa intensa", icone: "🌧️" },
    56: { descricao: "Garoa congelante leve", icone: "🌧️" },
    57: { descricao: "Garoa congelante intensa", icone: "🌧️" },
    61: { descricao: "Chuva leve", icone: "🌧️" },
    63: { descricao: "Chuva moderada", icone: "🌧️" },
    65: { descricao: "Chuva forte", icone: "🌧️" },
    66: { descricao: "Chuva congelante leve", icone: "🌧️" },
    67: { descricao: "Chuva congelante forte", icone: "🌧️" },
    71: { descricao: "Neve leve", icone: "🌨️" },
    73: { descricao: "Neve moderada", icone: "🌨️" },
    75: { descricao: "Neve intensa", icone: "❄️" },
    77: { descricao: "Grãos de neve", icone: "❄️" },
    80: { descricao: "Pancadas de chuva leves", icone: "🌦️" },
    81: { descricao: "Pancadas de chuva moderadas", icone: "🌧️" },
    82: { descricao: "Pancadas de chuva violentas", icone: "⛈️" },
    85: { descricao: "Pancadas de neve leves", icone: "🌨️" },
    86: { descricao: "Pancadas de neve fortes", icone: "❄️" },
    95: { descricao: "Trovoada", icone: "⛈️" },
    96: { descricao: "Trovoada com granizo leve", icone: "⛈️" },
    99: { descricao: "Trovoada com granizo forte", icone: "⛈️" }
};

function arredondar(valor, casas = 1) {
    if (valor === null || valor === undefined || valor === "") return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? Number(numero.toFixed(casas)) : null;
}

function descreverCondicaoMeteorologica(codigo) {
    if (codigo === null || codigo === undefined || codigo === "") {
        return { codigo: null, descricao: "Condição não informada", icone: "🌡️" };
    }
    const numero = Number(codigo);
    const condicao = CONDICOES_WMO[numero];
    return condicao
        ? { codigo: numero, ...condicao }
        : { codigo: numero, descricao: "Condição meteorológica não identificada", icone: "🌡️" };
}

function obterDataHoraLocalBahia(valor) {
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return null;

    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_HORARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23"
    }).formatToParts(data);
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));

    return {
        data: `${valores.year}-${valores.month}-${valores.day}`,
        hora: `${valores.hour}:00`,
        chaveHora: `${valores.year}-${valores.month}-${valores.day}T${valores.hour}:00`
    };
}

function extrairDadosMeteorologicosHorarios(resposta) {
    const hourly = resposta?.hourly;
    const tempos = hourly?.time;
    const temperaturas = hourly?.temperature_2m;

    if (!Array.isArray(tempos) || !Array.isArray(temperaturas) || tempos.length !== temperaturas.length) {
        throw new Error("A API meteorológica não retornou uma série horária de temperatura válida.");
    }

    const campos = {
        sensacaoC: hourly.apparent_temperature,
        umidadePct: hourly.relative_humidity_2m,
        precipitacaoMm: hourly.precipitation,
        codigoTempo: hourly.weather_code,
        ventoKmh: hourly.wind_speed_10m
    };

    return tempos.map((tempo, indice) => {
        const dataHora = String(tempo);
        const codigoTempo = Array.isArray(campos.codigoTempo) ? campos.codigoTempo[indice] : null;
        const condicao = descreverCondicaoMeteorologica(codigoTempo);
        return {
            data: dataHora.slice(0, 10),
            hora: dataHora.slice(11, 16),
            temperaturaC: arredondar(temperaturas[indice]),
            sensacaoC: Array.isArray(campos.sensacaoC) ? arredondar(campos.sensacaoC[indice]) : null,
            umidadePct: Array.isArray(campos.umidadePct) ? arredondar(campos.umidadePct[indice], 0) : null,
            precipitacaoMm: Array.isArray(campos.precipitacaoMm) ? arredondar(campos.precipitacaoMm[indice]) : null,
            ventoKmh: Array.isArray(campos.ventoKmh) ? arredondar(campos.ventoKmh[indice]) : null,
            codigoTempo: condicao.codigo,
            condicao: condicao.descricao,
            icone: condicao.icone
        };
    });
}

// Mantida para compatibilidade com os testes e eventuais usos internos anteriores.
function extrairTemperaturasHorarias(resposta) {
    return extrairDadosMeteorologicosHorarios(resposta).map(item => ({
        hora: item.hora,
        temperaturaC: item.temperaturaC
    }));
}

function encontrarTemperatura(resposta, chaveHora) {
    const tempos = resposta?.hourly?.time;
    const temperaturas = resposta?.hourly?.temperature_2m;
    if (!Array.isArray(tempos) || !Array.isArray(temperaturas)) return null;

    const indice = tempos.indexOf(chaveHora);
    if (indice < 0 || temperaturas[indice] === null || temperaturas[indice] === undefined) return null;
    return arredondar(temperaturas[indice]);
}

function criarChaveCache(dataISO) {
    // A versão v2 ignora documentos de falha criados pela implementação anterior.
    return `open-meteo:v2:${LATITUDE}:${LONGITUDE}:${dataISO}`;
}

async function consultarEndpoint(url) {
    if (typeof fetch !== "function") {
        throw new Error("Node.js sem fetch global. Utilize Node.js 18 ou superior.");
    }

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);

    try {
        const resposta = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controlador.signal
        });

        if (!resposta.ok) throw new Error(`API meteorológica respondeu HTTP ${resposta.status}.`);
        const dados = await resposta.json();
        if (dados?.error) throw new Error(dados.reason || "A API meteorológica recusou a consulta.");
        return dados;
    } catch (erro) {
        if (erro.name === "AbortError") throw new Error(`A consulta meteorológica excedeu ${TEMPO_LIMITE_MS / 1000} segundos.`);
        throw erro;
    } finally {
        clearTimeout(temporizador);
    }
}

function parametrosComuns() {
    return new URLSearchParams({
        latitude: String(LATITUDE),
        longitude: String(LONGITUDE),
        hourly: VARIAVEIS_HORARIAS,
        timezone: FUSO_HORARIO,
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        precipitation_unit: "mm"
    });
}

function montarUrlHistorica(base, dataISO) {
    const parametros = parametrosComuns();
    parametros.set("start_date", dataISO);
    parametros.set("end_date", dataISO);
    return `${base}?${parametros.toString()}`;
}

function obterDataAtualLocal() {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_HORARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function diasEntreDatas(dataInicial, dataFinal) {
    const inicio = Date.parse(`${dataInicial}T00:00:00Z`);
    const fim = Date.parse(`${dataFinal}T00:00:00Z`);
    return Math.round((fim - inicio) / 86400000);
}

async function consultarTemperaturaDoDia(dataISO) {
    if (LATITUDE === null || LONGITUDE === null) {
        throw new Error("Configure CLIMA_LATITUDE e CLIMA_LONGITUDE para habilitar a consulta meteorológica.");
    }
    const hoje = obterDataAtualLocal();
    const diasAtras = diasEntreDatas(dataISO, hoje);
    const fontes = [];

    // A API de previsão possui dados passados recentes; é mais adequada para hoje e últimos dias.
    if (diasAtras >= 0 && diasAtras <= 7) {
        const parametros = parametrosComuns();
        parametros.set("past_days", String(Math.max(1, diasAtras + 1)));
        parametros.set("forecast_days", "1");
        fontes.push({
            nome: "Open-Meteo Forecast API (dados passados recentes)",
            base: `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
            descricao: "Dados horários recentes do modelo meteorológico, consultados para a localidade configurada."
        });
    }

    if (Number(dataISO.slice(0, 4)) >= 2022) {
        fontes.push({
            nome: "Open-Meteo Historical Forecast API",
            base: montarUrlHistorica("https://historical-forecast-api.open-meteo.com/v1/forecast", dataISO),
            descricao: "Previsões meteorológicas arquivadas em série horária."
        });
    }

    fontes.push({
        nome: "Open-Meteo Historical Weather API",
        base: montarUrlHistorica("https://archive-api.open-meteo.com/v1/archive", dataISO),
        descricao: "Reanálise meteorológica histórica em grade."
    });

    const erros = [];
    for (const fonte of fontes) {
        try {
            const resposta = await consultarEndpoint(fonte.base);
            const dadosHora = extrairDadosMeteorologicosHorarios(resposta)
                .filter(item => item.data === dataISO);
            if (dadosHora.length === 0) throw new Error(`A fonte ${fonte.nome} não retornou horas para ${dataISO}.`);
            if (!dadosHora.some(item => item.temperaturaC !== null)) {
                throw new Error(`A fonte ${fonte.nome} retornou a data, mas sem valores de temperatura.`);
            }

            return {
                disponivel: true,
                data: dataISO,
                localidade: LOCALIDADE,
                latitude: LATITUDE,
                longitude: LONGITUDE,
                fusoHorario: FUSO_HORARIO,
                fonte: fonte.nome,
                descricaoFonte: fonte.descricao,
                temperaturas: dadosHora,
                consultadoEm: new Date()
            };
        } catch (erro) {
            erros.push(`${fonte.nome}: ${erro.message}`);
        }
    }

    const erroFinal = new Error(erros.join(" | ") || "Nenhuma fonte meteorológica disponível.");
    erroFinal.fontesTentadas = fontes.map(fonte => fonte.nome);
    throw erroFinal;
}

async function obterDadosClimaticosDoDia(dataISO, opcoes = {}) {
    if (LATITUDE === null || LONGITUDE === null) {
        return {
            disponivel: false,
            data: dataISO,
            localidade: LOCALIDADE,
            mensagem: "Configure CLIMA_LATITUDE e CLIMA_LONGITUDE no .env para habilitar os dados meteorológicos."
        };
    }
    const colecao = bancoService.obterBanco().collection("clima_historico_cache");
    const chave = criarChaveCache(dataISO);
    const agora = Date.now();
    const forcarAtualizacao = opcoes.forcarAtualizacao === true;

    if (!forcarAtualizacao) {
        try {
            const cache = await colecao.findOne({ _id: chave });
            if (cache?.consultadoEm) {
                const idade = agora - new Date(cache.consultadoEm).getTime();
                const duracaoCache = cache.disponivel ? CACHE_SUCESSO_MS : CACHE_FALHA_MS;
                if (Number.isFinite(idade) && idade >= 0 && idade < duracaoCache) return cache;
            }
        } catch (erro) {
            console.warn("[Clima] Não foi possível ler o cache meteorológico:", erro.message);
        }
    }

    try {
        const dados = await consultarTemperaturaDoDia(dataISO);
        const documento = { _id: chave, ...dados };
        try {
            const { _id, ...campos } = documento;
            await colecao.updateOne({ _id: chave }, { $set: campos }, { upsert: true });
        } catch (erro) {
            console.warn("[Clima] Não foi possível gravar o cache meteorológico:", erro.message);
        }
        return documento;
    } catch (erro) {
        console.warn(`[Clima] Não foi possível consultar ${dataISO}:`, erro.message);
        const documento = {
            _id: chave,
            disponivel: false,
            data: dataISO,
            localidade: LOCALIDADE,
            fonte: "Open-Meteo",
            consultadoEm: new Date(),
            mensagem: "Dados meteorológicos indisponíveis para esta data. Verifique a conexão com a internet e os logs do servidor.",
            diagnostico: erro.message
        };
        try {
            const { _id, ...campos } = documento;
            await colecao.updateOne({ _id: chave }, { $set: campos }, { upsert: true });
        } catch (erroCache) {
            console.warn("[Clima] Não foi possível gravar o cache de falha:", erroCache.message);
        }
        return documento;
    }
}

function formatarRegistroMeteorologico(registro, local, dia) {
    return {
        disponivel: true,
        temperaturaC: registro.temperaturaC,
        unidade: "°C",
        condicao: registro.condicao,
        icone: registro.icone,
        codigoTempo: registro.codigoTempo,
        sensacaoC: registro.sensacaoC,
        umidadePct: registro.umidadePct,
        precipitacaoMm: registro.precipitacaoMm,
        ventoKmh: registro.ventoKmh,
        horaReferencia: `${local.data} ${local.hora}`,
        localidade: dia.localidade || LOCALIDADE,
        fonte: dia.fonte,
        descricaoFonte: dia.descricaoFonte,
        observacao: "Estimativa regional por modelo meteorológico; não é medição de sensor instalado na empresa."
    };
}

async function obterTemperaturaHistorica(dataHora, opcoes = {}) {
    const local = obterDataHoraLocalBahia(dataHora);
    if (!local) throw new Error("Data e horário inválidos para consulta meteorológica.");

    const dia = await obterDadosClimaticosDoDia(local.data, opcoes);
    if (!dia?.disponivel) {
        return {
            disponivel: false,
            localidade: LOCALIDADE,
            mensagem: dia?.mensagem || "Dados meteorológicos indisponíveis para esta data.",
            diagnostico: dia?.diagnostico
        };
    }

    const registro = (dia.temperaturas || []).find(item => item.hora === local.hora);
    if (!registro || !Number.isFinite(Number(registro.temperaturaC))) {
        return {
            disponivel: false,
            localidade: dia.localidade || LOCALIDADE,
            mensagem: `A fonte meteorológica não forneceu temperatura para ${local.hora} (horário local).`
        };
    }

    return formatarRegistroMeteorologico(registro, local, dia);
}

async function executarComLimite(itens, limite, tarefa) {
    let proximo = 0;
    const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
        while (proximo < itens.length) {
            const indice = proximo++;
            await tarefa(itens[indice]);
        }
    });
    await Promise.all(trabalhadores);
}

async function enriquecerMovimentacoesComTemperatura(movimentacoes) {
    const entradasValidas = movimentacoes.filter(item =>
        item.movimento === "Entrada" && item.resultado === "Liberado" && item.dataHora
    );
    const datas = [...new Set(entradasValidas
        .map(item => obterDataHoraLocalBahia(item.dataHora)?.data)
        .filter(Boolean))];
    const dadosPorData = new Map();

    await executarComLimite(datas, 2, async dataISO => {
        dadosPorData.set(dataISO, await obterDadosClimaticosDoDia(dataISO));
    });

    return movimentacoes.map(item => {
        if (item.movimento !== "Entrada" || item.resultado !== "Liberado" || !item.dataHora) {
            return { ...item, temperatura: null };
        }

        const local = obterDataHoraLocalBahia(item.dataHora);
        const dia = local ? dadosPorData.get(local.data) : null;
        const registro = dia?.temperaturas?.find(temperatura => temperatura.hora === local.hora);

        if (!dia?.disponivel || !registro || !Number.isFinite(Number(registro.temperaturaC))) {
            return {
                ...item,
                temperatura: {
                    disponivel: false,
                    localidade: LOCALIDADE,
                    mensagem: dia?.mensagem || `Dados meteorológicos indisponíveis para ${local?.hora || "o horário da entrada"}.`,
                    diagnostico: dia?.diagnostico
                }
            };
        }

        return { ...item, temperatura: formatarRegistroMeteorologico(registro, local, dia) };
    });
}

module.exports = {
    obterTemperaturaHistorica,
    enriquecerMovimentacoesComTemperatura,
    obterDataHoraLocalBahia,
    extrairTemperaturasHorarias,
    extrairDadosMeteorologicosHorarios,
    descreverCondicaoMeteorologica,
    encontrarTemperatura,
    consultarTemperaturaDoDia,
    obterDadosClimaticosDoDia
};
