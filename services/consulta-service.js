"use strict";

const { once } = require("node:events");
const bancoService = require("./db");
const { enriquecerMovimentacoesComTemperatura } = require("./clima-service");

const FUSO_HORARIO = process.env.CLIMA_TIMEZONE || "America/Sao_Paulo";
const DURACAO_DIA = 24 * 60 * 60 * 1000;

function obterDataAtualBahia() {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_HORARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function obterMesAtualBahia() {
    return obterDataAtualBahia().slice(0, 7);
}

function validarDataISO(valor) {
    if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        throw new Error("Data inválida. Utilize o formato AAAA-MM-DD.");
    }

    const [ano, mes, dia] = valor.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));

    if (
        data.getUTCFullYear() !== ano ||
        data.getUTCMonth() !== mes - 1 ||
        data.getUTCDate() !== dia
    ) {
        throw new Error("A data informada não existe.");
    }

    return { ano, mes, dia };
}

function obterIntervaloDia(dataISO) {
    const { ano, mes, dia } = validarDataISO(dataISO);
    // Bahia utiliza UTC-3. O início local do dia corresponde a 03:00 UTC.
    const inicio = new Date(Date.UTC(ano, mes - 1, dia, 3));
    return { inicio, fim: new Date(inicio.getTime() + DURACAO_DIA) };
}

function obterIntervaloMes(mesISO) {
    if (typeof mesISO !== "string" || !/^\d{4}-\d{2}$/.test(mesISO)) {
        throw new Error("Mês inválido. Utilize o formato AAAA-MM.");
    }

    const [ano, mes] = mesISO.split("-").map(Number);
    if (mes < 1 || mes > 12) throw new Error("O mês informado não existe.");

    const inicio = new Date(Date.UTC(ano, mes - 1, 1, 3));
    const fim = new Date(Date.UTC(ano, mes, 1, 3));
    return { inicio, fim, ano, mes };
}

function formatarDataBahia(data) {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_HORARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(data);
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function obterHoraBahia(data) {
    const parte = new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO_HORARIO,
        hour: "2-digit",
        hourCycle: "h23"
    }).formatToParts(data).find(item => item.type === "hour");
    return Number(parte?.value ?? 0);
}

function obterStatusAcesso(status) {
    // Na especificação Intelbras, Status ausente também representa sucesso.
    if (status === undefined || status === null || status === "") return "liberado";
    if (Number(status) === 1) return "liberado";
    if (Number(status) === 0) return "negado";
    return "indefinido";
}

function obterTipoMovimento(tipo) {
    const valor = String(tipo ?? "").trim().toLowerCase();
    if (valor === "entry" || valor === "entrada") return "entrada";
    if (valor === "exit" || valor === "saída" || valor === "saida") return "saida";
    return "outro";
}

function criarResumoVazio() {
    return {
        totalMovimentacoes: 0,
        entradas: 0,
        saidas: 0,
        negados: 0,
        indefinidos: 0,
        funcionariosComAcesso: new Set()
    };
}

function acumularEvento(resumo, evento) {
    const situacao = obterStatusAcesso(evento?.event?.status);
    const tipo = obterTipoMovimento(evento?.event?.type);
    const userId = evento?.employee?.userId;

    resumo.totalMovimentacoes++;

    if (situacao === "liberado") {
        if (tipo === "entrada") resumo.entradas++;
        if (tipo === "saida") resumo.saidas++;
        if (userId !== null && userId !== undefined && String(userId).trim()) {
            resumo.funcionariosComAcesso.add(String(userId));
        }
    } else if (situacao === "negado") {
        resumo.negados++;
    } else {
        resumo.indefinidos++;
    }

    return { situacao, tipo, userId: userId == null ? "" : String(userId) };
}

function finalizarResumo(resumo) {
    return {
        totalMovimentacoes: resumo.totalMovimentacoes,
        entradas: resumo.entradas,
        saidas: resumo.saidas,
        negados: resumo.negados,
        indefinidos: resumo.indefinidos,
        funcionariosComAcesso: resumo.funcionariosComAcesso.size
    };
}

