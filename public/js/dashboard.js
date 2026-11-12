"use strict";

const TZ = "America/Bahia";
const $ = seletor => document.querySelector(seletor);
const $$ = seletor => Array.from(document.querySelectorAll(seletor));

let abaAtiva = "diario";
let funcionarioSelecionado = null;
let funcionariosCarregados = [];
let paginaHistorico = 1;
let sessaoBiometria = { canalSeguro: false, administradorConfigurado: false, autenticado: false, usuario: null, dispositivoConfigurado: false };
let ocorrenciasFaciais = [];
let funcionariosParaAssociacao = [];
let fotoNovoUsuarioDataUrl = null;
let streamCameraNovoUsuario = null;
const ITENS_POR_PAGINA_HISTORICO = 25;

function dataLocalISO(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
}

function mesLocalISO(data = new Date()) {
    return dataLocalISO(data).slice(0, 7);
}

function formatarNumero(valor) {
    return new Intl.NumberFormat("pt-BR").format(Number(valor) || 0);
}

function formatarData(dataISO) {
    if (!dataISO) return "—";
    if (typeof dataISO === "string" && /^\d{4}-\d{2}-\d{2}/.test(dataISO)) {
        const partes = dataISO.slice(0, 10).split("-");
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    const data = new Date(dataISO);
    if (Number.isNaN(data.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric"
    }).format(data);
}

function formatarDataHora(valor, incluirSegundos = false) {
    if (!valor) return "—";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(incluirSegundos ? { second: "2-digit" } : {}),
        hourCycle: "h23"
    }).format(data);
}

function criarCelula(texto, classe = "") {
    const celula = document.createElement("td");
    celula.textContent = texto ?? "—";
    if (classe) celula.className = classe;
    return celula;
}

function criarLinhaVazia(colunas, mensagem) {
    const linha = document.createElement("tr");
    const celula = criarCelula(mensagem, "empty-cell");
    celula.colSpan = colunas;
    linha.appendChild(celula);
    return linha;
}

async function buscarJSON(url) {
    const resposta = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin"
    });

    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || dados.sucesso === false) {
        throw new Error(dados.mensagem || `Falha na consulta (HTTP ${resposta.status}).`);
    }
    return dados;
}

async function enviarJSON(url, metodo, corpo) {
    const resposta = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || dados.sucesso === false) {
        throw new Error(dados.mensagem || `Falha na solicitação (HTTP ${resposta.status}).`);
    }
    return dados;
}

async function verificarServidor() {
    const indicador = $("#statusSistema");
    try {
        const dados = await buscarJSON("/api/status");
        indicador.classList.add("online");
        indicador.classList.remove("offline");
        indicador.innerHTML = '<span class="status-dot"></span> Sistema conectado';
        $("#dataAtual").textContent = new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "full",
            timeZone: TZ
        }).format(new Date());
        return dados;
    } catch (erro) {
        console.error("Falha ao verificar o servidor:", erro);
        indicador.classList.add("offline");
        indicador.classList.remove("online");
        indicador.textContent = "Servidor indisponível";
        return null;
    }
}

function alternarAba(nome) {
    if (nome !== "novo-usuario") pararCameraNovoUsuario();
    abaAtiva = nome;
    $$(".tab-button").forEach(botao => {
        const selecionado = botao.dataset.tab === nome;
        botao.classList.toggle("active", selecionado);
        botao.setAttribute("aria-selected", String(selecionado));
    });

    $$(".tab-panel").forEach(painel => {
        const selecionado = painel.dataset.panel === nome;
        painel.hidden = !selecionado;
        painel.classList.toggle("active", selecionado);
    });

    carregarAbaAtiva();
}

async function carregarMovimentacaoDiaria() {
    const data = $("#filtroDataDia").value || dataLocalISO();
    $("#statusDiario").textContent = "Consultando os registros...";
    $("#hourlyChart").replaceChildren();
    $("#tabelaDiaria").replaceChildren(criarLinhaVazia(5, "Carregando registros..."));

    try {
        const dados = await buscarJSON(`/api/dashboard/resumo?data=${encodeURIComponent(data)}`);
        const resumo = dados.resumo;
        $("#diaTotal").textContent = formatarNumero(resumo.totalMovimentacoes);
        $("#diaEntradas").textContent = formatarNumero(resumo.entradas);
        $("#diaSaidas").textContent = formatarNumero(resumo.saidas);
        $("#diaNegados").textContent = formatarNumero(resumo.negados);
        $("#statusDiario").textContent = `${formatarData(data)} · ${formatarNumero(resumo.funcionariosComAcesso)} funcionários com acesso liberado`;

        desenharGraficoHorario(dados.fluxoPorHora || []);
        preencherTabelaDiaria(dados.ultimosEventos || []);
    } catch (erro) {
        console.error("Erro ao carregar movimentação diária:", erro);
        $("#statusDiario").textContent = erro.message;
        $("#hourlyChart").replaceChildren(criarMensagem("Não foi possível carregar o gráfico."));
        $("#tabelaDiaria").replaceChildren(criarLinhaVazia(5, "Não foi possível consultar os eventos."));
    }
}

function criarMensagem(texto) {
    const mensagem = document.createElement("p");
    mensagem.className = "empty-message";
    mensagem.textContent = texto;
    return mensagem;
}

function desenharGraficoHorario(faixas, seletor = "#hourlyChart") {
    const container = $(seletor);
    container.replaceChildren();

    const obterTotalFaixa = faixa => Number(faixa.total) ||
        (faixa.entradas || 0) + (faixa.saidas || 0) + (faixa.negados || 0) + (faixa.indefinidos || 0) + (faixa.outros || 0);
    if (!faixas.length || !faixas.some(faixa => obterTotalFaixa(faixa) > 0)) {
        container.appendChild(criarMensagem("Não há dados de movimentação para o período selecionado."));
        return;
    }

    const maior = Math.max(1, ...faixas.map(obterTotalFaixa));

    faixas.forEach(faixa => {
        const total = obterTotalFaixa(faixa);
        const coluna = document.createElement("div");
        coluna.className = "hour-column";
        coluna.title = `${faixa.rotulo}: ${faixa.entradas || 0} entradas, ${faixa.saidas || 0} saídas, ${faixa.negados || 0} negadas, ${(faixa.outros || 0) + (faixa.indefinidos || 0)} outros/indefinidos`;

        const valor = document.createElement("span");
        valor.className = "hour-value";
        valor.textContent = total ? formatarNumero(total) : "";

        const trilho = document.createElement("div");
        trilho.className = "hour-track";
        const barra = document.createElement("div");
        barra.className = "hour-stack";
        barra.style.height = `${total ? Math.max(3, (total / maior) * 100) : 0}%`;

        [
            ["entry", faixa.entradas || 0],
            ["exit", faixa.saidas || 0],
            ["denied", faixa.negados || 0],
            ["other", (faixa.outros || 0) + (faixa.indefinidos || 0)]
        ].forEach(([tipo, quantidade]) => {
            if (!quantidade) return;
            const segmento = document.createElement("span");
            segmento.className = `hour-segment ${tipo}`;
            segmento.style.flexGrow = quantidade;
            segmento.title = `${quantidade} ${tipo === "entry" ? "entradas" : tipo === "exit" ? "saídas" : tipo === "denied" ? "negadas" : "outros/indefinidos"}`;
            barra.appendChild(segmento);
        });

        trilho.appendChild(barra);
        const rotulo = document.createElement("span");
        rotulo.className = "hour-label";
        const horaNumerica = Number.isFinite(Number(faixa.hora)) ? Number(faixa.hora) : Number.parseInt(faixa.rotulo, 10);
        rotulo.textContent = Number.isFinite(horaNumerica) && horaNumerica % 3 === 0 ? faixa.rotulo : "";
        coluna.append(valor, trilho, rotulo);
        container.appendChild(coluna);
    });
}

