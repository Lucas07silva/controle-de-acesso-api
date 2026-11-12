"use strict";

const express = require("express");
const {
    obterDataAtualBahia,
    obterMesAtualBahia,
    obterResumoDiario,
    obterResumoMensal,
    listarFuncionarios,
    obterHistoricoFuncionario,
    exportarEventosMensaisCSV
} = require("../services/consulta-service");
const { obterTemperaturaHistorica } = require("../services/clima-service");

const router = express.Router();

router.get("/status", (req, res) => {
    return res.status(200).json({
        sucesso: true,
        aplicacao: "Controle de Acesso da Rádio",
        servidor: "online",
        banco: "conectado",
        dataHora: new Date().toISOString()
    });
});

router.get("/dashboard/resumo", async (req, res) => {
    try {
        const data = req.query.data || obterDataAtualBahia();
        const resultado = await obterResumoDiario(data);
        return res.json({ sucesso: true, ...resultado });
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }
});

router.get("/relatorios/mensal", async (req, res) => {
    try {
        const mes = req.query.mes || obterMesAtualBahia();
        const resultado = await obterResumoMensal(mes);
        return res.json({ sucesso: true, ...resultado });
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }
});

router.get("/relatorios/mensal/csv", async (req, res, next) => {
    try {
        const mes = req.query.mes || obterMesAtualBahia();
        await exportarEventosMensaisCSV(mes, res);
    } catch (erro) {
        if (!res.headersSent) return res.status(400).json({ sucesso: false, mensagem: erro.message });
        return next(erro);
    }
});


router.get("/clima/temperatura", async (req, res) => {
    try {
        const dataHora = String(req.query.dataHora || "").trim();
        if (!dataHora) {
            return res.status(400).json({
                sucesso: false,
                mensagem: "Informe dataHora em formato ISO 8601."
            });
        }

        const instante = new Date(dataHora);
        if (Number.isNaN(instante.getTime())) {
            return res.status(400).json({
                sucesso: false,
                mensagem: "O horário informado é inválido."
            });
        }

        const temperatura = await obterTemperaturaHistorica(instante, {
            forcarAtualizacao: req.query.atualizar === "1"
        });
        return res.json({ sucesso: true, temperatura });
    } catch (erro) {
        console.error("Erro ao consultar temperatura histórica:", erro.message);
        return res.status(503).json({
            sucesso: false,
            mensagem: "Não foi possível consultar a temperatura histórica."
        });
    }
});

router.get("/funcionarios", async (req, res) => {
    try {
        const funcionarios = await listarFuncionarios(String(req.query.busca || ""));
        return res.json({ sucesso: true, quantidade: funcionarios.length, funcionarios });
    } catch (erro) {
        console.error("Erro ao consultar funcionários:", erro.message);
        return res.status(500).json({ sucesso: false, mensagem: "Não foi possível consultar os funcionários." });
    }
});

router.get("/funcionarios/:userId/movimentacoes", async (req, res) => {
    try {
        const resultado = await obterHistoricoFuncionario(
            req.params.userId,
            req.query.inicio,
            req.query.fim,
            req.query.pagina,
            req.query.porPagina
        );

        if (!resultado) {
            return res.status(404).json({ sucesso: false, mensagem: "Funcionário não encontrado." });
        }

        return res.json({ sucesso: true, ...resultado });
    } catch (erro) {
        return res.status(400).json({ sucesso: false, mensagem: erro.message });
    }
});

module.exports = router;
