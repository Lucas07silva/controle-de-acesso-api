"use strict";

/**
 * Leitor mínimo de CSV Intelbras (exportação sem cabeçalho).
 * O serviço transforma apenas as colunas necessárias ao cadastro.
 * Colunas de foto facial, cartões, senhas e demais credenciais são ignoradas.
 */
function analisarCSV(texto) {
    if (typeof texto !== "string") {
        throw new TypeError("O conteúdo do CSV precisa ser texto.");
    }

    const conteudo = texto.replace(/^\uFEFF/, "");
    const linhas = [];
    let linha = [];
    let campo = "";
    let dentroAspas = false;

    for (let i = 0; i < conteudo.length; i++) {
        const caractere = conteudo[i];

        if (caractere === '"') {
            if (dentroAspas && conteudo[i + 1] === '"') {
                campo += '"';
                i++;
            } else {
                dentroAspas = !dentroAspas;
            }
            continue;
        }

        if (!dentroAspas && caractere === ",") {
            linha.push(campo);
            campo = "";
            continue;
        }

        if (!dentroAspas && (caractere === "\n" || caractere === "\r")) {
            if (caractere === "\r" && conteudo[i + 1] === "\n") i++;
            linha.push(campo);
            if (linha.some(valor => String(valor).trim() !== "")) linhas.push(linha);
            linha = [];
            campo = "";
            continue;
        }

        campo += caractere;
    }

    if (dentroAspas) {
        throw new Error("CSV inválido: existe um campo com aspas não finalizadas.");
    }

    if (campo.length > 0 || linha.length > 0) {
        linha.push(campo);
        if (linha.some(valor => String(valor).trim() !== "")) linhas.push(linha);
    }

    return linhas;
}

function traduzirPermissao(codigo) {
    const valor = String(codigo ?? "").trim();
    if (valor === "1") return "Administrador";
    if (valor === "2") return "Usuário comum";
    return null;
}

function converterLinhaIntelbras(linha, numeroLinha) {
    // Este backup SS 3532 MF W tem 33 colunas, sem linha de cabeçalho.
    if (!Array.isArray(linha) || linha.length !== 33) {
        throw new Error(`Linha ${numeroLinha}: esperado CSV Intelbras com 33 colunas; recebido ${linha?.length ?? 0}. Nenhum dado foi importado.`);
    }

    const userId = String(linha[0] ?? "").trim();
    const nome = String(linha[1] ?? "").trim();
    const codigoPermissao = String(linha[4] ?? "").trim();
    const descricaoPermissao = traduzirPermissao(codigoPermissao);

    if (!userId) throw new Error(`Linha ${numeroLinha}: ID do usuário vazio.`);
    if (!nome) throw new Error(`Linha ${numeroLinha}: nome do usuário vazio (ID ${userId}).`);
    if (!descricaoPermissao) {
        throw new Error(`Linha ${numeroLinha}: código de permissão não reconhecido para o ID ${userId}.`);
    }

    return {
        userId,
        nome,
        permissaoDispositivo: {
            codigo: Number(codigoPermissao),
            descricao: descricaoPermissao
        },
        validadeDispositivo: {
            inicio: String(linha[2] ?? "").trim() || null,
            fim: String(linha[3] ?? "").trim() || null
        }
    };
}

function converterCSVIntelbras(texto) {
    const linhas = analisarCSV(texto);
    if (!linhas.length) throw new Error("O arquivo CSV está vazio.");

    const funcionarios = linhas.map((linha, indice) => converterLinhaIntelbras(linha, indice + 1));
    const ids = new Set();
    for (const funcionario of funcionarios) {
        if (ids.has(funcionario.userId)) {
            throw new Error(`O arquivo contém ID duplicado: ${funcionario.userId}. Nenhum dado foi importado.`);
        }
        ids.add(funcionario.userId);
    }

    return funcionarios;
}

module.exports = {
    analisarCSV,
    traduzirPermissao,
    converterLinhaIntelbras,
    converterCSVIntelbras
};