function preencherTabelaDiaria(eventos) {
    const tabela = $("#tabelaDiaria");
    tabela.replaceChildren();

    if (!eventos.length) {
        tabela.appendChild(criarLinhaVazia(5, "Nenhuma movimentação encontrada nesta data."));
        return;
    }

    eventos.forEach(evento => {
        const linha = document.createElement("tr");
        linha.append(
            criarCelula(formatarDataHora(evento.dataHora, true)),
            criarCelula(evento.nome),
            criarCelula(evento.userId || "—"),
            criarCelula(evento.movimento),
            criarCelula(evento.resultado, `status-cell ${evento.resultado === "Liberado" ? "success" : evento.resultado === "Negado" ? "danger" : "neutral"}`)
        );
        tabela.appendChild(linha);
    });
}

async function carregarRelatorioMensal() {
    const mes = $("#filtroMes").value || mesLocalISO();
    $("#statusMensal").textContent = "Consultando o mês selecionado...";
    $("#btnExportarCSV").href = `/api/relatorios/mensal/csv?mes=${encodeURIComponent(mes)}`;
    $("#tabelaMensalFuncionarios").replaceChildren(criarLinhaVazia(7, "Carregando relatório..."));
    $("#tabelaMensalDias").replaceChildren(criarLinhaVazia(5, "Carregando relatório..."));

    try {
        const dados = await buscarJSON(`/api/relatorios/mensal?mes=${encodeURIComponent(mes)}`);
        const resumo = dados.resumo;
        $("#mesTotal").textContent = formatarNumero(resumo.totalMovimentacoes);
        $("#mesEntradas").textContent = formatarNumero(resumo.entradas);
        $("#mesSaidas").textContent = formatarNumero(resumo.saidas);
        $("#mesNegados").textContent = formatarNumero(resumo.negados);
        $("#mesFuncionarios").textContent = `${formatarNumero(dados.porFuncionario.length)} funcionários`;
        $("#statusMensal").textContent = `Relatório de ${mes} carregado.`;
        preencherTabelaMensalFuncionarios(dados.porFuncionario || []);
        preencherTabelaMensalDias(dados.porDia || []);
    } catch (erro) {
        console.error("Erro ao carregar relatório mensal:", erro);
        $("#statusMensal").textContent = erro.message;
        $("#tabelaMensalFuncionarios").replaceChildren(criarLinhaVazia(7, "Não foi possível consultar o relatório."));
        $("#tabelaMensalDias").replaceChildren(criarLinhaVazia(5, "Não foi possível consultar o relatório."));
    }
}

function preencherTabelaMensalFuncionarios(funcionarios) {
    const tabela = $("#tabelaMensalFuncionarios");
    tabela.replaceChildren();

    if (!funcionarios.length) {
        tabela.appendChild(criarLinhaVazia(7, "Nenhuma movimentação de funcionário encontrada neste mês."));
        return;
    }

    funcionarios.forEach(funcionario => {
        const linha = document.createElement("tr");
        linha.append(
            criarCelula(funcionario.nome),
            criarCelula(funcionario.userId),
            criarCelula(formatarNumero(funcionario.entradas)),
            criarCelula(formatarNumero(funcionario.saidas)),
            criarCelula(formatarNumero(funcionario.negados)),
            criarCelula(formatarDataHora(funcionario.primeiraMovimentacao)),
            criarCelula(formatarDataHora(funcionario.ultimaMovimentacao))
        );
        tabela.appendChild(linha);
    });
}

function preencherTabelaMensalDias(dias) {
    const tabela = $("#tabelaMensalDias");
    tabela.replaceChildren();

    if (!dias.length) {
        tabela.appendChild(criarLinhaVazia(5, "Nenhum evento encontrado neste mês."));
        return;
    }

    dias.forEach(dia => {
        const linha = document.createElement("tr");
        linha.append(
            criarCelula(formatarData(dia.data)),
            criarCelula(formatarNumero(dia.totalMovimentacoes)),
            criarCelula(formatarNumero(dia.entradas)),
            criarCelula(formatarNumero(dia.saidas)),
            criarCelula(formatarNumero(dia.negados))
        );
        tabela.appendChild(linha);
    });
}

async function carregarFuncionarios() {
    const termo = $("#buscaFuncionario").value.trim();
    $("#statusFuncionarios").textContent = "Consultando cadastros...";
    const lista = $("#listaFuncionarios");
    lista.replaceChildren(criarMensagem("Carregando funcionários..."));

    try {
        const dados = await buscarJSON(`/api/funcionarios?busca=${encodeURIComponent(termo)}`);
        funcionariosCarregados = dados.funcionarios || [];
        lista.replaceChildren();
        $("#statusFuncionarios").textContent = `${formatarNumero(dados.quantidade)} cadastro(s) encontrado(s).`;

        if (!funcionariosCarregados.length) {
            lista.appendChild(criarMensagem("Nenhum funcionário encontrado."));
            return;
        }

        funcionariosCarregados.forEach(funcionario => {
            const botao = document.createElement("button");
            botao.type = "button";
            botao.className = "employee-list-item";
            botao.classList.toggle("selected", funcionarioSelecionado === String(funcionario.userId));
            botao.addEventListener("click", () => selecionarFuncionario(funcionario));

            const avatar = document.createElement("span");
            avatar.className = "employee-mini-avatar";
            avatar.textContent = String(funcionario.nome || funcionario.userId || "?").trim().charAt(0).toUpperCase();

            const texto = document.createElement("span");
            texto.className = "employee-list-copy";
            const nome = document.createElement("strong");
            nome.textContent = funcionario.nome || "Nome não informado";
            const id = document.createElement("small");
            id.textContent = `ID ${funcionario.userId} · ${formatarNumero(funcionario.totalMovimentacoes)} movimentações`;
            const permissao = document.createElement("small");
            permissao.className = "employee-device-role";
            const codigoPermissao = Number(funcionario.permissaoDispositivo?.codigo);
            permissao.textContent = codigoPermissao === 1
                ? "Administrador no terminal Intelbras"
                : codigoPermissao === 2
                    ? "Usuário comum no terminal"
                    : "Permissão do terminal não importada";
            texto.append(nome, id, permissao);

            const seta = document.createElement("span");
            seta.className = "employee-chevron";
            seta.textContent = "›";
            botao.append(avatar, texto, seta);
            lista.appendChild(botao);
        });
    } catch (erro) {
        console.error("Erro ao carregar funcionários:", erro);
        $("#statusFuncionarios").textContent = erro.message;
        lista.replaceChildren(criarMensagem("Não foi possível consultar os cadastros."));
    }
}

function obterSituacaoValidade(funcionario) {
    if (funcionario.ativo === false) return "Cadastro desativado no sistema";

    const validade = funcionario.validadeDispositivo || {};
    const hoje = dataLocalISO();
    const inicio = validade.inicio ? String(validade.inicio).slice(0, 10) : "";
    const fim = validade.fim ? String(validade.fim).slice(0, 10) : "";

    if (inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && inicio > hoje) {
        return "Validade ainda não iniciada";
    }
    if (fim && /^\d{4}-\d{2}-\d{2}$/.test(fim) && fim < hoje) {
        return "Validade expirada";
    }
    if (inicio || fim) return "Validade vigente conforme backup";
    return "Validade não informada no backup";
}

