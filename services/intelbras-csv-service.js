
"use strict"; // Ativa o modo estrito do JavaScript, ajudando a evitar comportamentos inesperados e erros de programação.

/**
 * Leitor mínimo de CSV Intelbras (exportação sem cabeçalho).
 * O serviço transforma apenas as colunas necessárias ao cadastro.
 * Colunas de foto facial, cartões, senhas e demais credenciais são ignoradas.
 */

// Declara a função responsável por interpretar o conteúdo de um arquivo CSV.
// Recebe o texto completo do arquivo e transforma suas informações em uma matriz de linhas e colunas.
function analisarCSV(texto) {

    // Verifica se o conteúdo recebido é realmente uma string.
    // Caso não seja, interrompe a execução e lança um TypeError.
    // Isso evita tentar interpretar valores que não sejam textos.
    if (typeof texto !== "string") {
        throw new TypeError("O conteúdo do CSV precisa ser texto.");
    }

    // Remove o BOM (Byte Order Mark) caso esteja presente no início do arquivo.
    // O BOM é um marcador utilizado em alguns arquivos de texto para indicar a codificação UTF-8.
    // Sua remoção evita que o primeiro campo do CSV comece com um caractere invisível.
    const conteudo = texto.replace(/^\uFEFF/, "");

    // Cria um array vazio que armazenará todas as linhas válidas do CSV.
    // Cada posição desse array representará uma linha do arquivo.
    const linhas = [];

    // Cria um array temporário para armazenar as colunas da linha que está sendo analisada.
    let linha = [];

    // Armazena temporariamente os caracteres que pertencem ao campo atual.
    // O conteúdo dessa variável será adicionado à linha quando uma separação for identificada.
    let campo = "";

    // Controla se o processo de leitura está dentro de um campo delimitado por aspas.
    // Quando true, vírgulas e quebras de linha são consideradas parte do conteúdo do campo.
    // Quando false, esses caracteres podem funcionar como separadores.
    let dentroAspas = false;

    // Percorre todo o conteúdo do CSV, analisando um caractere por vez.
    // A variável i representa a posição do caractere atual dentro do texto.
    for (let i = 0; i < conteudo.length; i++) {

        // Obtém o caractere localizado na posição atual do texto.
        const caractere = conteudo[i];

        // Verifica se o caractere atual é uma aspa dupla.
        // As aspas são utilizadas no CSV para delimitar campos que podem conter vírgulas
        // ou outros caracteres que normalmente seriam interpretados como separadores.
        if (caractere === '"') {

            // Verifica se já estamos dentro de um campo entre aspas
            // e se o próximo caractere também é uma aspa dupla.
            // No padrão CSV, duas aspas consecutivas dentro de um campo representam
            // uma única aspa que faz parte do conteúdo.
            if (dentroAspas && conteudo[i + 1] === '"') {

                // Adiciona somente uma aspa ao conteúdo do campo.
                // Assim, duas aspas consecutivas são convertidas em um único caractere.
                campo += '"';

                // Avança uma posição adicional no texto para ignorar a segunda aspa,
                // pois ela já foi interpretada junto com a primeira.
                i++;

            } else {

                // Alterna o estado da variável dentroAspas.
                // Se estava fora das aspas, passa para dentro.
                // Se estava dentro das aspas, passa para fora.
                dentroAspas = !dentroAspas;
            }

            // Interrompe a análise do caractere atual e retorna ao início do próximo ciclo.
            // Isso evita que as aspas sejam adicionadas diretamente ao conteúdo do campo.
            continue;
        }

        // Verifica se o caractere atual é uma vírgula e se não estamos dentro de aspas.
        // Nesse caso, a vírgula representa o separador entre duas colunas do CSV.
        if (!dentroAspas && caractere === ",") {

            // Adiciona o conteúdo do campo atual ao array da linha.
            linha.push(campo);

            // Limpa a variável campo para começar a armazenar a próxima coluna.
            campo = "";

            // Reinicia o ciclo para continuar lendo os caracteres seguintes.
            continue;
        }

        // Verifica se foi encontrada uma quebra de linha LF (\n) ou CR (\r)
        // enquanto o processo de leitura está fora de um campo entre aspas.
        // Nesse contexto, a quebra de linha representa o fim do registro atual.
        if (!dentroAspas && (caractere === "\n" || caractere === "\r")) {

            // Verifica se a quebra de linha atual é CRLF (\r\n).
            // Esse formato é comum em arquivos criados no Windows.
            // Se for CRLF, avança uma posição para tratar os dois caracteres como uma única quebra.
            if (caractere === "\r" && conteudo[i + 1] === "\n") i++;

            // Adiciona o último campo da linha ao array de colunas.
            linha.push(campo);

            // Verifica se existe pelo menos um campo com conteúdo não vazio.
            // O método some() percorre os elementos e retorna true quando encontra
            // pelo menos um valor cuja representação em texto não esteja vazia após trim().
            // Isso permite ignorar linhas completamente vazias.
            if (linha.some(valor => String(valor).trim() !== "")) {

                // Adiciona a linha completa ao array principal de linhas do CSV.
                linhas.push(linha);
            }

            // Cria um novo array para começar a leitura da próxima linha.
            linha = [];

            // Limpa o campo atual para receber o próximo conteúdo.
            campo = "";

            // Reinicia a repetição para continuar a leitura do arquivo.
            continue;
        }

        // Se o caractere não for um separador válido,
        // adiciona esse caractere ao conteúdo do campo atual.
        // Isso também permite preservar vírgulas e quebras de linha que estejam dentro de aspas.
        campo += caractere;
    }

    // Depois de percorrer o arquivo, verifica se existe algum campo com aspas abertas.
    // Isso significa que o CSV possui uma aspa de abertura sem o fechamento correspondente.
    if (dentroAspas) {

        // Interrompe a análise e informa que o arquivo possui uma estrutura inválida.
        throw new Error("CSV inválido: existe um campo com aspas não finalizadas.");
    }

    // Verifica se ainda existe conteúdo pendente depois do término do for.
    // Isso é necessário porque a última linha do arquivo pode não terminar com uma quebra de linha.
    // Também considera o caso de uma linha que já possui colunas armazenadas.
    if (campo.length > 0 || linha.length > 0) {

        // Adiciona o último campo ao array da linha.
        linha.push(campo);

        // Verifica novamente se a linha possui algum conteúdo válido.
        // Se possuir, adiciona a linha ao array principal.
        if (linha.some(valor => String(valor).trim() !== "")) linhas.push(linha);
    }

    // Retorna todas as linhas identificadas.
    // O resultado é uma matriz: cada elemento representa uma linha do CSV,
    // e cada elemento interno representa uma coluna.
    return linhas;
}


