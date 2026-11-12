
// Importa o cliente oficial do MongoDB.
const { MongoClient } = require("mongodb");

// Importa o módulo path para localizar o arquivo .env.
const path = require("path");

// Carrega as variáveis de ambiente do projeto.
require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

// Define o endereço de conexão com o MongoDB.
const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";

// Define o nome do banco de dados.
const NOME_BANCO = process.env.MONGODB_DB || "controle_acesso_radio";

// Cria o cliente responsável pela conexão com o MongoDB.
const cliente = new MongoClient(URI, {
    serverSelectionTimeoutMS: 5000
});

// Executa o teste de conexão.
async function testarConexao() {
    try {
        // Estabelece a conexão com o servidor MongoDB.
        await cliente.connect();

        // Seleciona o banco de dados da aplicação.
        const banco = cliente.db(NOME_BANCO);

        // Envia um comando ping para verificar a comunicação.
        const resultado = await banco.command({ ping: 1 });

        // Exibe o resultado da conexão.
        console.log("==================================");
        console.log("CONEXÃO COM MONGODB ESTABELECIDA");
        console.log("==================================");
        console.log("Banco:", banco.databaseName);
        console.log("Resposta do servidor:", resultado.ok);
        console.log("Status: FUNCIONANDO");
    } catch (erro) {
        // Exibe o erro caso a conexão não seja estabelecida.
        console.error("ERRO AO CONECTAR AO MONGODB:");
        console.error(erro.message);

        // Informa ao Windows que o teste terminou com falha.
        process.exitCode = 1;
    } finally {
        // Fecha a conexão após concluir o teste.
        await cliente.close();
    }
}

// Inicia a execução do teste.
testarConexao();