async function selecionarFuncionario(funcionario) {
    funcionarioSelecionado = String(funcionario.userId);
    paginaHistorico = 1;
    $$(".employee-list-item").forEach(botao => {
        const idTexto = botao.querySelector("small")?.textContent || "";
        botao.classList.toggle("selected", idTexto.startsWith(`ID ${funcionarioSelecionado} ·`));
    });

    $("#funcionarioVazio").hidden = true;
    $("#detalheFuncionario").hidden = false;
    $("#nomeFuncionario").textContent = funcionario.nome || "Nome não informado";
    $("#idFuncionario").textContent = `ID Intelbras: ${funcionario.userId}`;
    $("#avatarFuncionario").textContent = String(funcionario.nome || funcionario.userId).trim().charAt(0).toUpperCase();
    $("#statusCadastro").textContent = funcionario.ativo === false
        ? "Cadastro local: inativo"
        : "Cadastro local: ativo";
    $("#dataCadastro").textContent = funcionario.createdAt
        ? `Incluído no sistema em ${formatarData(funcionario.createdAt)}`
        : "Data de inclusão no sistema não informada";

    const codigoPermissao = Number(funcionario.permissaoDispositivo?.codigo);
    $("#permissaoDispositivo").textContent = codigoPermissao === 1
        ? "Permissão no terminal: Administrador"
        : codigoPermissao === 2
            ? "Permissão no terminal: Usuário comum"
            : "Permissão no terminal: Não importada";

    const validade = funcionario.validadeDispositivo || {};
    const formatarValidade = valor => {
        if (!valor) return "não informada";
        const texto = String(valor);
        const data = texto.slice(0, 10);
        const hora = texto.length > 10 ? texto.slice(11, 16) : "";
        return `${formatarData(data)}${hora ? ` ${hora}` : ""}`;
    };
    $("#validadeFuncionario").textContent = `Validade no terminal: ${formatarValidade(validade.inicio)} até ${formatarValidade(validade.fim)}`;
    $("#statusValidadeFuncionario").textContent = obterSituacaoValidade(funcionario);
    $("#numeroSerieTerminal").textContent = `Número de série: ${funcionario.dispositivo?.numeroSerie || "não informado"}`;
    $("#origemCadastroFuncionario").textContent = `Origem: ${funcionario.origemCadastro === "backup_intelbras" ? "Backup Intelbras" : funcionario.origemCadastro || "não informada"}`;
    const situacaoTerminal = String(funcionario.situacaoTerminal || "").toLowerCase();
    $("#situacaoTerminalFuncionario").textContent = situacaoTerminal === "congelado"
        ? "Situação no terminal: bloqueado/congelado"
        : situacaoTerminal === "normal"
            ? "Situação no terminal: normal"
            : "Situação no terminal: não sincronizada";
    const statusFace = String(funcionario.biometria?.fotoFacial || "").toLowerCase();
    $("#statusFaceFuncionario").textContent = statusFace === "cadastrada"
        ? "Cadastro facial: cadastrado"
        : statusFace === "pendente"
            ? "Cadastro facial: pendente de envio"
            : "Cadastro facial: não informado";
    $("#primeiraMovimentacaoFuncionario").textContent = "Primeira movimentação no período: —";
    $("#ultimaMovimentacaoFuncionario").textContent = "Última movimentação no período: —";
    atualizarControlesCadastroFacial();

    // Cada novo funcionário abre com todo o histórico disponível.
    $("#historicoInicio").value = "";
    $("#historicoFim").value = "";
    await carregarHistoricoFuncionario(true);
}

async function carregarHistoricoFuncionario(reiniciarPagina = true) {
    if (!funcionarioSelecionado) return;
    if (reiniciarPagina) paginaHistorico = 1;

    const inicio = $("#historicoInicio").value;
    const fim = $("#historicoFim").value;
    const tabela = $("#tabelaHistoricoFuncionario");
    tabela.replaceChildren(criarLinhaVazia(6, "Consultando movimentações..."));
    $("#statusHistorico").textContent = "Carregando histórico completo e indicadores...";

    if (inicio && fim && inicio > fim) {
        $("#statusHistorico").textContent = "A data inicial não pode ser posterior à data final.";
        tabela.replaceChildren(criarLinhaVazia(6, "Corrija o período selecionado."));
        return;
    }

    try {
        const params = new URLSearchParams();
        if (inicio) params.set("inicio", inicio);
        if (fim) params.set("fim", fim);
        params.set("pagina", String(paginaHistorico));
        params.set("porPagina", String(ITENS_POR_PAGINA_HISTORICO));
        const dados = await buscarJSON(`/api/funcionarios/${encodeURIComponent(funcionarioSelecionado)}/movimentacoes?${params}`);
        const resumo = dados.resumo;
        const paginacao = dados.paginacao || {
            pagina: 1,
            porPagina: dados.movimentacoes?.length || ITENS_POR_PAGINA_HISTORICO,
            totalRegistros: resumo.totalMovimentacoes,
            totalPaginas: 1,
            temAnterior: false,
            temProxima: false
        };

        paginaHistorico = paginacao.pagina;
        $("#funcTotal").textContent = formatarNumero(resumo.totalMovimentacoes);
        $("#funcEntradas").textContent = formatarNumero(resumo.entradas);
        $("#funcSaidas").textContent = formatarNumero(resumo.saidas);
        $("#funcNegados").textContent = formatarNumero(resumo.negados);

        // Exibe o intervalo efetivamente usado pelo servidor, inclusive no modo "todo o histórico".
        if (!$("#historicoInicio").value) $("#historicoInicio").value = dados.periodo.inicio;
        if (!$("#historicoFim").value) $("#historicoFim").value = dados.periodo.fim;

        $("#primeiraMovimentacaoFuncionario").textContent = `Primeira movimentação no período: ${dados.primeiraMovimentacao ? formatarDataHora(dados.primeiraMovimentacao, true) : "nenhuma"}`;
        $("#ultimaMovimentacaoFuncionario").textContent = `Última movimentação no período: ${dados.ultimaMovimentacao ? formatarDataHora(dados.ultimaMovimentacao, true) : "nenhuma"}`;

        const inicioLinha = paginacao.totalRegistros
            ? ((paginacao.pagina - 1) * paginacao.porPagina) + 1
            : 0;
        const fimLinha = Math.min(paginacao.pagina * paginacao.porPagina, paginacao.totalRegistros);
        $("#statusHistorico").textContent = `Período: ${formatarData(dados.periodo.inicio)} até ${formatarData(dados.periodo.fim)} · ${formatarNumero(paginacao.totalRegistros)} registro(s) no período.`;
        atualizarControlesPaginacao(paginacao, inicioLinha, fimLinha);
        preencherHistoricoFuncionario(dados.movimentacoes || []);
        preencherFrequenciaFuncionario(dados.frequencia || {});
    } catch (erro) {
        console.error("Erro ao consultar histórico individual:", erro);
        $("#statusHistorico").textContent = erro.message;
        tabela.replaceChildren(criarLinhaVazia(6, "Não foi possível carregar o histórico."));
        $("#frequenciaHorario").replaceChildren(criarMensagem("Não foi possível carregar a frequência."));
        $("#frequenciaSemana").replaceChildren(criarMensagem("Não foi possível carregar a frequência."));
        $("#mapaDiaHora").replaceChildren(criarMensagem("Não foi possível carregar a frequência."));
        $("#tabelaFrequenciaData").replaceChildren(criarLinhaVazia(5, "Não foi possível carregar a frequência."));
    }
}

function atualizarControlesPaginacao(paginacao, inicio, fim) {
    const texto = paginacao.totalRegistros
        ? `Exibindo ${formatarNumero(inicio)}–${formatarNumero(fim)} de ${formatarNumero(paginacao.totalRegistros)} · Página ${paginacao.pagina} de ${paginacao.totalPaginas}`
        : "Nenhum registro no período selecionado.";

    ["#resumoPaginacaoHistorico", "#resumoPaginacaoHistoricoRodape"].forEach(seletor => {
        $(seletor).textContent = texto;
    });
    ["#btnHistoricoAnterior", "#btnHistoricoAnteriorRodape"].forEach(seletor => {
        $(seletor).disabled = !paginacao.temAnterior;
    });
    ["#btnHistoricoProxima", "#btnHistoricoProximaRodape"].forEach(seletor => {
        $(seletor).disabled = !paginacao.temProxima;
    });
}

