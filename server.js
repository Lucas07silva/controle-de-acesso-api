"use strict";

const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
require("dotenv").config();

const { conectarMongoDB, obterBanco } = require("./services/db");
const { normalizarEventos, salvarEventosIntelbras } = require("./services/evento-service");
const { extrairNotificacao } = require("./services/intelbras-notificacao-service");
const dashboardRoutes = require("./routes/dashboard");
const biometriaRoutes = require("./routes/biometria");
const { obterResumoMensal, obterMesAtualBahia } = require("./services/consulta-service");
const { removerArquivosERegistrosExpirados } = require("./services/ocorrencia-facial-service");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

function obterIPsPermitidosIntelbras() {
    return String(process.env.INTELBRAS_WEBHOOK_IPS || "").split(/[;,]/).map(ip => ip.trim().replace(/^::ffff:/, "")).filter(Boolean);
}

function origemIntelbrasAutorizada(req) {
    const permitidos = obterIPsPermitidosIntelbras();
    if (!permitidos.length) return false;
    const origem = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    return permitidos.includes(origem);
}

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use((req, res, next) => {
    if (req.path === "/api/eventos" && req.method === "POST") {
        console.log("\n========== NOTIFICAÇÃO INTELBRAS ==========");
        console.log("Método:", req.method);
        console.log("Origem:", req.socket.remoteAddress);
        console.log("Canal seguro:", Boolean(req.secure));
        console.log("Content-Type:", req.get("content-type") || "Não informado");
        console.log("Content-Length:", req.get("content-length") || "Não informado");
        res.on("finish", () => console.log("Resposta enviada ao Intelbras:", res.statusCode));
    }
    next();
});

