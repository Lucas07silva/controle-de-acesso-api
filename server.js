
"use strict"; // Ativa o modo estrito do JavaScript, ajudando a evitar erros de programação e comportamentos inesperados.


// Importa o framework Express, utilizado para criar o servidor web e configurar as rotas HTTP.
const express = require("express");

// Importa o módulo path do Node.js, utilizado para manipular caminhos de arquivos e diretórios.
const path = require("node:path");

// Importa o módulo fs (File System), utilizado para acessar arquivos do sistema operacional.
// Neste projeto, é utilizado para ler os arquivos de certificado e chave privada do HTTPS.
const fs = require("node:fs");

// Importa o módulo https do Node.js, responsável por criar servidores que utilizam criptografia TLS.
const https = require("node:https");

// Carrega as variáveis de ambiente definidas no arquivo .env.
// Essas variáveis armazenam configurações como portas, caminhos de certificados e endereços IP autorizados.
require("dotenv").config();


// Importa duas funções responsáveis pela conexão com o MongoDB:
// conectarMongoDB() estabelece a conexão com o banco;
// obterBanco() disponibiliza a instância do banco para realizar consultas e operações.
const { conectarMongoDB, obterBanco } = require("./services/db");

// Importa as funções responsáveis pelo tratamento e armazenamento dos eventos Intelbras:
// normalizarEventos() organiza os eventos recebidos em uma estrutura padronizada;
// salvarEventosIntelbras() processa e persiste os eventos e suas possíveis fotografias.
const { normalizarEventos, salvarEventosIntelbras } = require("./services/evento-service");

// Importa a função que interpreta a notificação enviada pelo terminal Intelbras.
// Ela extrai o conteúdo dos eventos e as imagens que podem acompanhar a mensagem multipart.
const { extrairNotificacao } = require("./services/intelbras-notificacao-service");

// Importa o conjunto de rotas responsável pelas consultas e funcionalidades do dashboard.
const dashboardRoutes = require("./routes/dashboard");

// Importa o conjunto de rotas responsável pelas operações relacionadas à biometria e aos usuários.
const biometriaRoutes = require("./routes/biometria");

// Importa as funções utilizadas para gerar o resumo mensal:
// obterResumoMensal() consulta e organiza os dados do relatório;
// obterMesAtualBahia() identifica o mês atual considerando o fuso horário da Bahia.
const { obterResumoMensal, obterMesAtualBahia } = require("./services/consulta-service");

// Importa a função que remove fotografias e registros de ocorrências faciais
// que ultrapassaram o período de retenção configurado na aplicação.
const { removerArquivosERegistrosExpirados } = require("./services/ocorrencia-facial-service");


// Cria a instância principal do Express.
// O objeto app será utilizado para configurar middlewares, rotas e servidores.
const app = express();

// Lê a porta HTTP definida no arquivo .env.
// Number() converte o valor textual em número.
// Caso a variável não esteja configurada ou resulte em zero, utiliza a porta 3000.
const PORT = Number(process.env.PORT) || 3000;

// Lê a porta utilizada pelo servidor HTTPS.
// Se não existir uma configuração válida, utiliza a porta 3443.
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;


// Declara uma função que obtém a lista de endereços IP autorizados
// a enviar notificações do terminal Intelbras para a aplicação.
function obterIPsPermitidosIntelbras() {

    // Lê a variável INTELBRAS_WEBHOOK_IPS do ambiente.
    // O operador || utiliza uma string vazia caso a variável não esteja configurada.
    // split(/[;,]/) divide o conteúdo quando encontra ponto e vírgula ou vírgula.
    // map() percorre os endereços encontrados e remove espaços em branco.
    // replace() remove o prefixo ::ffff: utilizado em algumas representações
    // de endereços IPv4 recebidos por conexões IPv6.
    // filter(Boolean) elimina os valores vazios da lista.
    return String(process.env.INTELBRAS_WEBHOOK_IPS || "")
        .split(/[;,]/)
        .map(ip => ip.trim().replace(/^::ffff:/, ""))
        .filter(Boolean);
}