// Declara uma função responsável por traduzir o código numérico de permissão
// exportado pelo equipamento Intelbras para uma descrição compreensível.
function traduzirPermissao(codigo) {

    // Converte o código recebido em uma string e remove os espaços em branco
    // que eventualmente apareçam antes ou depois do valor.
    // O operador ?? substitui somente valores null ou undefined por uma string vazia.
    const valor = String(codigo ?? "").trim();

    // Verifica se o código recebido corresponde ao valor 1.
    // Caso corresponda, retorna a descrição "Administrador".
    if (valor === "1") return "Administrador";

    // Verifica se o código recebido corresponde ao valor 2.
    // Caso corresponda, retorna a descrição "Usuário comum".
    if (valor === "2") return "Usuário comum";

    // Se o código não for 1 nem 2, retorna null.
    // Isso indica que a aplicação não reconhece o código recebido.
    return null;
}


// Declara uma função responsável por converter uma única linha do CSV
// em um objeto de funcionário com os campos necessários ao sistema.
function converterLinhaIntelbras(linha, numeroLinha) {

    // Verifica se o valor recebido é um array e se possui exatamente 33 colunas.
    // O formato de exportação utilizado como referência para esse serviço
    // possui 33 colunas e não apresenta uma linha de cabeçalho.
    //
    // O operador ! nega a condição.
    // A propriedade length informa a quantidade de colunas existentes.
    // Caso a estrutura seja diferente do esperado, a função lança um erro.
    if (!Array.isArray(linha) || linha.length !== 33) {

        // Apresenta uma mensagem contendo o número da linha e a quantidade de colunas encontrada.
        // O operador ?. permite acessar length sem causar erro caso linha seja null ou undefined.
        // O operador ?? substitui null ou undefined por zero.
        // A mensagem também informa que nenhum dado foi importado.
        throw new Error(
            `Linha ${numeroLinha}: esperado CSV Intelbras com 33 colunas; recebido ${linha?.length ?? 0}. Nenhum dado foi importado.`
        );
    }

    // Obtém o ID do usuário localizado na primeira coluna do CSV.
    // O índice 0 representa a primeira posição do array.
    // O operador ?? fornece uma string vazia caso o campo seja null ou undefined.
    // String() converte o valor para texto e trim() remove espaços desnecessários.
    const userId = String(linha[0] ?? "").trim();

    // Obtém o nome do usuário localizado na segunda coluna do CSV.
    // O índice 1 representa a segunda posição do array.
    // Também converte o conteúdo para texto e remove espaços externos.
    const nome = String(linha[1] ?? "").trim();

    // Obtém o código de permissão armazenado na quinta coluna do CSV.
    // O índice 4 representa a quinta posição, pois os arrays começam no índice zero.
    const codigoPermissao = String(linha[4] ?? "").trim();

    // Chama a função traduzirPermissao() para converter o código numérico
    // em uma descrição textual, como "Administrador" ou "Usuário comum".
    const descricaoPermissao = traduzirPermissao(codigoPermissao);

    // Verifica se o ID do usuário foi preenchido.
    // Caso esteja vazio, interrompe a conversão e informa o número da linha inválida.
    if (!userId) throw new Error(`Linha ${numeroLinha}: ID do usuário vazio.`);

    // Verifica se o nome do usuário foi preenchido.
    // Se estiver vazio, apresenta uma mensagem contendo o ID do funcionário relacionado.
    if (!nome) throw new Error(`Linha ${numeroLinha}: nome do usuário vazio (ID ${userId}).`);

    // Verifica se o código de permissão foi reconhecido pela função traduzirPermissao().
    // Se o retorno for null, significa que o código não corresponde aos valores conhecidos.
    if (!descricaoPermissao) {

        // Interrompe a conversão e informa qual usuário possui o código não reconhecido.
        throw new Error(`Linha ${numeroLinha}: código de permissão não reconhecido para o ID ${userId}.`);
    }

    // Depois que todas as validações são aprovadas,
    // cria e retorna um objeto com os dados necessários do funcionário.
    return {

        // Armazena o identificador do usuário como texto.
        // Isso evita tratar o ID como uma operação matemática.
        userId,

        // Armazena o nome do funcionário.
        nome,

        // Cria um objeto interno com as informações da permissão cadastrada no terminal.
        permissaoDispositivo: {

            // Converte o código de permissão de texto para número.
            // Por exemplo, o texto "1" passa a ser o número 1.
            codigo: Number(codigoPermissao),

            // Armazena a descrição obtida pela função traduzirPermissao().
            descricao: descricaoPermissao
        },

        // Cria um objeto interno para armazenar o período de validade
        // registrado no equipamento para aquele funcionário.
        validadeDispositivo: {

            // Obtém o conteúdo da terceira coluna do CSV, correspondente ao início da validade.
            // Converte o valor para texto e remove espaços externos.
            // Se o campo estiver vazio, armazena null.
            inicio: String(linha[2] ?? "").trim() || null,

            // Obtém o conteúdo da quarta coluna do CSV, correspondente ao fim da validade.
            // Também remove espaços externos e utiliza null caso não exista informação.
            fim: String(linha[3] ?? "").trim() || null
        }
    };
}