function preencherFrequenciaFuncionario(frequencia) {
    desenharGraficoHorario(frequencia.porHora || [], "#frequenciaHorario");

    const semana = $("#frequenciaSemana");
    semana.replaceChildren();
    const dias = frequencia.porDiaSemana || [];
    if (!dias.length || !dias.some(dia => dia.total > 0)) {
        semana.appendChild(criarMensagem("Não há movimentações no período selecionado."));
    } else {
        const maior = Math.max(1, ...dias.map(dia => dia.total || 0));
        dias.forEach(dia => {
            const linha = document.createElement("div");
            linha.className = "weekday-row";
            const topo = document.createElement("div");
            topo.className = "weekday-row-heading";
            const nome = document.createElement("strong");
            nome.textContent = dia.rotulo;
            const total = document.createElement("span");
            total.textContent = formatarNumero(dia.total);
            topo.append(nome, total);

            const trilho = document.createElement("div");
            trilho.className = "weekday-track";
            const barra = document.createElement("span");
            barra.className = "weekday-bar";
            barra.style.width = `${(dia.total / maior) * 100}%`;
            trilho.appendChild(barra);

            const detalhe = document.createElement("small");
            detalhe.textContent = `${formatarNumero(dia.entradas)} entradas · ${formatarNumero(dia.saidas)} saídas · ${formatarNumero(dia.negados)} negadas`;
            linha.append(topo, trilho, detalhe);
            semana.appendChild(linha);
        });
    }

    desenharMapaDiaHora(dias);

    const tabela = $("#tabelaFrequenciaData");
    tabela.replaceChildren();
    const datas = frequencia.porData || [];
    if (!datas.length) {
        tabela.appendChild(criarLinhaVazia(5, "Nenhuma movimentação encontrada no período."));
        return;
    }

    datas.forEach(dia => {
        const linha = document.createElement("tr");
        linha.append(
            criarCelula(formatarData(dia.data)),
            criarCelula(formatarNumero(dia.total)),
            criarCelula(formatarNumero(dia.entradas)),
            criarCelula(formatarNumero(dia.saidas)),
            criarCelula(formatarNumero(dia.negados))
        );
        tabela.appendChild(linha);
    });
}

function criarCelulaHistorico(texto, rotulo, classe = "") {
    const celula = criarCelula(texto, classe);
    celula.dataset.label = rotulo;
    return celula;
}

function criarCelulaTemperatura(evento) {
    const celula = document.createElement("td");
    celula.dataset.label = "Condições meteorológicas na entrada";
    celula.className = "weather-temperature-cell";

    if (evento.movimento !== "Entrada" || evento.resultado !== "Liberado") {
        celula.textContent = "—";
        celula.title = "As condições meteorológicas são exibidas somente para entradas liberadas.";
        return celula;
    }

    const clima = evento.temperatura;
    if (!clima?.disponivel || !Number.isFinite(Number(clima.temperaturaC))) {
        const valor = document.createElement("strong");
        const detalhe = document.createElement("small");
        valor.textContent = "Dados indisponíveis";
        detalhe.textContent = clima?.mensagem || "Aguardando dados meteorológicos";
        celula.append(valor, detalhe);
        celula.classList.add("weather-unavailable");
        celula.title = clima?.diagnostico || clima?.mensagem || "A fonte meteorológica não retornou dados.";
        return celula;
    }

    const valor = document.createElement("strong");
    const condicao = document.createElement("span");
    const detalhes = document.createElement("small");
    const extra = document.createElement("small");

    valor.textContent = `${Number(clima.temperaturaC).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
    condicao.className = "weather-condition";
    condicao.textContent = `${clima.icone || "🌡️"} ${clima.condicao || "Condição não informada"}`;

    const partes = [];
    const temNumero = valor => valor !== null && valor !== undefined && valor !== "" && Number.isFinite(Number(valor));
    if (temNumero(clima.sensacaoC)) {
        partes.push(`sensação ${Number(clima.sensacaoC).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} °C`);
    }
    if (temNumero(clima.umidadePct)) partes.push(`umidade ${Math.round(Number(clima.umidadePct))}%`);
    detalhes.textContent = partes.join(" · ") || `Horário ${String(clima.horaReferencia || "").slice(-5)}`;

    const extras = [];
    if (temNumero(clima.precipitacaoMm) && Number(clima.precipitacaoMm) > 0) {
        extras.push(`chuva ${Number(clima.precipitacaoMm).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`);
    }
    if (temNumero(clima.ventoKmh)) {
        extras.push(`vento ${Number(clima.ventoKmh).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} km/h`);
    }
    if (extras.length) extra.textContent = extras.join(" · ");

    const referencia = document.createElement("small");
    referencia.className = "weather-reference";
    referencia.textContent = `Referência ${String(clima.horaReferencia || "").slice(-5) || "horária"}`;

    celula.append(valor, condicao, detalhes);
    if (extras.length) celula.appendChild(extra);
    celula.appendChild(referencia);
    celula.title = `${clima.localidade || "Localidade de referência"}. ${clima.fonte || "Open-Meteo"}. ${clima.observacao || "Estimativa meteorológica regional."}`;
    celula.classList.add("weather-available");
    return celula;
}

function preencherHistoricoFuncionario(eventos) {
    const tabela = $("#tabelaHistoricoFuncionario");
    tabela.replaceChildren();

    if (!eventos.length) {
        tabela.appendChild(criarLinhaVazia(6, "Nenhuma movimentação encontrada no período."));
        return;
    }

    eventos.forEach(evento => {
        const linha = document.createElement("tr");
        linha.append(
            criarCelulaHistorico(formatarDataHora(evento.dataHora, true), "Data e horário"),
            criarCelulaHistorico(evento.movimento, "Movimentação"),
            criarCelulaHistorico(evento.resultado, "Resultado", `status-cell ${evento.resultado === "Liberado" ? "success" : evento.resultado === "Negado" ? "danger" : "neutral"}`),
            criarCelulaHistorico(evento.metodoDescricao || (evento.metodo === null ? "Não informado" : `Código ${evento.metodo}`), "Método"),
            criarCelulaHistorico(evento.porta === null ? "Não informada" : String(evento.porta), "Porta/canal"),
            criarCelulaTemperatura(evento)
        );
        tabela.appendChild(linha);
    });
}

function desenharMapaDiaHora(dias) {
    const container = $("#mapaDiaHora");
    container.replaceChildren();
    const maior = Math.max(0, ...dias.flatMap(dia => (dia.porHora || []).map(faixa => faixa.total || 0)));

    if (!maior) {
        container.appendChild(criarMensagem("Não há eventos suficientes para montar o mapa de calor."));
        return;
    }

    const tabela = document.createElement("table");
    tabela.className = "day-hour-heatmap";
    const cabecalho = document.createElement("thead");
    const linhaCabecalho = document.createElement("tr");
    const celulaVazia = document.createElement("th");
    celulaVazia.textContent = "Dia";
    linhaCabecalho.appendChild(celulaVazia);

    for (let hora = 0; hora < 24; hora++) {
        const th = document.createElement("th");
        th.textContent = hora % 3 === 0 ? `${String(hora).padStart(2, "0")}h` : "";
        th.title = `${String(hora).padStart(2, "0")}h`;
        linhaCabecalho.appendChild(th);
    }
    cabecalho.appendChild(linhaCabecalho);
    tabela.appendChild(cabecalho);

    const corpo = document.createElement("tbody");
    dias.forEach(dia => {
        const linha = document.createElement("tr");
        const rotulo = document.createElement("th");
        rotulo.textContent = dia.rotulo.replace("-feira", "");
        linha.appendChild(rotulo);
        (dia.porHora || []).forEach(faixa => {
            const celula = document.createElement("td");
            const quantidade = Number(faixa.total) || 0;
            celula.textContent = quantidade ? formatarNumero(quantidade) : "";
            celula.title = `${dia.rotulo}, ${faixa.rotulo}: ${formatarNumero(quantidade)} evento(s)`;
            if (quantidade > 0) {
                const intensidade = 0.10 + (quantidade / maior) * 0.66;
                celula.style.backgroundColor = `rgba(37, 99, 235, ${intensidade.toFixed(2)})`;
                celula.style.color = intensidade > 0.48 ? "#ffffff" : "#24406f";
            }
            linha.appendChild(celula);
        });
        corpo.appendChild(linha);
    });
    tabela.appendChild(corpo);
    container.appendChild(tabela);
}

async function carregarSessaoBiometria() {
    try {
        sessaoBiometria = await buscarJSON("/api/biometria/sessao");
    } catch (erro) {
        console.error("Não foi possível verificar a sessão biométrica:", erro);
        sessaoBiometria = { canalSeguro: false, administradorConfigurado: false, autenticado: false, usuario: null, dispositivoConfigurado: false };
    }
    atualizarInterfaceBiometria();
    atualizarControlesCadastroFacial();
    atualizarControlesNovoUsuario();
    return sessaoBiometria;
}

function atualizarInterfaceBiometria() {
    const login = $("#biometriaLogin");
    const autenticado = $("#painelBiometriaAutenticado");
    if (!login || !autenticado) return;

    const conectadoSeguro = Boolean(sessaoBiometria.canalSeguro);
    const logado = Boolean(sessaoBiometria.autenticado);
    login.hidden = logado;
    autenticado.hidden = !logado;

    const pill = $("#statusCanalBiometria");
    const mensagem = $("#mensagemCanalBiometria");
    const botaoLogin = $("#btnLoginBiometria");
    const camposLogin = [$("#usuarioBiometria"), $("#senhaBiometria")];

    pill.textContent = conectadoSeguro ? "Canal seguro" : "HTTPS necessário";
    pill.classList.toggle("online", conectadoSeguro);
    pill.classList.toggle("offline", !conectadoSeguro);

    if (!conectadoSeguro) {
        const host = window.location.hostname || "servidor-da-radio";
        mensagem.textContent = `A área biométrica exige HTTPS. Acesse https://${host}:3443 depois que o certificado TLS for instalado no servidor. No próprio computador do servidor, localhost pode ser usado para testes.`;
    } else if (!sessaoBiometria.administradorConfigurado) {
        mensagem.textContent = "A autenticação ainda não foi configurada. Defina BIOMETRIA_ADMIN_USER, BIOMETRIA_ADMIN_PASSWORD (PIN numérico de 4 dígitos ou senha de 12+ caracteres) e BIOMETRIA_SESSION_SECRET (mínimo 32 caracteres) no .env e reinicie o servidor.";
    } else {
        mensagem.textContent = "Entre com a conta administrativa exclusiva do dashboard. Ela é independente das permissões de administrador cadastradas no terminal Intelbras.";
    }

    camposLogin.forEach(campo => { campo.disabled = !conectadoSeguro || !sessaoBiometria.administradorConfigurado; });
    botaoLogin.disabled = !conectadoSeguro || !sessaoBiometria.administradorConfigurado;
    if (logado) {
        $("#usuarioBiometriaLogado").textContent = `Sessão: ${sessaoBiometria.usuario || "administrador"}`;
    }

    if (logado && !sessaoBiometria.dispositivoConfigurado) {
        $("#statusTesteIntelbras").textContent = "Configure a URL HTTPS e as credenciais Digest do terminal no .env.";
    }
    atualizarControlesNovoUsuario();
}