// Declara uma função que verifica se o endereço IP de origem de uma requisição
// está presente na lista de endereços autorizados do terminal Intelbras.
function origemIntelbrasAutorizada(req) {

    // Obtém a lista de IPs permitidos chamando a função anterior.
    const permitidos = obterIPsPermitidosIntelbras();

    // Se a lista estiver vazia, não existe nenhum IP autorizado cadastrado.
    // Nesse caso, a função retorna false.
    if (!permitidos.length) return false;

    // Obtém o endereço IP remoto da conexão HTTP.
    // req.socket.remoteAddress representa o endereço do dispositivo que estabeleceu a conexão.
    // O replace() remove o prefixo ::ffff: quando presente.
    const origem = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");

    // Verifica se o endereço IP de origem está presente na lista de permitidos.
    // includes() retorna true quando encontra o endereço e false quando não encontra.
    return permitidos.includes(origem);
}


// Verifica se TRUST_PROXY está configurado como "1" no arquivo .env.
// Quando ativado, informa ao Express que existe um proxy reverso confiável
// responsável por encaminhar as requisições ao servidor.
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

// Define o EJS como mecanismo de renderização das páginas HTML.
// Com isso, o Express pode utilizar arquivos .ejs para montar as páginas do sistema.
app.set("view engine", "ejs");

// Define o caminho absoluto do diretório em que estão armazenados os templates EJS.
// path.join() combina o diretório atual da aplicação com a pasta views.
app.set("views", path.join(__dirname, "views"));


// Registra um middleware executado durante o processamento das requisições.
// Um middleware é uma função que recebe a requisição, a resposta e next,
// podendo executar operações antes de a aplicação chegar à rota final.
app.use((req, res, next) => {

    // Verifica se a requisição corresponde ao recebimento de eventos Intelbras.
    // A condição exige que o caminho seja /api/eventos e o método HTTP seja POST.
    if (req.path === "/api/eventos" && req.method === "POST") {

        // Exibe um título no terminal para facilitar a identificação
        // das notificações recebidas do equipamento.
        console.log("\n========== NOTIFICAÇÃO INTELBRAS ==========");

        // Registra o método HTTP utilizado na comunicação.
        console.log("Método:", req.method);

        // Registra o endereço IP do dispositivo que iniciou a conexão.
        console.log("Origem:", req.socket.remoteAddress);

        // Informa se a requisição foi recebida por um canal considerado seguro pelo Express.
        // Boolean() transforma o valor de req.secure em true ou false.
        console.log("Canal seguro:", Boolean(req.secure));

        // Exibe o tipo de conteúdo informado no cabeçalho HTTP.
        // Caso não exista o Content-Type, apresenta "Não informado".
        console.log("Content-Type:", req.get("content-type") || "Não informado");

        // Exibe o tamanho do conteúdo da requisição, quando informado pelo remetente.
        // O cabeçalho Content-Length indica a quantidade de bytes transmitidos.
        console.log("Content-Length:", req.get("content-length") || "Não informado");

        // Registra um evento que será executado quando a resposta HTTP terminar de ser enviada.
        // O evento finish permite verificar qual código HTTP foi retornado ao terminal.
        res.on("finish", () => console.log("Resposta enviada ao Intelbras:", res.statusCode));
    }

    // Chama next() para permitir que a requisição continue
    // para os próximos middlewares ou para a rota correspondente.
    next();
});


// O POST do terminal pode chegar como multipart/mixed, multipart/form-data ou multipart/related.
// Mantemos o corpo binário intacto para não corromper os bytes das fotografias.

// Configura um middleware para receber o corpo das requisições no formato Buffer.
// Buffer permite trabalhar com dados binários sem convertê-los automaticamente em texto.
app.use(express.raw({

    // Define quais requisições devem ser interpretadas por esse middleware.
    // A função verifica o cabeçalho Content-Type e aceita os três formatos multipart.
    // A expressão regular também aceita parâmetros adicionais depois do tipo,
    // como boundary, que identifica as partes de uma mensagem multipart.
    type: req => /^multipart\/(mixed|form-data|related)(?:;|$)/i.test(req.headers["content-type"] || ""),

    // Define o tamanho máximo permitido para o corpo da requisição multipart.
    // O limite pode ser configurado pela variável INTELBRAS_WEBHOOK_MAX_BYTES.
    // Caso não exista configuração, utiliza 12 MB.
    limit: process.env.INTELBRAS_WEBHOOK_MAX_BYTES || "12mb"
}));