// Declara a função principal que recebe o conteúdo completo de um CSV Intelbras
// e coordena as etapas de análise, conversão e validação dos funcionários.
function converterCSVIntelbras(texto) {

    // Chama analisarCSV() para transformar o texto do arquivo
    // em uma matriz contendo as linhas e suas respectivas colunas.
    const linhas = analisarCSV(texto);

    // Verifica se o arquivo possui alguma linha válida.
    // Se o array estiver vazio, significa que o arquivo não contém registros para importar.
    if (!linhas.length) throw new Error("O arquivo CSV está vazio.");

    // Percorre todas as linhas utilizando o método map().
    // Para cada linha, chama converterLinhaIntelbras().
    // O segundo argumento do callback, indice, representa a posição da linha no array.
    // Como o array começa no índice zero, soma-se 1 para exibir a numeração a partir de 1.
    //
    // O resultado é um novo array contendo os objetos de funcionários convertidos.
    // Caso uma linha apresente erro, a execução é interrompida pelo erro lançado na conversão.
    const funcionarios = linhas.map(
        (linha, indice) => converterLinhaIntelbras(linha, indice + 1)
    );

    // Cria um conjunto Set vazio para armazenar os IDs que já foram encontrados.
    // O Set permite verificar rapidamente se um valor já existe na coleção.
    const ids = new Set();

    // Percorre todos os funcionários já convertidos.
    // Cada funcionário é analisado individualmente para verificar se seu ID é único.
    for (const funcionario of funcionarios) {

        // Verifica se o conjunto já possui o ID do funcionário atual.
        // Se o ID já existir, significa que o arquivo contém um cadastro duplicado.
        if (ids.has(funcionario.userId)) {

            // Interrompe a execução e apresenta o ID duplicado.
            // A mensagem também informa que nenhum dado foi importado.
            throw new Error(
                `O arquivo contém ID duplicado: ${funcionario.userId}. Nenhum dado foi importado.`
            );
        }

        // Se o ID ainda não existir, adiciona o valor ao conjunto.
        // Isso permite que as próximas iterações identifiquem eventuais repetições.
        ids.add(funcionario.userId);
    }

    // Se todas as linhas forem convertidas corretamente e não existirem IDs duplicados,
    // retorna o array completo de funcionários.
    return funcionarios;
}


// Exporta as quatro funções para permitir que outros arquivos do projeto utilizem esse serviço.
// O module.exports é o mecanismo de exportação de módulos utilizado pelo CommonJS no Node.js.
module.exports = {

    // Disponibiliza a função que interpreta o texto CSV e separa suas linhas e colunas.
    analisarCSV,

    // Disponibiliza a função que converte códigos numéricos em descrições de permissões.
    traduzirPermissao,

    // Disponibiliza a função responsável por converter e validar uma única linha do arquivo.
    converterLinhaIntelbras,

    // Disponibiliza a função principal que converte e valida o arquivo CSV completo.
    converterCSVIntelbras
};