// O POST do terminal pode chegar como multipart/mixed, multipart/form-data ou multipart/related.
// Mantemos o corpo binário intacto para não corromper os bytes das fotografias.
app.use(express.raw({
    type: req => /^multipart\/(mixed|form-data|related)(?:;|$)/i.test(req.headers["content-type"] || ""),
    limit: process.env.INTELBRAS_WEBHOOK_MAX_BYTES || "12mb"
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.status(200).render("index", { titulo: "Painel de Controle de Acesso da Rádio" });
});

app.post("/api/eventos", async (req, res) => {
    const ipsConfigurados = obterIPsPermitidosIntelbras();
    if (ipsConfigurados.length && !origemIntelbrasAutorizada(req)) {
        console.warn("Notificação recusada: IP de origem fora da lista Intelbras permitida.");
        return res.status(403).send("Origem não autorizada.");
    }

    let notificacao;
    try {
        notificacao = extrairNotificacao(req.body, req.get("content-type") || "", req.body);
    } catch (erro) {
        console.error("Erro ao interpretar notificação:", erro.message);
        return res.status(400).send("Notificação inválida.");
    }

    const payload = notificacao.payload;
    const eventos = normalizarEventos(payload?.Events);
    console.log("Eventos reconhecidos:", eventos.length);
    console.log("Partes de imagem recebidas:", notificacao.quantidadeImagensRecebidas || 0);
    console.log("Imagens associadas a eventos:", notificacao.quantidadeImagensAssociadas || 0);
    if (notificacao.tiposConteudo?.length) {
        console.log("Tipos das partes multipart:", notificacao.tiposConteudo.join(" | "));
    }
    if (!(notificacao.quantidadeImagensRecebidas > 0)) {
        console.warn("O POST não trouxe partes de imagem JPEG/PNG reconhecidas. Confirme ReportPicture e o formato multipart enviado pelo terminal.");
    }
    if (!eventos.length) {
        console.warn("Notificação recebida sem eventos reconhecíveis.");
        return res.status(400).send("Nenhum evento encontrado.");
    }

    try {
        const ipAutorizado = origemIntelbrasAutorizada(req);
        const permitirFotos = Boolean(req.secure && ipAutorizado);
        if (!req.secure) console.warn("Fotos bloqueadas: notificação chegou por HTTP, não HTTPS.");
        if (!ipAutorizado) console.warn("Fotos bloqueadas: IP de origem não consta em INTELBRAS_WEBHOOK_IPS.");
        const resultado = await salvarEventosIntelbras(
            payload,
            eventos,
            req.socket.remoteAddress,
            notificacao.imagensPorEvento,
            { permitirFotos }
        );
        console.log("Resultado do armazenamento:", resultado);
        if (resultado.fotosDescartadasPorSeguranca > 0) {
            console.warn("Fotografias de eventos foram descartadas por ausência de HTTPS e/ou IP não autorizado; os dados textuais dos eventos foram preservados.");
        }
        if (resultado.falhasArmazenamentoFoto > 0) {
            console.error("Uma ou mais fotografias chegaram, mas falharam ao serem gravadas. Consulte os erros acima.");
        }
        if ((notificacao.quantidadeImagensAssociadas || 0) > 0 && resultado.ocorrenciasFaciaisSalvas === 0) {
            console.warn("Havia imagem associada, mas nenhuma ocorrência facial nova foi gravada. Verifique se os eventos são AccessControl, Status=0, Method=15, sem UserID, e se a foto é JPEG/PNG válida com até 2 MB.");
        }
        return res.status(200).send("OK");
    } catch (erro) {
        console.error("Falha ao armazenar evento:", erro.message);
        return res.status(503).send("Banco temporariamente indisponível.");
    }
});

app.get("/api/eventos", async (req, res) => {
    try {
        const limiteInformado = Number.parseInt(req.query.limite, 10) || 50;
        const limite = Math.min(Math.max(limiteInformado, 1), 100);
        const eventos = await obterBanco().collection("eventos_acesso")
            .find({}, { projection: { _id: 0, eventKey: 0 } })
            .sort({ "timing.occurredAt": -1, "timing.receivedAt": -1 })
            .limit(limite)
            .toArray();
        return res.status(200).json({ sucesso: true, quantidade: eventos.length, eventos });
    } catch (erro) {
        console.error("Erro ao consultar eventos:", erro.message);
        return res.status(500).json({ sucesso: false, mensagem: "Não foi possível consultar os eventos." });
    }
});

app.use("/api/biometria", biometriaRoutes);
app.use("/api", dashboardRoutes);

app.get("/relatorios/mensal/imprimir", async (req, res) => {
    try {
        const mes = req.query.mes || obterMesAtualBahia();
        const relatorio = await obterResumoMensal(mes);
        return res.status(200).render("relatorio-mensal", { titulo: "Relatório Mensal de Acessos", relatorio });
    } catch (erro) {
        return res.status(400).send(`Não foi possível gerar o relatório: ${erro.message}`);
    }
});

app.use((req, res) => {
    res.status(404).json({ sucesso: false, mensagem: "Rota não encontrada." });
});

app.use((erro, req, res, next) => {
    console.error("Erro interno:", erro.message);
    if (res.headersSent) return next(erro);
    return res.status(500).json({ sucesso: false, mensagem: "Ocorreu um erro interno." });
});

async function iniciarServidor() {
    try {
        const banco = await conectarMongoDB();
        console.log("MongoDB conectado:", banco.databaseName);

        // Aplica a política de retenção automaticamente, sem depender de alguém abrir a galeria.
        const executarLimpezaBiometrica = async () => {
            try {
                const removidas = await removerArquivosERegistrosExpirados();
                if (removidas > 0) {
                    console.log(`Limpeza de retenção biométrica: ${removidas} ocorrência(s) expirada(s) removida(s).`);
                }
            } catch (erroLimpeza) {
                console.error("Falha na limpeza automática de fotografias expiradas:", erroLimpeza.message);
            }
        };
        await executarLimpezaBiometrica();
        const rotinaLimpeza = setInterval(executarLimpezaBiometrica, 6 * 60 * 60 * 1000);
        rotinaLimpeza.unref?.();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Servidor HTTP iniciado em http://localhost:${PORT}`);
            console.log("Dashboard HTTP mantido para compatibilidade com o acesso atual.");
        });

        const caminhoPfx = String(process.env.HTTPS_PFX_PATH || "").trim();
        const caminhoChave = String(process.env.HTTPS_KEY_PATH || "").trim();
        const caminhoCertificado = String(process.env.HTTPS_CERT_PATH || "").trim();
        const resolverArquivoProjeto = valor => path.isAbsolute(valor) ? valor : path.resolve(__dirname, valor);
        try {
            let tlsOptions = null;
            if (caminhoPfx) {
                tlsOptions = {
                    pfx: fs.readFileSync(resolverArquivoProjeto(caminhoPfx)),
                    passphrase: String(process.env.HTTPS_PFX_PASSPHRASE || "")
                };
            } else if (caminhoChave && caminhoCertificado) {
                tlsOptions = {
                    key: fs.readFileSync(resolverArquivoProjeto(caminhoChave)),
                    cert: fs.readFileSync(resolverArquivoProjeto(caminhoCertificado))
                };
            } else if (caminhoChave || caminhoCertificado) {
                throw new Error("Configure os dois caminhos HTTPS_KEY_PATH e HTTPS_CERT_PATH, ou use HTTPS_PFX_PATH.");
            }

            if (tlsOptions) {
                const servidorHttps = https.createServer(tlsOptions, app);
                servidorHttps.on("error", erroHttps => {
                    console.error("Falha no listener HTTPS:", erroHttps.message);
                });
                servidorHttps.listen(HTTPS_PORT, "0.0.0.0", () => {
                    console.log(`Servidor HTTPS iniciado na porta ${HTTPS_PORT} em todas as interfaces de rede.`);
                    console.log("Canal HTTPS pronto; mantenha o POST da Intelbras sem alterações até testar a conexão.");
                });
            } else {
                console.warn("HTTPS não configurado: cadastros faciais remotos e armazenamento de fotos do terminal ficarão bloqueados.");
            }
        } catch (erroHttps) {
            console.error("HTTPS não foi iniciado:", erroHttps.message);
            console.warn("O HTTP continua ativo na porta configurada em PORT; o POST da Intelbras não deve ser alterado ainda.");
        }
    } catch (erro) {
        console.error("Não foi possível iniciar a aplicação:", erro.message);
        process.exitCode = 1;
    }
}

iniciarServidor();

module.exports = { app };