function consultaAcessos(inicio, fim, userId) {
    const filtro = {
        "event.code": "AccessControl",
        "timing.occurredAt": { $gte: inicio, $lt: fim }
    };

    if (userId !== undefined) filtro["employee.userId"] = String(userId);
    return filtro;
}

function projetarEvento() {
    return {
        _id: 0,
        eventKey: 0,
        "device.password": 0
    };
}

async function obterResumoDiario(dataISO) {
    const { inicio, fim } = obterIntervaloDia(dataISO);
    const eventos = bancoService.obterBanco().collection("eventos_acesso");
    const resumo = criarResumoVazio();
    const porHora = Array.from({ length: 24 }, (_, hora) => ({
        hora,
        rotulo: `${String(hora).padStart(2, "0")}h`,
        entradas: 0,
        saidas: 0,
        negados: 0,
        indefinidos: 0,
        outros: 0,
        total: 0
    }));
    const ultimosEventos = [];

    const cursor = eventos.find(consultaAcessos(inicio, fim), {
        projection: projetarEvento()
    }).sort({ "timing.occurredAt": -1 });

    for await (const evento of cursor) {
        const classificacao = acumularEvento(resumo, evento);
        const dataEvento = evento?.timing?.occurredAt;
        if (dataEvento instanceof Date && !Number.isNaN(dataEvento.getTime())) {
            const hora = obterHoraBahia(dataEvento);
            const faixa = porHora[hora];
            faixa.total++;
            if (classificacao.situacao === "negado") faixa.negados++;
            else if (classificacao.situacao === "indefinido") faixa.indefinidos++;
            else if (classificacao.tipo === "entrada") faixa.entradas++;
            else if (classificacao.tipo === "saida") faixa.saidas++;
            else faixa.outros++;
        }

        if (ultimosEventos.length < 15) {
            ultimosEventos.push(formatarEvento(evento));
        }
    }

    return {
        data: dataISO,
        resumo: finalizarResumo(resumo),
        fluxoPorHora: porHora,
        ultimosEventos
    };
}

function descreverMetodoAcesso(valor) {
    if (valor === null || valor === undefined || valor === "") return "Não informado";
    const codigo = Number(valor);
    const metodosConhecidos = {
        0: "Senha",
        1: "Cartão de acesso",
        2: "Senha ou cartão",
        3: "Cartão e depois senha",
        4: "Senha e depois cartão",
        6: "Impressão digital",
        11: "Múltiplos usuários",
        12: "Chave",
        14: "QR Code local",
        15: "Reconhecimento facial",
        17: "Cartão de identificação",
        19: "Bluetooth",
        20: "Senha personalizada",
        21: "ID do usuário e senha",
        22: "Face e senha",
        23: "Digital e senha",
        24: "Digital e face",
        25: "Cartão e face"
    };
    return Number.isInteger(codigo)
        ? metodosConhecidos[codigo] || `Código ${codigo}`
        : String(valor);
}

function formatarEvento(evento) {
    const status = obterStatusAcesso(evento?.event?.status);
    const tipo = obterTipoMovimento(evento?.event?.type);
    return {
        dataHora: evento?.timing?.occurredAt ?? null,
        userId: evento?.employee?.userId ?? "",
        nome: evento?.employee?.nome || "Pessoa não identificada",
        movimento: tipo === "entrada" ? "Entrada" : tipo === "saida" ? "Saída" : "Outro",
        resultado: status === "liberado" ? "Liberado" : status === "negado" ? "Negado" : "Indefinido",
        metodo: evento?.event?.method ?? null,
        metodoDescricao: descreverMetodoAcesso(evento?.event?.method),
        porta: evento?.event?.door ?? evento?.device?.channel ?? null
    };
}