// Configura o middleware responsável por interpretar corpos de requisições JSON.
// O limite de 1 MB evita aceitar corpos JSON maiores do que o necessário para essa aplicação.
app.use(express.json({ limit: "1mb" }));

// Configura o middleware para interpretar dados enviados no formato URL-encoded.
// Esse formato é comum em formulários HTML.
// extended: true permite interpretar estruturas de dados mais complexas.
// O limite máximo configurado para o conteúdo é de 100 KB.
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Configura a pasta public como diretório de arquivos estáticos.
// Isso permite disponibilizar diretamente arquivos CSS, JavaScript e imagens
// utilizados pela interface web, sem criar uma rota específica para cada arquivo.
app.use(express.static(path.join(__dirname, "public")));


// Cria a rota principal do sistema, acessível pelo endereço raiz "/".
app.get("/", (req, res) => {

    // Retorna uma resposta HTTP 200 (OK) e renderiza o arquivo index.ejs.
    // O objeto enviado ao template contém o título que será exibido na página.
    res.status(200).render("index", {
        titulo: "Painel de Controle de Acesso da Rádio"
    });
});


// Cria a rota POST /api/eventos, responsável por receber notificações do terminal Intelbras.
// O uso de async permite executar operações assíncronas, como gravações no MongoDB,
// utilizando await para aguardar seus resultados.
app.post("/api/eventos", async (req, res) => {

    // Obtém a lista de endereços IP permitidos configurados no arquivo .env.
    const ipsConfigurados = obterIPsPermitidosIntelbras();

    // Verifica se existe uma lista de IPs configurados.
    // Se existir, também verifica se o endereço de origem da requisição está autorizado.
    // Caso a lista exista e o endereço não seja permitido, a operação é bloqueada.
    if (ipsConfigurados.length && !origemIntelbrasAutorizada(req)) {

        // Registra no terminal que uma notificação foi recusada por não pertencer
        // à lista de endereços IP autorizados.
        console.warn("Notificação recusada: IP de origem fora da lista Intelbras permitida.");

        // Retorna o código HTTP 403 (Forbidden), indicando que a origem não está autorizada.
        // send() envia a mensagem de resposta ao dispositivo que realizou a requisição.
        return res.status(403).send("Origem não autorizada.");
    }

    // Declara a variável que armazenará a notificação depois de interpretada.
    // Ela é declarada antes do bloco try porque seu conteúdo será utilizado posteriormente.
    let notificacao;

    // Inicia um bloco de tratamento de erros para a interpretação da notificação.
    try {

        // Chama extrairNotificacao() para interpretar o corpo recebido do terminal.
        // O primeiro argumento contém o conteúdo da requisição.
        // O segundo argumento informa o Content-Type, importante para interpretar o multipart.
        // O terceiro argumento também disponibiliza o corpo recebido para o serviço.
        // A função retorna informações sobre os eventos e as imagens encontradas.
        notificacao = extrairNotificacao(
            req.body,
            req.get("content-type") || "",
            req.body
        );

    } catch (erro) {

        // Registra no terminal a mensagem técnica do erro encontrado durante a interpretação.
        console.error("Erro ao interpretar notificação:", erro.message);

        // Retorna HTTP 400 (Bad Request), indicando que a notificação recebida é inválida.
        return res.status(400).send("Notificação inválida.");
    }

    // Extrai o conteúdo principal da notificação interpretada.
    // O payload contém os dados encaminhados pelo equipamento.
    const payload = notificacao.payload;

    // Obtém a lista de eventos existente em payload.Events e chama normalizarEventos().
    // O operador ?. evita erro caso payload não exista.
    // O serviço transforma os eventos reconhecidos em uma estrutura padronizada.
    const eventos = normalizarEventos(payload?.Events);

    // Registra quantos eventos foram reconhecidos após a normalização.
    console.log("Eventos reconhecidos:", eventos.length);

    // Registra quantas partes de imagem foram recebidas na notificação multipart.
    // O operador || utiliza zero quando a quantidade não está disponível.
    console.log("Partes de imagem recebidas:", notificacao.quantidadeImagensRecebidas || 0);

    // Registra quantas imagens puderam ser associadas a eventos específicos.
    console.log("Imagens associadas a eventos:", notificacao.quantidadeImagensAssociadas || 0);

    // Verifica se o serviço identificou tipos de conteúdo nas partes multipart.
    // Se existir uma lista, registra todos os tipos encontrados.
    if (notificacao.tiposConteudo?.length) {

        // join(" | ") transforma os elementos do array em uma única string,
        // separando cada tipo de conteúdo pelo símbolo indicado.
        console.log("Tipos das partes multipart:", notificacao.tiposConteudo.join(" | "));
    }

    // Verifica se nenhuma parte de imagem foi reconhecida na notificação.
    // O operador > compara a quantidade recebida com zero.
    // O operador ! inverte o resultado da comparação.
    if (!(notificacao.quantidadeImagensRecebidas > 0)) {

        // Emite um aviso para facilitar o diagnóstico de notificações sem fotografias.
        // A mensagem sugere conferir a configuração ReportPicture e o formato multipart do terminal.
        console.warn("O POST não trouxe partes de imagem JPEG/PNG reconhecidas. Confirme ReportPicture e o formato multipart enviado pelo terminal.");
    }

    // Verifica se a lista de eventos normalizados está vazia.
    // Sem eventos reconhecidos, não existe registro que possa ser processado nessa rota.
    if (!eventos.length) {

        // Registra um aviso informando que não foram encontrados eventos reconhecíveis.
        console.warn("Notificação recebida sem eventos reconhecíveis.");

        // Retorna HTTP 400, indicando que a requisição não possui os dados de evento esperados.
        return res.status(400).send("Nenhum evento encontrado.");
    }

    // Inicia um segundo bloco try para realizar as operações de armazenamento dos eventos.
    // Esse bloco também captura falhas de comunicação com o MongoDB e outros erros
    // que possam ocorrer durante a persistência das informações.
    try {

        // Verifica novamente se o endereço IP de origem pertence à lista de IPs autorizados.
        // O resultado será utilizado para decidir se as fotografias poderão ser armazenadas.
        const ipAutorizado = origemIntelbrasAutorizada(req);

        // Define se o armazenamento das fotografias está permitido.
        // req.secure precisa ser true, indicando uma conexão HTTPS reconhecida pelo Express.
        // Além disso, o IP de origem precisa estar autorizado.
        // Boolean() garante que o resultado seja true ou false.
        const permitirFotos = Boolean(req.secure && ipAutorizado);

        // Verifica se a requisição chegou sem HTTPS.
        // Nesse caso, registra um aviso informando que as fotografias serão bloqueadas.
        if (!req.secure) console.warn("Fotos bloqueadas: notificação chegou por HTTP, não HTTPS.");

        // Verifica se o IP de origem não está na lista autorizada.
        // Se não estiver, registra um aviso de segurança.
        if (!ipAutorizado) console.warn("Fotos bloqueadas: IP de origem não consta em INTELBRAS_WEBHOOK_IPS.");

        // Aguarda a execução do serviço responsável por armazenar os eventos recebidos.
        // await permite esperar a conclusão da operação assíncrona antes de continuar.
        const resultado = await salvarEventosIntelbras(

            // Envia o payload completo da notificação para o serviço de armazenamento.
            payload,

            // Envia os eventos já normalizados para processamento e persistência.
            eventos,

            // Informa o endereço IP de origem da conexão, para registro e rastreabilidade.
            req.socket.remoteAddress,

            // Envia o conjunto de imagens que o serviço de notificação conseguiu associar aos eventos.
            notificacao.imagensPorEvento,

            // Envia as opções adicionais da operação.
            // permitirFotos determina se o serviço poderá armazenar fotografias.
            { permitirFotos }
        );

        // Exibe o resultado devolvido pelo serviço de armazenamento.
        // Esse objeto pode conter quantidades de eventos salvos, imagens descartadas e falhas.
        console.log("Resultado do armazenamento:", resultado);

        // Verifica se uma ou mais fotografias foram descartadas por motivos de segurança.
        if (resultado.fotosDescartadasPorSeguranca > 0) {

            // Informa que as fotografias não foram armazenadas por ausência de HTTPS
            // ou por falta de autorização do IP de origem.
            // Os dados textuais dos eventos continuam preservados.
            console.warn("Fotografias de eventos foram descartadas por ausência de HTTPS e/ou IP não autorizado; os dados textuais dos eventos foram preservados.");
        }

        // Verifica se ocorreram falhas durante a gravação de uma ou mais fotografias.
        if (resultado.falhasArmazenamentoFoto > 0) {

            // Registra uma mensagem de erro para indicar que as imagens chegaram,
            // mas não puderam ser gravadas corretamente.
            console.error("Uma ou mais fotografias chegaram, mas falharam ao serem gravadas. Consulte os erros acima.");
        }

        // Verifica duas condições:
        // 1. Pelo menos uma imagem foi associada a um evento;
        // 2. Nenhuma ocorrência facial nova foi salva.
        // O objetivo é identificar situações em que uma imagem chegou,
        // mas não passou pelas regras de elegibilidade para armazenamento.
        if (
            (notificacao.quantidadeImagensAssociadas || 0) > 0 &&
            resultado.ocorrenciasFaciaisSalvas === 0
        ) {

            // Informa quais critérios devem ser verificados:
            // evento AccessControl, Status igual a 0, Method igual a 15,
            // ausência de UserID e imagem JPEG/PNG válida com até 2 MB.
            console.warn("Havia imagem associada, mas nenhuma ocorrência facial nova foi gravada. Verifique se os eventos são AccessControl, Status=0, Method=15, sem UserID, e se a foto é JPEG/PNG válida com até 2 MB.");
        }

        // Retorna HTTP 200 (OK), indicando que a notificação foi processada
        // e a operação de armazenamento foi concluída sem lançar uma exceção.
        return res.status(200).send("OK");

    } catch (erro) {

        // Registra a mensagem técnica caso ocorra uma falha durante o armazenamento.
        console.error("Falha ao armazenar evento:", erro.message);

        // Retorna HTTP 503 (Service Unavailable).
        // Esse código indica que o serviço não conseguiu concluir a operação
        // porque o armazenamento ou alguma dependência está temporariamente indisponível.
        return res.status(503).send("Banco temporariamente indisponível.");
    }
});