function atualizarControlesCadastroFacial() {
    const controles = $("#faceEnrollmentControls");
    const mensagem = $("#faceEnrollmentLoginMessage");
    const botao = $("#btnEnviarFace");
    if (!controles || !mensagem) return;

    const podeEnviar = Boolean(sessaoBiometria.autenticado && sessaoBiometria.canalSeguro && sessaoBiometria.dispositivoConfigurado && funcionarioSelecionado);
    controles.hidden = !podeEnviar;
    if (botao) botao.disabled = !podeEnviar;

    if (!sessaoBiometria.canalSeguro) {
        mensagem.textContent = "O cadastro facial só pode ser realizado por HTTPS. Acesse o painel pelo endereço HTTPS configurado no servidor.";
    } else if (!sessaoBiometria.autenticado) {
        mensagem.textContent = "Entre na área Biometria e ocorrências como administrador para habilitar esta função.";
    } else if (!sessaoBiometria.dispositivoConfigurado) {
        mensagem.textContent = "A conexão HTTPS e as credenciais Digest do terminal ainda não foram configuradas no .env.";
    } else if (!funcionarioSelecionado) {
        mensagem.textContent = "Selecione um funcionário para habilitar o envio da fotografia facial.";
    } else {
        mensagem.textContent = `Pronto para enviar a fotografia para o ID Intelbras ${funcionarioSelecionado}.`;
    }
}

async function entrarBiometria(evento) {
    evento.preventDefault();
    const status = $("#statusLoginBiometria");
    const botao = $("#btnLoginBiometria");
    status.textContent = "Validando credenciais...";
    botao.disabled = true;
    try {
        await enviarJSON("/api/biometria/login", "POST", {
            usuario: $("#usuarioBiometria").value.trim(),
            senha: $("#senhaBiometria").value
        });
        $("#senhaBiometria").value = "";
        status.textContent = "Autenticação concluída.";
        await carregarSessaoBiometria();
        await carregarFuncionariosParaAssociacao();
        await carregarOcorrenciasFaciais();
    } catch (erro) {
        status.textContent = erro.message;
    } finally {
        botao.disabled = !sessaoBiometria.canalSeguro || !sessaoBiometria.administradorConfigurado;
    }
}

async function sairBiometria() {
    try {
        await enviarJSON("/api/biometria/logout", "POST", {});
    } catch (erro) {
        console.warn("Não foi possível encerrar a sessão no servidor:", erro.message);
    }
    sessaoBiometria.autenticado = false;
    sessaoBiometria.usuario = null;
    ocorrenciasFaciais = [];
    $("#listaOcorrenciasFaciais").replaceChildren(criarMensagem("Autentique-se para consultar as ocorrências."));
    atualizarInterfaceBiometria();
    atualizarControlesCadastroFacial();
}

async function testarTerminalIntelbras() {
    const status = $("#statusTesteIntelbras");
    const botao = $("#btnTestarIntelbras");
    status.textContent = "Consultando o terminal por HTTPS...";
    botao.disabled = true;
    try {
        const dados = await buscarJSON("/api/biometria/dispositivo/teste");
        status.textContent = dados.conectado ? "Terminal Intelbras conectado e autenticado." : "Terminal não respondeu.";
    } catch (erro) {
        status.textContent = erro.message;
    } finally {
        botao.disabled = false;
    }
}

async function carregarFuncionariosParaAssociacao() {
    if (funcionariosParaAssociacao.length) return funcionariosParaAssociacao;
    try {
        const dados = await buscarJSON("/api/funcionarios?busca=");
        funcionariosParaAssociacao = dados.funcionarios || [];
        return funcionariosParaAssociacao;
    } catch (erro) {
        console.error("Não foi possível carregar funcionários para associação manual:", erro);
        return [];
    }
}

function criarCampoOcorrencia(rotulo, valor) {
    const item = document.createElement("div");
    item.className = "occurrence-meta-item";
    const titulo = document.createElement("small");
    titulo.textContent = rotulo;
    const texto = document.createElement("strong");
    texto.textContent = valor === null || valor === undefined || valor === "" ? "Não informado" : String(valor);
    item.append(titulo, texto);
    return item;
}