async function obterResumoMensal(mesISO) {
    const { inicio, fim } = obterIntervaloMes(mesISO);
    const eventos = bancoService.obterBanco().collection("eventos_acesso");
    const total = criarResumoVazio();
    const dias = new Map();
    const funcionarios = new Map();

    const cursor = eventos.find(consultaAcessos(inicio, fim), {
        projection: projetarEvento()
    }).sort({ "timing.occurredAt": 1 });

    for await (const evento of cursor) {
        const classificacao = acumularEvento(total, evento);
        const dataEvento = evento?.timing?.occurredAt;
        if (!(dataEvento instanceof Date) || Number.isNaN(dataEvento.getTime())) continue;

        const chaveDia = formatarDataBahia(dataEvento);
        if (!dias.has(chaveDia)) {
            dias.set(chaveDia, {
                data: chaveDia,
                totalMovimentacoes: 0,
                entradas: 0,
                saidas: 0,
                negados: 0
            });
        }
        const dia = dias.get(chaveDia);
        dia.totalMovimentacoes++;
        if (classificacao.situacao === "negado") dia.negados++;
        if (classificacao.situacao === "liberado" && classificacao.tipo === "entrada") dia.entradas++;
        if (classificacao.situacao === "liberado" && classificacao.tipo === "saida") dia.saidas++;

        if (classificacao.userId) {
            if (!funcionarios.has(classificacao.userId)) {
                funcionarios.set(classificacao.userId, {
                    userId: classificacao.userId,
                    nome: evento?.employee?.nome || "Nome não informado",
                    entradas: 0,
                    saidas: 0,
                    negados: 0,
                    primeiraMovimentacao: dataEvento,
                    ultimaMovimentacao: dataEvento
                });
            }
            const funcionario = funcionarios.get(classificacao.userId);
            if (evento?.employee?.nome) funcionario.nome = evento.employee.nome;
            funcionario.ultimaMovimentacao = dataEvento;
            if (classificacao.situacao === "negado") funcionario.negados++;
            if (classificacao.situacao === "liberado" && classificacao.tipo === "entrada") funcionario.entradas++;
            if (classificacao.situacao === "liberado" && classificacao.tipo === "saida") funcionario.saidas++;
        }
    }

    return {
        mes: mesISO,
        resumo: finalizarResumo(total),
        porDia: Array.from(dias.values()).sort((a, b) => a.data.localeCompare(b.data)),
        porFuncionario: Array.from(funcionarios.values()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    };
}

async function listarFuncionarios(busca = "") {
    const banco = bancoService.obterBanco();
    const colecaoFuncionarios = banco.collection("funcionarios");
    const colecaoEventos = banco.collection("eventos_acesso");
    const filtro = {};

    if (busca.trim()) {
        const termo = busca.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filtro.$or = [
            { nome: { $regex: termo, $options: "i" } },
            { userId: { $regex: termo, $options: "i" } }
        ];
    }

    const [cadastros, totais] = await Promise.all([
        colecaoFuncionarios.find(filtro, {
            projection: { _id: 0, userId: 1, nome: 1, ativo: 1, createdAt: 1, updatedAt: 1, permissaoDispositivo: 1, validadeDispositivo: 1, origemCadastro: 1, dispositivo: 1, sincronizadoEm: 1 }
        }).sort({ nome: 1, userId: 1 }).limit(500).toArray(),
        colecaoEventos.aggregate([
            { $match: { "event.code": "AccessControl", "employee.userId": { $exists: true, $nin: [null, ""] } } },
            { $group: {
                _id: "$employee.userId",
                totalMovimentacoes: { $sum: 1 },
                ultimaMovimentacao: { $max: "$timing.occurredAt" }
            } }
        ]).toArray()
    ]);

    const porId = new Map(totais.map(item => [String(item._id), item]));
    return cadastros.map(funcionario => {
        const total = porId.get(String(funcionario.userId));
        return {
            ...funcionario,
            totalMovimentacoes: total?.totalMovimentacoes ?? 0,
            ultimaMovimentacao: total?.ultimaMovimentacao ?? null
        };
    });
}

const DIAS_SEMANA_BAHIA = [
    { chave: "Mon", dia: "Segunda-feira" },
    { chave: "Tue", dia: "Terça-feira" },
    { chave: "Wed", dia: "Quarta-feira" },
    { chave: "Thu", dia: "Quinta-feira" },
    { chave: "Fri", dia: "Sexta-feira" },
    { chave: "Sat", dia: "Sábado" },
    { chave: "Sun", dia: "Domingo" }
];

function obterIndiceDiaSemanaBahia(data) {
    const abreviacao = new Intl.DateTimeFormat("en-US", {
        timeZone: FUSO_HORARIO,
        weekday: "short"
    }).format(data);
    return DIAS_SEMANA_BAHIA.findIndex(item => item.chave === abreviacao);
}

function criarContadorFrequencia(rotulo) {
    return {
        rotulo,
        total: 0,
        entradas: 0,
        saidas: 0,
        negados: 0,
        indefinidos: 0,
        outros: 0
    };
}

function acumularFrequencia(contador, classificacao) {
    contador.total++;
    if (classificacao.situacao === "negado") contador.negados++;
    else if (classificacao.situacao === "indefinido") contador.indefinidos++;
    else if (classificacao.tipo === "entrada") contador.entradas++;
    else if (classificacao.tipo === "saida") contador.saidas++;
    else contador.outros++;
}

async function obterHistoricoFuncionario(userId, inicioISO, fimISO, pagina = 1, porPagina = 25) {
    const banco = bancoService.obterBanco();
    const funcionarios = banco.collection("funcionarios");
    const eventos = banco.collection("eventos_acesso");
    const funcionario = await funcionarios.findOne(
        { userId: String(userId) },
        { projection: { _id: 0 } }
    );

    if (!funcionario) return null;

    const dataFim = fimISO || obterDataAtualBahia();
    validarDataISO(dataFim);

    // Sem data inicial, a ficha começa no primeiro evento registrado para a pessoa.
    // Isso faz com que a primeira abertura mostre o histórico completo disponível.
    let dataInicio = inicioISO;
    if (dataInicio) {
        validarDataISO(dataInicio);
    } else {
        const primeiroEvento = await eventos.find({
            "event.code": "AccessControl",
            "employee.userId": String(userId),
            "timing.occurredAt": { $lt: obterIntervaloDia(dataFim).fim }
        }, { projection: { "timing.occurredAt": 1 } })
            .sort({ "timing.occurredAt": 1 })
            .limit(1)
            .toArray();

        const primeiraData = primeiroEvento[0]?.timing?.occurredAt;
        dataInicio = primeiraData instanceof Date && !Number.isNaN(primeiraData.getTime())
            ? formatarDataBahia(primeiraData)
            : dataFim;
    }

    const { inicio } = obterIntervaloDia(dataInicio);
    const { fim } = obterIntervaloDia(dataFim);
    if (dataInicio > dataFim) throw new Error("A data inicial não pode ser posterior à data final.");

    const paginaSegura = Math.max(1, Math.min(Number.parseInt(pagina, 10) || 1, 1000000));
    const porPaginaSeguro = Math.max(1, Math.min(Number.parseInt(porPagina, 10) || 25, 100));
    const filtro = consultaAcessos(inicio, fim, userId);
    const resumo = criarResumoVazio();
    const porHora = Array.from({ length: 24 }, (_, hora) => criarContadorFrequencia(`${String(hora).padStart(2, "0")}h`));
    const porDiaSemana = DIAS_SEMANA_BAHIA.map(item => ({
        ...criarContadorFrequencia(item.dia),
        porHora: Array.from({ length: 24 }, (_, hora) => criarContadorFrequencia(`${String(hora).padStart(2, "0")}h`))
    }));
    const porData = new Map();
    let primeiraMovimentacao = null;
    let ultimaMovimentacao = null;

    // Os indicadores e as frequências consideram o período inteiro, sem limite de linhas.
    const cursorResumo = eventos.find(filtro, { projection: projetarEvento() })
        .sort({ "timing.occurredAt": 1 });

    for await (const evento of cursorResumo) {
        const classificacao = acumularEvento(resumo, evento);
        const dataEvento = evento?.timing?.occurredAt;
        if (!(dataEvento instanceof Date) || Number.isNaN(dataEvento.getTime())) continue;

        if (!primeiraMovimentacao) primeiraMovimentacao = dataEvento;
        ultimaMovimentacao = dataEvento;

        const hora = obterHoraBahia(dataEvento);
        const indiceDia = obterIndiceDiaSemanaBahia(dataEvento);
        const dataISO = formatarDataBahia(dataEvento);
        acumularFrequencia(porHora[hora], classificacao);

        if (indiceDia >= 0) {
            acumularFrequencia(porDiaSemana[indiceDia], classificacao);
            acumularFrequencia(porDiaSemana[indiceDia].porHora[hora], classificacao);
        }

        if (!porData.has(dataISO)) {
            porData.set(dataISO, {
                data: dataISO,
                ...criarContadorFrequencia(dataISO)
            });
        }
        acumularFrequencia(porData.get(dataISO), classificacao);
    }

    const totalRegistros = resumo.totalMovimentacoes;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / porPaginaSeguro));
    const paginaFinal = Math.min(paginaSegura, totalPaginas);
    const cursorHistorico = eventos.find(filtro, { projection: projetarEvento() })
        .sort({ "timing.occurredAt": -1 })
        .skip((paginaFinal - 1) * porPaginaSeguro)
        .limit(porPaginaSeguro);
    const historico = [];

    for await (const evento of cursorHistorico) {
        historico.push(formatarEvento(evento));
    }

    // A temperatura é adicionada apenas a entradas liberadas e apenas na página exibida.
    // O serviço meteorológico usa cache diário para evitar chamadas repetidas.
    const historicoComTemperatura = await enriquecerMovimentacoesComTemperatura(historico);

    return {
        funcionario,
        periodo: { inicio: dataInicio, fim: dataFim },
        resumo: finalizarResumo(resumo),
        primeiraMovimentacao,
        ultimaMovimentacao,
        frequencia: {
            porHora,
            porDiaSemana,
            porData: Array.from(porData.values()).sort((a, b) => a.data.localeCompare(b.data))
        },
        movimentacoes: historicoComTemperatura,
        paginacao: {
            pagina: paginaFinal,
            porPagina: porPaginaSeguro,
            totalRegistros,
            totalPaginas,
            temAnterior: paginaFinal > 1,
            temProxima: paginaFinal < totalPaginas
        }
    };
}