// Cria a rota GET /api/eventos, utilizada para consultar os eventos armazenados no MongoDB.
// Essa rota permite que a interface ou outro cliente HTTP obtenha o histórico de movimentações.
app.get("/api/eventos", async (req, res) => {

    // Inicia o tratamento de erros para a consulta ao banco de dados.
    try {

        // Obtém o parâmetro limite enviado na URL.
        // parseInt() converte o valor para um número inteiro na base decimal.
        // O operador || define 50 como valor padrão quando o resultado é zero ou inválido.
        // Exemplo: /api/eventos?limite=20.
        const limiteInformado = Number.parseInt(req.query.limite, 10) || 50;

        // Restringe o limite de registros a uma faixa de 1 até 100.
        // Math.max() garante o mínimo de 1.
        // Math.min() impede que o valor ultrapasse 100.
        const limite = Math.min(Math.max(limiteInformado, 1), 100);

        // Consulta a coleção eventos_acesso no MongoDB.
        // obterBanco() fornece a conexão com o banco de dados.
        // collection() seleciona a coleção que contém os eventos.
        // find() inicia uma consulta sem filtro, ou seja, busca os registros disponíveis.
        const eventos = await obterBanco().collection("eventos_acesso")

            // Define os campos que não devem aparecer no resultado.
            // projection com valor 0 exclui os campos _id e eventKey da resposta.
            .find({}, { projection: { _id: 0, eventKey: 0 } })

            // Ordena os registros por data de ocorrência em ordem decrescente.
            // Caso os horários de ocorrência sejam iguais, utiliza receivedAt como segundo critério.
            .sort({ "timing.occurredAt": -1, "timing.receivedAt": -1 })

            // Aplica o limite máximo de registros definido anteriormente.
            .limit(limite)

            // Executa a consulta e transforma os resultados em um array JavaScript.
            .toArray();

        // Retorna HTTP 200 e uma resposta JSON contendo:
        // sucesso: indica que a consulta foi realizada;
        // quantidade: informa quantos registros foram encontrados;
        // eventos: contém os registros retornados pelo MongoDB.
        return res.status(200).json({
            sucesso: true,
            quantidade: eventos.length,
            eventos
        });

    } catch (erro) {

        // Registra no terminal o erro ocorrido durante a consulta.
        console.error("Erro ao consultar eventos:", erro.message);

        // Retorna HTTP 500 (Internal Server Error).
        // A mensagem enviada ao cliente é genérica para não expor detalhes internos do sistema.
        return res.status(500).json({
            sucesso: false,
            mensagem: "Não foi possível consultar os eventos."
        });
    }
});