function criarCartaoOcorrencia(ocorrencia) {
    const card = document.createElement("article");
    card.className = "occurrence-card";

    const imagemWrap = document.createElement("div");
    imagemWrap.className = "occurrence-photo-wrap";
    const imagem = document.createElement("img");
    imagem.className = "occurrence-photo";
    imagem.src = ocorrencia.foto.url;
    imagem.alt = "Fotografia capturada durante tentativa facial não identificada";
    imagem.loading = "lazy";
    imagem.referrerPolicy = "no-referrer";
    imagem.addEventListener("error", () => {
        imagem.hidden = true;
        const falha = document.createElement("p");
        falha.className = "occurrence-photo-error";
        falha.textContent = "Fotografia indisponível ou expirada.";
        imagemWrap.appendChild(falha);
    }, { once: true });
    imagemWrap.appendChild(imagem);

    const corpo = document.createElement("div");
    corpo.className = "occurrence-card-body";
    const cabecalho = document.createElement("div");
    cabecalho.className = "occurrence-card-heading";
    const titulo = document.createElement("h4");
    titulo.textContent = formatarDataHora(ocorrencia.ocorreuEm, true);
    const status = document.createElement("span");
    status.className = `occurrence-status ${ocorrencia.review?.status === "analisada" ? "reviewed" : "pending"}`;
    status.textContent = ocorrencia.review?.status === "analisada" ? "Analisada" : "Pendente";
    cabecalho.append(titulo, status);

    const meta = document.createElement("div");
    meta.className = "occurrence-meta-grid";
    meta.append(
        criarCampoOcorrencia("Resultado", "Acesso negado"),
        criarCampoOcorrencia("Método", "Reconhecimento facial"),
        criarCampoOcorrencia("Código de erro", ocorrencia.event?.errorCode == null ? "Não informado" : String(ocorrencia.event.errorCode)),
        criarCampoOcorrencia("Terminal", ocorrencia.device?.deviceId || "Terminal da portaria")
    );

    const notaAnterior = document.createElement("p");
    notaAnterior.className = "occurrence-current-note";
    if (ocorrencia.identification?.linkedEmployeeUserId) {
        notaAnterior.textContent = `Associação manual registrada para o ID ${ocorrencia.identification.linkedEmployeeUserId}. Essa associação não foi feita por reconhecimento automático.`;
    } else {
        notaAnterior.textContent = "Pessoa ainda não identificada manualmente.";
    }

    const formulario = document.createElement("div");
    formulario.className = "occurrence-review-form";
    const labelFuncionario = document.createElement("label");
    labelFuncionario.className = "field";
    const spanFuncionario = document.createElement("span");
    spanFuncionario.textContent = "Associação manual (opcional)";
    const selectFuncionario = document.createElement("select");
    selectFuncionario.className = "occurrence-employee-select";
    const semVinculo = document.createElement("option");
    semVinculo.value = "";
    semVinculo.textContent = "Não associar a funcionário";
    selectFuncionario.appendChild(semVinculo);
    funcionariosParaAssociacao.forEach(funcionario => {
        const opcao = document.createElement("option");
        opcao.value = funcionario.userId;
        opcao.textContent = `ID ${funcionario.userId} — ${funcionario.nome || "Nome não informado"}`;
        selectFuncionario.appendChild(opcao);
    });
    selectFuncionario.value = ocorrencia.identification?.linkedEmployeeUserId || "";
    labelFuncionario.append(spanFuncionario, selectFuncionario);

    const labelNota = document.createElement("label");
    labelNota.className = "field";
    const spanNota = document.createElement("span");
    spanNota.textContent = "Observações da análise";
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.maxLength = 1000;
    textarea.placeholder = "Registre somente observações necessárias para a apuração.";
    textarea.value = ocorrencia.review?.notes || "";
    labelNota.append(spanNota, textarea);

    const acoes = document.createElement("div");
    acoes.className = "occurrence-review-actions";
    const salvar = document.createElement("button");
    salvar.type = "button";
    salvar.className = "button-secondary";
    salvar.textContent = "Salvar análise";
    const mensagem = document.createElement("small");
    mensagem.className = "occurrence-save-status";
    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "button-primary";
    atualizar.textContent = "Marcar como analisada";
    atualizar.hidden = ocorrencia.review?.status === "analisada";

    const enviarRevisao = async statusRevisao => {
        salvar.disabled = true;
        atualizar.disabled = true;
        mensagem.textContent = "Salvando revisão...";
        try {
            await enviarJSON(`/api/biometria/ocorrencias/${encodeURIComponent(ocorrencia.id)}/revisao`, "PATCH", {
                status: statusRevisao,
                observacoes: textarea.value,
                funcionarioUserId: selectFuncionario.value || null
            });
            mensagem.textContent = "Análise registrada.";
            await carregarOcorrenciasFaciais();
        } catch (erro) {
            mensagem.textContent = erro.message;
        } finally {
            salvar.disabled = false;
            atualizar.disabled = false;
        }
    };
    salvar.addEventListener("click", () => enviarRevisao("pendente"));
    atualizar.addEventListener("click", () => enviarRevisao("analisada"));
    acoes.append(salvar, atualizar, mensagem);
    formulario.append(labelFuncionario, labelNota, acoes);

    const validade = document.createElement("small");
    validade.className = "occurrence-retention";
    validade.textContent = ocorrencia.expiraEm
        ? `Descarte previsto: ${formatarData(ocorrencia.expiraEm)} (prazo de retenção automático).`
        : "Fotografia sujeita ao prazo de retenção definido pela rádio.";

    corpo.append(cabecalho, meta, notaAnterior, formulario, validade);
    card.append(imagemWrap, corpo);
    return card;
}

async function carregarOcorrenciasFaciais() {
    if (!sessaoBiometria.autenticado) return;
    const filtro = $("#filtroOcorrencias").value || "pendente";
    const lista = $("#listaOcorrenciasFaciais");
    const status = $("#statusOcorrencias");
    status.textContent = "Consultando ocorrências...";
    lista.replaceChildren(criarMensagem("Carregando fotografias..."));
    await carregarFuncionariosParaAssociacao();
    try {
        const dados = await buscarJSON(`/api/biometria/ocorrencias?status=${encodeURIComponent(filtro)}&limite=100`);
        ocorrenciasFaciais = dados.ocorrencias || [];
        status.textContent = `${formatarNumero(dados.quantidade)} ocorrência(s) encontrada(s).`;
        lista.replaceChildren();
        if (!ocorrenciasFaciais.length) {
            lista.appendChild(criarMensagem("Nenhuma tentativa facial não identificada encontrada neste filtro."));
            return;
        }
        ocorrenciasFaciais.forEach(ocorrencia => lista.appendChild(criarCartaoOcorrencia(ocorrencia)));
    } catch (erro) {
        status.textContent = erro.message;
        lista.replaceChildren(criarMensagem("Não foi possível consultar as ocorrências."));
    }
}

async function enviarCadastroFacial() {
    const arquivo = $("#arquivoFace").files?.[0];
    const status = $("#statusFaceEnrollment");
    const botao = $("#btnEnviarFace");
    if (!funcionarioSelecionado) { status.textContent = "Selecione um funcionário."; return; }
    if (!arquivo) { status.textContent = "Selecione uma fotografia."; return; }
    if (!$("#confirmacaoResponsavel").checked) { status.textContent = "Confirme a autorização e as informações aos titulares."; return; }
    if (arquivo.type !== "image/jpeg") { status.textContent = "Selecione uma imagem JPG/JPEG."; return; }

    botao.disabled = true;
    status.textContent = "Validando e enviando a fotografia ao terminal...";
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const leitor = new FileReader();
            leitor.onload = () => resolve(String(leitor.result || ""));
            leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
            leitor.readAsDataURL(arquivo);
        });
        const resposta = await enviarJSON(`/api/biometria/funcionarios/${encodeURIComponent(funcionarioSelecionado)}/face`, "POST", {
            fotoDataUrl: dataUrl,
            operacao: $("#operacaoFace").value,
            confirmacaoResponsavel: $("#confirmacaoResponsavel").checked
        });
        status.textContent = resposta.mensagem || "Fotografia enviada ao terminal.";
        $("#arquivoFace").value = "";
        $("#confirmacaoResponsavel").checked = false;
    } catch (erro) {
        status.textContent = erro.message;
    } finally {
        botao.disabled = !(sessaoBiometria.autenticado && sessaoBiometria.dispositivoConfigurado && funcionarioSelecionado);
    }
}

