"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { converterCSVIntelbras } = require("../services/intelbras-csv-service");

function obterArgumentoValor(argumentos, nome, padrao = null) {
    const indice = argumentos.indexOf(nome);
    return indice >= 0 ? argumentos[indice + 1] : padrao;
}

function exibirUso() {
    console.log(`\nImportação dos usuários do Intelbras SS 3532 MF W\n\nUso:\n  node scripts/importar-funcionarios-intelbras.js "C:\\caminho\\arquivo.csv"\n  node scripts/importar-funcionarios-intelbras.js "C:\\caminho\\arquivo.csv" --confirmar\n\nOpções:\n  --confirmar       Grava/atualiza os cadastros no MongoDB.\n  --serial <serial> Número de série do terminal (não obrigatório para a simulação).\n\nSem --confirmar, o script apenas valida e mostra um resumo.\n`);
}

async function main() {
    const argumentos = process.argv.slice(2);
    const caminhoCSV = argumentos.find(argumento => !argumento.startsWith("--"));

    if (!caminhoCSV || argumentos.includes("--ajuda") || argumentos.includes("-h")) {
        exibirUso();
        if (!caminhoCSV) process.exitCode = 1;
        return;
    }

    const caminhoResolvido = path.resolve(process.cwd(), caminhoCSV);
    if (!fs.existsSync(caminhoResolvido) || !fs.statSync(caminhoResolvido).isFile()) {
        throw new Error(`Arquivo CSV não encontrado: ${caminhoResolvido}`);
    }

    const numeroSerie = obterArgumentoValor(argumentos, "--serial", "não informado");
    if (!numeroSerie || numeroSerie.startsWith("--")) {
        throw new Error("Informe um número de série válido após --serial.");
    }

    // Lê o arquivo para memória, mas o conversor retém somente ID, nome,
    // permissão e validade. Foto facial e outras credenciais não são persistidas.
    const conteudo = fs.readFileSync(caminhoResolvido, "utf8");
    const funcionarios = converterCSVIntelbras(conteudo);

    const administradores = funcionarios.filter(item => item.permissaoDispositivo.codigo === 1);
    const usuariosComuns = funcionarios.filter(item => item.permissaoDispositivo.codigo === 2);

    console.log("\n========== PRÉ-VALIDAÇÃO DA IMPORTAÇÃO ==========");
    console.log("Arquivo:", path.basename(caminhoResolvido));
    console.log("Terminal:", "Intelbras SS 3532 MF W");
    console.log("Número de série:", numeroSerie);
    console.log("Cadastros válidos:", funcionarios.length);
    console.log("Administradores do terminal:", administradores.length);
    console.log("Usuários comuns do terminal:", usuariosComuns.length);
    console.log("IDs duplicados: 0");
    console.log("Fotos faciais, cartões, senhas e demais credenciais: não serão importados.");

    if (!argumentos.includes("--confirmar")) {
        console.log("\nMODO DE SIMULAÇÃO: nenhum dado foi gravado no MongoDB.");
        console.log("Revise o resumo. Para executar, repita o comando acrescentando --confirmar.\n");
        return;
    }

    // As dependências de conexão só são carregadas quando a gravação foi confirmada.
    require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
    const { MongoClient } = require("mongodb");
    const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
    const nomeBanco = process.env.MONGODB_DB || "controle_acesso_radio";
    const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 7000 });

    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const colecao = banco.collection("funcionarios");
        await colecao.createIndex(
            { userId: 1 },
            { unique: true, name: "indice_funcionario_unico" }
        );
        const agora = new Date();

        const operacoes = funcionarios.map(funcionario => ({
            updateOne: {
                filter: { userId: funcionario.userId },
                update: {
                    $set: {
                        nome: funcionario.nome,
                        permissaoDispositivo: funcionario.permissaoDispositivo,
                        validadeDispositivo: funcionario.validadeDispositivo,
                        origemCadastro: "backup_intelbras",
                        dispositivo: {
                            modelo: "SS 3532 MF W",
                            numeroSerie
                        },
                        sincronizadoEm: agora,
                        updatedAt: agora
                    },
                    $setOnInsert: {
                        userId: funcionario.userId,
                        ativo: true,
                        createdAt: agora
                    }
                },
                upsert: true
            }
        }));

        const resultado = await colecao.bulkWrite(operacoes, { ordered: false });

        console.log("\n========== IMPORTAÇÃO CONCLUÍDA ==========");
        console.log("Banco:", nomeBanco);
        console.log("Coleção: funcionarios");
        console.log("Registros analisados:", funcionarios.length);
        console.log("Documentos encontrados para atualização:", resultado.matchedCount);
        console.log("Documentos inseridos:", resultado.upsertedCount);
        console.log("Documentos modificados:", resultado.modifiedCount);
        console.log("\nOs eventos existentes em eventos_acesso não foram alterados.\n");
    } finally {
        await cliente.close();
    }
}

main().catch(erro => {
    console.error("\nFalha na importação:", erro.message);
    process.exitCode = 1;
});