async function exportarEventosMensaisCSV(mesISO, res) {
    const { inicio, fim } = obterIntervaloMes(mesISO);
    const cursor = bancoService.obterBanco().collection("eventos_acesso")
        .find(consultaAcessos(inicio, fim), { projection: projetarEvento() })
        .sort({ "timing.occurredAt": 1 });

    const escapar = valor => {
        let texto = valor === null || valor === undefined ? "" : String(valor);
        // Evita que valores controlados por cadastros sejam interpretados como fórmulas pelo Excel.
        if (/^\s*[=+@-]/.test(texto)) texto = `'${texto}`;
        return `"${texto.replace(/"/g, '""')}"`;
    };
    const linha = valores => `${valores.map(escapar).join(";")}\r\n`;
    const escrever = async conteudo => {
        if (!res.write(conteudo)) await once(res, "drain");
    };

    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="relatorio-acessos-${mesISO}.csv"`);
    await escrever("\uFEFF");
    await escrever(linha(["Data", "Horário", "ID do funcionário", "Nome", "Movimentação", "Resultado", "Método de autenticação", "Porta/canal"]));

    for await (const evento of cursor) {
        const detalhe = formatarEvento(evento);
        const dataHora = detalhe.dataHora ? new Date(detalhe.dataHora) : null;
        const data = dataHora ? formatarDataBahia(dataHora) : "";
        const horario = dataHora ? new Intl.DateTimeFormat("pt-BR", {
            timeZone: FUSO_HORARIO,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).format(dataHora) : "";
        await escrever(linha([
            data,
            horario,
            detalhe.userId,
            detalhe.nome,
            detalhe.movimento,
            detalhe.resultado,
            detalhe.metodoDescricao,
            detalhe.porta
        ]));
    }

    res.end();
}

module.exports = {
    obterDataAtualBahia,
    obterMesAtualBahia,
    obterResumoDiario,
    obterResumoMensal,
    listarFuncionarios,
    obterHistoricoFuncionario,
    exportarEventosMensaisCSV,
    formatarEvento,
    descreverMetodoAcesso,
    obterStatusAcesso,
    obterTipoMovimento,
    formatarDataBahia,
    obterHoraBahia,
    obterIntervaloDia,
    obterIntervaloMes,
    obterIndiceDiaSemanaBahia,
    DIAS_SEMANA_BAHIA
};