function pararCameraNovoUsuario() {
    if (streamCameraNovoUsuario) {
        streamCameraNovoUsuario.getTracks().forEach(trilha => trilha.stop());
        streamCameraNovoUsuario = null;
    }
    const video = $("#novoUsuarioVideo");
    if (video) video.srcObject = null;
    const btnCapturar = $("#btnCapturarCameraNovoUsuario");
    const btnParar = $("#btnPararCameraNovoUsuario");
    if (btnCapturar) { btnCapturar.hidden = true; btnCapturar.disabled = true; }
    if (btnParar) { btnParar.hidden = true; btnParar.disabled = true; }
    if (video) video.hidden = true;
    const preview = $("#novoUsuarioPreview");
    const placeholder = $("#novoUsuarioPlaceholder");
    if (preview) {
        preview.hidden = !fotoNovoUsuarioDataUrl;
        preview.src = fotoNovoUsuarioDataUrl || "";
    }
    if (placeholder) placeholder.hidden = Boolean(fotoNovoUsuarioDataUrl);
}

function atualizarControlesNovoUsuario() {
    const restricao = $("#novoUsuarioRestricao");
    const formulario = $("#novoUsuarioForm");
    if (!restricao || !formulario) return;

    const seguro = Boolean(sessaoBiometria.canalSeguro);
    const autenticado = Boolean(sessaoBiometria.autenticado);
    const dispositivo = Boolean(sessaoBiometria.dispositivoConfigurado);
    const liberado = seguro && autenticado && dispositivo;
    restricao.hidden = liberado;
    formulario.hidden = !liberado;

    const titulo = $("#novoUsuarioRestricaoTitulo");
    const mensagem = $("#novoUsuarioRestricaoMensagem");
    const botaoLogin = $("#btnIrParaBiometriaLogin");
    if (!seguro) {
        titulo.textContent = "Conexão HTTPS necessária";
        mensagem.textContent = "O cadastro de usuários e rostos exige HTTPS. No próprio TIMIDIAS, localhost pode ser usado para testes; em outros computadores, configure o certificado HTTPS do servidor.";
        botaoLogin.hidden = true;
    } else if (!autenticado) {
        titulo.textContent = "Acesso administrativo necessário";
        mensagem.textContent = "Entre na área Biometria e ocorrências com a conta administrativa do dashboard para habilitar o cadastro.";
        botaoLogin.hidden = false;
    } else if (!dispositivo) {
        titulo.textContent = "Terminal Intelbras não configurado";
        mensagem.textContent = "Configure INTELBRAS_DEVICE_URL em HTTPS, INTELBRAS_DEVICE_USER e INTELBRAS_DEVICE_PASSWORD no .env e reinicie o servidor.";
        botaoLogin.hidden = true;
    }

    const submit = $("#btnCadastrarNovoUsuario");
    if (submit && !liberado) submit.disabled = true;
}

function atualizarPreviaNovoUsuario(dataUrl) {
    fotoNovoUsuarioDataUrl = dataUrl;
    const preview = $("#novoUsuarioPreview");
    const placeholder = $("#novoUsuarioPlaceholder");
    const remover = $("#btnRemoverFotoNovoUsuario");
    if (preview) {
        preview.src = dataUrl || "";
        preview.hidden = !dataUrl;
    }
    if (placeholder) placeholder.hidden = Boolean(dataUrl);
    if (remover) remover.disabled = !dataUrl;
    const status = $("#statusFotoNovoUsuario");
    if (status) status.textContent = dataUrl
        ? "Fotografia pronta para envio ao terminal. A imagem permanece apenas na memória do navegador até o envio."
        : "Formatos aceitos: JPG, PNG ou WebP. A imagem será convertida para JPG.";
    const confirmar = $("#confirmacaoNovoUsuario");
    const submit = $("#btnCadastrarNovoUsuario");
    if (submit) submit.disabled = !(dataUrl && confirmar?.checked && sessaoBiometria.autenticado && sessaoBiometria.canalSeguro && sessaoBiometria.dispositivoConfigurado);
}

function converterImagemParaJpeg(fonte, larguraOriginal, alturaOriginal) {
    const largura = Number(larguraOriginal);
    const altura = Number(alturaOriginal);
    if (!largura || !altura || !Number.isFinite(largura) || !Number.isFinite(altura)) {
        throw new Error("Não foi possível identificar as dimensões da imagem.");
    }

    // Mantém a proporção e limita a imagem aos limites documentados para a fotografia facial.
    const escala = Math.min(600 / largura, 1200 / altura, 1);
    const larguraFinal = Math.round(largura * escala);
    const alturaFinal = Math.round(altura * escala);
    if (larguraFinal < 150 || alturaFinal < 300) {
        throw new Error("A foto precisa ter resolução suficiente para gerar pelo menos 150 × 300 pixels.");
    }

    const canvas = $("#novoUsuarioCanvas");
    canvas.width = larguraFinal;
    canvas.height = alturaFinal;
    const contexto = canvas.getContext("2d", { alpha: false });
    if (!contexto) throw new Error("Não foi possível processar a imagem neste navegador.");
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, larguraFinal, alturaFinal);
    contexto.drawImage(fonte, 0, 0, larguraFinal, alturaFinal);

    for (const qualidade of [0.9, 0.84, 0.78, 0.7, 0.62]) {
        const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
        const base64 = dataUrl.split(",", 2)[1] || "";
        if (base64.length <= 195000) return dataUrl;
    }
    throw new Error("A fotografia continua muito grande. Escolha uma imagem mais simples ou com menor resolução.");
}

async function processarArquivoNovoUsuario(arquivo) {
    const status = $("#statusFotoNovoUsuario");
    if (!arquivo) return;
    pararCameraNovoUsuario();
    if (!/^image\/(jpeg|png|webp)$/i.test(arquivo.type || "")) {
        status.textContent = "Formato não aceito. Selecione JPG, PNG ou WebP.";
        $("#novoUsuarioArquivo").value = "";
        return;
    }
    if (arquivo.size > 12 * 1024 * 1024) {
        status.textContent = "O arquivo original deve ter no máximo 12 MB.";
        $("#novoUsuarioArquivo").value = "";
        return;
    }

    status.textContent = "Preparando e validando a fotografia...";
    try {
        const objectUrl = URL.createObjectURL(arquivo);
        try {
            const imagem = await new Promise((resolve, reject) => {
                const elemento = new Image();
                elemento.onload = () => resolve(elemento);
                elemento.onerror = () => reject(new Error("Não foi possível abrir a imagem selecionada."));
                elemento.src = objectUrl;
            });
            const dataUrl = converterImagemParaJpeg(imagem, imagem.naturalWidth, imagem.naturalHeight);
            atualizarPreviaNovoUsuario(dataUrl);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    } catch (erro) {
        atualizarPreviaNovoUsuario(null);
        status.textContent = erro.message;
    }
}

async function abrirCameraNovoUsuario() {
    const status = $("#statusFotoNovoUsuario");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        status.textContent = "A câmera exige uma origem segura (HTTPS ou localhost). Use o envio de arquivo ou acesse pelo endereço HTTPS do servidor.";
        return;
    }
    limparFotoNovoUsuario();
    try {
        streamCameraNovoUsuario = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const video = $("#novoUsuarioVideo");
        video.srcObject = streamCameraNovoUsuario;
        video.hidden = false;
        $("#novoUsuarioPreview").hidden = true;
        $("#novoUsuarioPlaceholder").hidden = true;
        await video.play();
        $("#btnCapturarCameraNovoUsuario").hidden = false;
        $("#btnCapturarCameraNovoUsuario").disabled = false;
        $("#btnPararCameraNovoUsuario").hidden = false;
        $("#btnPararCameraNovoUsuario").disabled = false;
        status.textContent = "Câmera ativa. Posicione o rosto de frente, centralizado e bem iluminado; depois selecione Capturar foto.";
    } catch (erro) {
        pararCameraNovoUsuario();
        status.textContent = erro.name === "NotAllowedError"
            ? "Permissão da câmera negada. Autorize o acesso à câmera no navegador ou utilize o envio de arquivo."
            : `Não foi possível abrir a câmera: ${erro.message || erro.name}.`;
    }
}