// Registra todas as rotas definidas em biometriaRoutes.
// O prefixo /api/biometria significa que os caminhos internos desse módulo
// serão acessíveis a partir desse endereço.
app.use("/api/biometria", biometriaRoutes);

// Registra o conjunto de rotas do dashboard utilizando o prefixo /api.
// Assim, os endpoints definidos em dashboard.js ficam disponíveis dentro desse caminho.
app.use("/api", dashboardRoutes);


// Cria uma rota para gerar a versão de impressão do relatório mensal de acessos.
app.get("/relatorios/mensal/imprimir", async (req, res) => {

    // Inicia o tratamento de erros para a consulta e renderização do relatório.
    try {

        // Obtém o mês solicitado pelo usuário por meio do parâmetro mes da URL.
        // Exemplo: /relatorios/mensal/imprimir?mes=2026-11.
        // Caso nenhum mês seja informado, utiliza o mês atual considerando a Bahia.
        const mes = req.query.mes || obterMesAtualBahia();

        // Aguarda a geração do resumo mensal, utilizando o mês informado.
        // O serviço de consulta busca e organiza as informações necessárias ao relatório.
        const relatorio = await obterResumoMensal(mes);

        // Retorna HTTP 200 e renderiza o template EJS relatorio-mensal.
        // Envia o título e os dados do relatório para serem apresentados na página.
        return res.status(200).render("relatorio-mensal", {
            titulo: "Relatório Mensal de Acessos",
            relatorio
        });

    } catch (erro) {

        // Se houver erro ao consultar ou montar o relatório,
        // retorna HTTP 400 com uma mensagem explicando que a geração não foi possível.
        return res.status(400).send(`Não foi possível gerar o relatório: ${erro.message}`);
    }
});


