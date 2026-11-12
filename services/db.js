
"use strict";

// Importa o cliente oficial do MongoDB.
const { MongoClient } = require("mongodb");

// Armazena a conexão ativa com o MongoDB.
let cliente = null;

// Armazena a referência ao banco de dados.
let banco = null;

// Estabelece a conexão e prepara os índices da aplicação.
async function conectarMongoDB() {
    // Reutiliza a conexão caso ela já esteja estabelecida.
    if (banco) return banco;

    // Obtém o endereço de conexão configurado no arquivo .env.
    const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";

    // Obtém o nome do banco de dados.
    const nomeBanco = process.env.MONGODB_DB || "controle_acesso_radio";

    // Cria o cliente MongoDB com tempo limite para localizar o servidor.
    cliente = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000
    });

    // Estabelece a conexão com o servidor MongoDB.
    await cliente.connect();

    // Seleciona o banco de dados da aplicação.
    banco = cliente.db(nomeBanco);

    // Obtém a coleção responsável pelo histórico de eventos.
    const eventos = banco.collection("eventos_acesso");

    // Obtém a coleção responsável pelos cadastros de funcionários.
    const funcionarios = banco.collection("funcionarios");

    // Coleções de fotografias de ocorrências e auditoria das operações biométricas.
    const ocorrenciasFace = banco.collection("ocorrencias_face");
    const auditoriaBiometria = banco.collection("auditoria_biometria");

    // Cria um índice único para impedir a gravação repetida do mesmo evento identificado.
    await eventos.createIndex(
        { eventKey: 1 },
        { unique: true, name: "indice_evento_unico" }
    );

    // Cria um índice para pesquisar eventos por data.
    await eventos.createIndex(
        { "timing.occurredAt": -1 },
        { name: "indice_eventos_por_data" }
    );

    // Cria um índice para pesquisar o histórico por funcionário e data.
    await eventos.createIndex(
        {
            "employee.userId": 1,
            "timing.occurredAt": -1
        },
        { name: "indice_historico_funcionario" }
    );

    // Cria um índice único para o identificador do funcionário.
    await funcionarios.createIndex(
        { userId: 1 },
        { unique: true, name: "indice_funcionario_unico" }
    );

    await ocorrenciasFace.createIndex(
        { eventKey: 1 },
        { unique: true, name: "indice_ocorrencia_face_evento_unico" }
    );
    await ocorrenciasFace.createIndex(
        { "review.status": 1, occurredAt: -1 },
        { name: "indice_ocorrencias_face_revisao_data" }
    );
    await ocorrenciasFace.createIndex(
        { "retention.expiresAt": 1 },
        { name: "indice_ocorrencias_face_expiracao" }
    );
    await auditoriaBiometria.createIndex(
        { createdAt: -1 },
        { name: "indice_auditoria_biometria_data" }
    );

    // Retorna o banco conectado e preparado.
    return banco;
}

// Disponibiliza a referência ao banco para os outros módulos.
function obterBanco() {
    // Impede o acesso antes de estabelecer a conexão.
    if (!banco) {
        throw new Error("MongoDB ainda não foi conectado.");
    }

    // Retorna o banco de dados ativo.
    return banco;
}

// Exporta as funções utilizadas pelo servidor e pelos serviços.
module.exports = {
    conectarMongoDB,
    obterBanco
};