function capturarCameraNovoUsuario() {
    const video = $("#novoUsuarioVideo");
    if (!streamCameraNovoUsuario || !video.videoWidth || !video.videoHeight) {
        $("#statusFotoNovoUsuario").textContent = "Aguarde a câmera iniciar antes de capturar.";
        return;
    }
    try {
        const dataUrl = converterImagemParaJpeg(video, video.videoWidth, video.videoHeight);
        atualizarPreviaNovoUsuario(dataUrl);
        pararCameraNovoUsuario();
    } catch (erro) {
        $("#statusFotoNovoUsuario").textContent = erro.message;
    }
}

function limparFotoNovoUsuario() {
    pararCameraNovoUsuario();
    atualizarPreviaNovoUsuario(null);
    const arquivo = $("#novoUsuarioArquivo");
    if (arquivo) arquivo.value = "";
}

async function cadastrarNovoUsuario(evento) {
    evento.preventDefault();
    const status = $("#statusNovoUsuario");
    const botao = $("#btnCadastrarNovoUsuario");
    if (!sessaoBiometria.autenticado || !sessaoBiometria.canalSeguro || !sessaoBiometria.dispositivoConfigurado) {
        status.textContent = "Entre como administrador por HTTPS e verifique a conexão com o terminal.";
        atualizarControlesNovoUsuario();
        return;
    }
    if (!fotoNovoUsuarioDataUrl) { status.textContent = "Capture uma fotografia ou selecione um arquivo."; return; }
    if (!$("#confirmacaoNovoUsuario").checked) { status.textContent = "Confirme que a pessoa foi informada e que a rádio validou o tratamento biométrico."; return; }

    botao.disabled = true;
    status.textContent = "Consultando o ID no terminal e cadastrando o usuário e a fotografia facial...";
    pararCameraNovoUsuario();
    try {
        const resposta = await enviarJSON("/api/biometria/usuarios", "POST", {
            userId: $("#novoUsuarioId").value.trim(),
            nome: $("#novoUsuarioNome").value.trim(),
            situacao: $("#novoUsuarioSituacao").value,
            validadeInicio: $("#novoUsuarioValidadeInicio").value,
            validadeFim: $("#novoUsuarioValidadeFim").value,
            fotoDataUrl: fotoNovoUsuarioDataUrl,
            confirmacaoResponsavel: true
        });
        status.textContent = resposta.mensagem || "Cadastro enviado ao terminal.";
        if (resposta.usuarioCriadoNoTerminal) {
            $("#novoUsuarioForm").reset();
            limparFotoNovoUsuario();
            funcionariosCarregados = [];
            funcionariosParaAssociacao = [];
            await carregarFuncionariosParaAssociacao();
            await carregarFuncionarios();
            status.textContent = resposta.mensagem || "Usuário e fotografia cadastrados.";
        }
    } catch (erro) {
        status.textContent = erro.message;
    } finally {
        atualizarPreviaNovoUsuario(fotoNovoUsuarioDataUrl);
        botao.disabled = !(fotoNovoUsuarioDataUrl && $("#confirmacaoNovoUsuario").checked && sessaoBiometria.autenticado && sessaoBiometria.canalSeguro && sessaoBiometria.dispositivoConfigurado);
    }
}

async function carregarAbaAtiva() {
    if (abaAtiva === "diario") return carregarMovimentacaoDiaria();
    if (abaAtiva === "mensal") return carregarRelatorioMensal();
    if (abaAtiva === "funcionarios") return carregarFuncionarios();
    if (abaAtiva === "novo-usuario") {
        await carregarSessaoBiometria();
        return atualizarControlesNovoUsuario();
    }
    if (abaAtiva === "biometria") {
        await carregarSessaoBiometria();
        if (sessaoBiometria.autenticado) return carregarOcorrenciasFaciais();
    }
}

async function atualizarTudo() {
    const botao = $("#btnAtualizar");
    botao.disabled = true;
    botao.textContent = "Atualizando...";
    try {
        await Promise.allSettled([verificarServidor(), carregarAbaAtiva()]);
    } finally {
        botao.disabled = false;
        botao.innerHTML = '<span aria-hidden="true">↻</span> Atualizar dados';
    }
}

function inicializar() {
    $("#filtroDataDia").value = dataLocalISO();
    $("#filtroMes").value = mesLocalISO();
    $("#historicoInicio").value = "";
    $("#historicoFim").value = "";

    $$(".tab-button").forEach(botao => {
        botao.addEventListener("click", () => alternarAba(botao.dataset.tab));
    });

    $("#btnAtualizar").addEventListener("click", atualizarTudo);
    $("#filtroDataDia").addEventListener("change", carregarMovimentacaoDiaria);
    $("#filtroMes").addEventListener("change", carregarRelatorioMensal);
    $("#buscaFuncionario").addEventListener("input", carregarFuncionarios);
    $("#btnFiltrarHistorico").addEventListener("click", () => carregarHistoricoFuncionario(true));
    $("#btnHistoricoAnterior").addEventListener("click", () => { paginaHistorico = Math.max(1, paginaHistorico - 1); carregarHistoricoFuncionario(false); });
    $("#btnHistoricoProxima").addEventListener("click", () => { paginaHistorico++; carregarHistoricoFuncionario(false); });
    $("#btnHistoricoAnteriorRodape").addEventListener("click", () => { paginaHistorico = Math.max(1, paginaHistorico - 1); carregarHistoricoFuncionario(false); });
    $("#btnHistoricoProximaRodape").addEventListener("click", () => { paginaHistorico++; carregarHistoricoFuncionario(false); });
    $("#formBiometriaLogin").addEventListener("submit", entrarBiometria);
    $("#btnTestarIntelbras").addEventListener("click", testarTerminalIntelbras);
    $("#btnSairBiometria").addEventListener("click", sairBiometria);
    $("#filtroOcorrencias").addEventListener("change", carregarOcorrenciasFaciais);
    $("#btnEnviarFace").addEventListener("click", enviarCadastroFacial);
    $("#novoUsuarioForm").addEventListener("submit", cadastrarNovoUsuario);
    $("#btnIrParaBiometriaLogin").addEventListener("click", () => alternarAba("biometria"));
    $("#btnAbrirCameraNovoUsuario").addEventListener("click", abrirCameraNovoUsuario);
    $("#btnCapturarCameraNovoUsuario").addEventListener("click", capturarCameraNovoUsuario);
    $("#btnPararCameraNovoUsuario").addEventListener("click", pararCameraNovoUsuario);
    $("#btnRemoverFotoNovoUsuario").addEventListener("click", limparFotoNovoUsuario);
    $("#novoUsuarioArquivo").addEventListener("change", evento => processarArquivoNovoUsuario(evento.target.files?.[0]));
    $("#confirmacaoNovoUsuario").addEventListener("change", () => atualizarPreviaNovoUsuario(fotoNovoUsuarioDataUrl));
    $("#btnImprimirPDF").addEventListener("click", () => {
        const mes = $("#filtroMes").value || mesLocalISO();
        window.open(`/relatorios/mensal/imprimir?mes=${encodeURIComponent(mes)}`, "_blank", "noopener");
    });

    verificarServidor();
    carregarMovimentacaoDiaria();
    carregarSessaoBiometria();
}

document.addEventListener("DOMContentLoaded", inicializar);