// Cria um middleware para tratar requisições destinadas a caminhos que não possuem uma rota registrada.
// Ele é colocado depois das rotas existentes para funcionar como tratamento de rota não encontrada.
app.use((req, res) => {

    // Retorna HTTP 404 (Not Found) e uma resposta JSON informando que o caminho não existe.
    res.status(404).json({
        sucesso: false,
        mensagem: "Rota não encontrada."
    });
});


// Registra um middleware especial para tratamento de erros do Express.
// A presença dos quatro parâmetros (erro, req, res, next) identifica essa função como error handler.
app.use((erro, req, res, next) => {

    // Registra no terminal a mensagem do erro interno para auxiliar o diagnóstico.
    console.error("Erro interno:", erro.message);

    // Verifica se os cabeçalhos da resposta já foram enviados.
    // Se isso aconteceu, o Express não pode enviar outra resposta HTTP normalmente.
    // next(erro) encaminha o erro ao próximo manipulador de erros disponível.
    if (res.headersSent) return next(erro);

    // Caso a resposta ainda não tenha sido enviada,
    // retorna HTTP 500 e uma mensagem genérica ao cliente.
    return res.status(500).json({
        sucesso: false,
        mensagem: "Ocorreu um erro interno."
    });
});


// Declara a função assíncrona responsável por inicializar a aplicação.
// Ela concentra a conexão com o MongoDB, a rotina de retenção e a inicialização dos servidores.
async function iniciarServidor() {

    // Utiliza try para capturar erros que possam ocorrer durante a inicialização da aplicação.
    try {

        // Estabelece a conexão com o MongoDB e aguarda sua conclusão.
        // A variável banco recebe a instância do banco conectada.
        const banco = await conectarMongoDB();

        // Registra o nome do banco de dados utilizado pela aplicação.
        console.log("MongoDB conectado:", banco.databaseName);


        // Aplica a política de retenção automaticamente, sem depender de alguém abrir a galeria.

        // Declara uma função assíncrona responsável por executar a limpeza
        // das fotografias e dos registros de ocorrências faciais expirados.
        const executarLimpezaBiometrica = async () => {

            // Inicia um bloco de tratamento de erros específico para a limpeza.
            try {

                // Aguarda a execução da função responsável por remover arquivos e registros expirados.
                // O resultado representa a quantidade de ocorrências removidas.
                const removidas = await removerArquivosERegistrosExpirados();

                // Verifica se pelo menos uma ocorrência foi removida.
                if (removidas > 0) {

                    // Registra quantas ocorrências expiradas foram removidas durante a execução.
                    console.log(`Limpeza de retenção biométrica: ${removidas} ocorrência(s) expirada(s) removida(s).`);
                }

            } catch (erroLimpeza) {

                // Registra falhas na limpeza sem encerrar a aplicação inteira.
                // Isso permite que o servidor continue funcionando mesmo se uma execução falhar.
                console.error("Falha na limpeza automática de fotografias expiradas:", erroLimpeza.message);
            }
        };

        // Executa a limpeza imediatamente durante a inicialização do servidor.
        // Isso evita esperar seis horas pela primeira execução programada.
        await executarLimpezaBiometrica();

        // Agenda a repetição automática da limpeza a cada seis horas.
        // 6 horas × 60 minutos × 60 segundos × 1000 milissegundos.
        const rotinaLimpeza = setInterval(
            executarLimpezaBiometrica,
            6 * 60 * 60 * 1000
        );

        // unref() informa ao Node.js que esse temporizador não precisa,
        // sozinho, manter o processo ativo durante o encerramento.
        // O operador ?. faz a chamada somente se unref existir.
        rotinaLimpeza.unref?.();


        // Inicia o servidor HTTP utilizando a porta definida em PORT.
        // O endereço 0.0.0.0 permite que o servidor aceite conexões
        // pelas interfaces de rede disponíveis, e não somente pelo localhost.
        app.listen(PORT, "0.0.0.0", () => {

            // Informa no terminal que o servidor HTTP foi iniciado.
            // localhost é utilizado como endereço local de referência para o acesso.
            console.log(`Servidor HTTP iniciado em http://localhost:${PORT}`);

            // Informa que o HTTP continua ativo por compatibilidade com o acesso existente.
            console.log("Dashboard HTTP mantido para compatibilidade com o acesso atual.");
        });


        // Lê o caminho do arquivo PFX, caso exista uma configuração no .env.
        // PFX pode reunir certificado e chave privada em um único arquivo.
        // trim() remove espaços antes e depois do valor.
        const caminhoPfx = String(process.env.HTTPS_PFX_PATH || "").trim();

        // Lê o caminho do arquivo de chave privada utilizado pelo HTTPS.
        const caminhoChave = String(process.env.HTTPS_KEY_PATH || "").trim();

        // Lê o caminho do arquivo de certificado digital utilizado pelo HTTPS.
        const caminhoCertificado = String(process.env.HTTPS_CERT_PATH || "").trim();

        // Declara uma função auxiliar para resolver o caminho de um arquivo do projeto.
        // path.isAbsolute() verifica se o caminho já é absoluto.
        // Se for absoluto, mantém o valor original.
        // Caso seja relativo, path.resolve() transforma o caminho em absoluto
        // utilizando o diretório da aplicação como referência.
        const resolverArquivoProjeto = valor =>
            path.isAbsolute(valor) ? valor : path.resolve(__dirname, valor);


        // Inicia um bloco separado de tratamento de erros para a configuração HTTPS.
        // Assim, uma falha na preparação do certificado não impede necessariamente
        // que o servidor HTTP continue funcionando.
        try {

            // Inicializa a variável que armazenará as opções de segurança TLS.
            // O valor null indica que os certificados ainda não foram configurados.
            let tlsOptions = null;

            // Verifica se foi informado um caminho para um arquivo PFX.
            if (caminhoPfx) {

                // Monta as opções de TLS utilizando o arquivo PFX.
                tlsOptions = {

                    // Lê o conteúdo binário do certificado PFX.
                    // resolverArquivoProjeto() obtém o caminho absoluto antes da leitura.
                    pfx: fs.readFileSync(resolverArquivoProjeto(caminhoPfx)),

                    // Obtém a senha utilizada para abrir o arquivo PFX, quando necessária.
                    // Caso não exista senha configurada, utiliza uma string vazia.
                    passphrase: String(process.env.HTTPS_PFX_PASSPHRASE || "")
                };

            // Caso não exista PFX, verifica se os caminhos da chave e do certificado foram informados.
            } else if (caminhoChave && caminhoCertificado) {

                // Monta as opções TLS separando a chave privada e o certificado digital.
                tlsOptions = {

                    // Lê o conteúdo do arquivo que contém a chave privada.
                    key: fs.readFileSync(resolverArquivoProjeto(caminhoChave)),

                    // Lê o conteúdo do arquivo que contém o certificado digital.
                    cert: fs.readFileSync(resolverArquivoProjeto(caminhoCertificado))
                };

            // Verifica se somente um dos dois caminhos foi informado.
            // A configuração separada exige que chave e certificado sejam fornecidos juntos.
            } else if (caminhoChave || caminhoCertificado) {

                // Interrompe a configuração HTTPS com uma mensagem explicativa.
                // O usuário deverá configurar os dois arquivos ou utilizar um PFX.
                throw new Error("Configure os dois caminhos HTTPS_KEY_PATH e HTTPS_CERT_PATH, ou use HTTPS_PFX_PATH.");
            }


            // Verifica se as opções TLS foram montadas corretamente.
            // Se tlsOptions continuar null, significa que nenhum certificado foi configurado.
            if (tlsOptions) {

                // Cria um servidor HTTPS utilizando os certificados e a aplicação Express.
                const servidorHttps = https.createServer(tlsOptions, app);

                // Registra um listener para capturar erros que ocorram no servidor HTTPS.
                servidorHttps.on("error", erroHttps => {

                    // Exibe no terminal a mensagem de erro do servidor HTTPS.
                    console.error("Falha no listener HTTPS:", erroHttps.message);
                });

                // Inicia o servidor HTTPS na porta definida por HTTPS_PORT.
                // O endereço 0.0.0.0 permite receber conexões pelas interfaces de rede disponíveis.
                servidorHttps.listen(HTTPS_PORT, "0.0.0.0", () => {

                    // Informa que o servidor HTTPS foi iniciado e indica a porta utilizada.
                    console.log(`Servidor HTTPS iniciado na porta ${HTTPS_PORT} em todas as interfaces de rede.`);

                    // Registra uma orientação para testar o canal HTTPS antes de alterar
                    // as configurações de comunicação do terminal Intelbras.
                    console.log("Canal HTTPS pronto; mantenha o POST da Intelbras sem alterações até testar a conexão.");
                });

            } else {

                // Informa que o servidor HTTPS não foi iniciado porque não existem certificados configurados.
                // Nesse cenário, as operações que exigem HTTPS para o tratamento de fotografias
                // permanecem bloqueadas pela lógica da rota de recebimento.
                console.warn("HTTPS não configurado: cadastros faciais remotos e armazenamento de fotos do terminal ficarão bloqueados.");
            }

        } catch (erroHttps) {

            // Registra qualquer erro encontrado ao ler certificados ou configurar o servidor HTTPS.
            console.error("HTTPS não foi iniciado:", erroHttps.message);

            // Informa que o servidor HTTP permanece ativo, mesmo que a configuração HTTPS falhe.
            // O recebimento do terminal não deve ser alterado antes de testar a conexão segura.
            console.warn("O HTTP continua ativo na porta configurada em PORT; o POST da Intelbras não deve ser alterado ainda.");
        }

    } catch (erro) {

        // Captura erros que impeçam a inicialização principal da aplicação,
        // como uma falha ao estabelecer a conexão com o MongoDB.
        console.error("Não foi possível iniciar a aplicação:", erro.message);

        // Define o código de saída do processo como 1, indicando que ocorreu uma falha.
        // O Node.js poderá encerrar o processo indicando que a aplicação não iniciou corretamente.
        process.exitCode = 1;
    }
}


// Chama a função iniciarServidor() para começar a execução da aplicação.
// Sem essa chamada, a função seria apenas declarada, mas o servidor não seria iniciado.
iniciarServidor();


// Exporta o objeto app para permitir que outros arquivos, especialmente testes,
// possam importar a aplicação Express e realizar requisições sem precisar criar outra instância.
module.exports = { app };
