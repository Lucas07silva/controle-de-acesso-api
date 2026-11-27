
"use strict"; // Ativa o modo estrito do JavaScript, ajudando a evitar erros como a criação acidental de variáveis sem declaração.

// Declara uma função que recebe os bytes de uma imagem JPEG e tenta descobrir suas dimensões.
// Retorna um objeto com largura, altura e formato ou null caso não consiga identificar as dimensões.
function lerDimensoesJpeg(buffer) {

    // Verifica se o buffer possui pelo menos quatro bytes e se começa com a assinatura JPEG.
    // Os bytes FF D8 representam o marcador de início de uma imagem JPEG (SOI).
    // Caso alguma condição não seja atendida, interrompe a função e retorna null.
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

    // Inicializa a posição de leitura no índice 2.
    // Os dois primeiros bytes já foram utilizados para verificar a assinatura JPEG.
    let offset = 2;

    // Cria um conjunto (Set) contendo os marcadores JPEG que identificam segmentos SOF.
    // SOF (Start Of Frame) contém informações sobre as dimensões e a estrutura da imagem.
    // Esses marcadores permitem localizar a largura e a altura da fotografia.
    const marcadoresSof = new Set([
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
    ]);

    // Percorre o conteúdo do buffer enquanto ainda existirem bytes para analisar.
    // O objetivo é localizar os segmentos que contêm as dimensões da imagem.
    while (offset < buffer.length) {

        // Verifica se o byte atual não corresponde ao início de um marcador JPEG.
        // Se não for FF, avança uma posição para continuar procurando.
        // A instrução continue reinicia o próximo ciclo do while.
        if (buffer[offset] !== 0xff) {
            offset++;
            continue;
        }

        // Avança enquanto encontrar bytes FF consecutivos.
        // Em JPEG, esses bytes podem aparecer repetidamente antes do marcador.
        while (buffer[offset] === 0xff) offset++;

        // Lê o byte seguinte e identifica qual marcador JPEG foi encontrado.
        // O operador ++ também avança a posição de leitura para o próximo byte.
        const marcador = buffer[offset++];

        // Verifica se encontrou o marcador EOI (D9), que indica o fim da imagem,
        // ou SOS (DA), que indica o início dos dados de imagem.
        // Se um desses marcadores aparecer antes de encontrar as dimensões,
        // a função encerra a busca.
        if (marcador === 0xd9 || marcador === 0xda) break;

        // Alguns marcadores não possuem um campo de tamanho.
        // O marcador 01 é utilizado como marcador temporário.
        // Os marcadores D0 até D7 são utilizados para reinício do processamento JPEG.
        // Como esses marcadores não precisam ser tratados como segmentos com tamanho,
        // a função continua procurando o próximo marcador.
        if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) continue;

        // Verifica se existem pelo menos dois bytes disponíveis para ler o tamanho
        // do próximo segmento JPEG.
        // Caso contrário, os dados estão incompletos e a função retorna null.
        if (offset + 2 > buffer.length) return null;

        // Lê os próximos dois bytes como um número inteiro sem sinal de 16 bits.
        // readUInt16BE utiliza a ordem Big Endian, em que o byte mais significativo vem primeiro.
        // Esse valor representa o tamanho do segmento, incluindo os próprios bytes de tamanho.
        const tamanho = buffer.readUInt16BE(offset);

        // Verifica se o segmento possui um tamanho válido.
        // O tamanho precisa ser pelo menos 2 bytes e não pode ultrapassar
        // o limite disponível no buffer.
        // Caso contrário, a função considera os dados inválidos ou incompletos.
        if (tamanho < 2 || offset + tamanho > buffer.length) return null;

        // Verifica se o marcador encontrado pertence ao conjunto de marcadores SOF.
        // Caso pertença, significa que o segmento pode conter as dimensões da imagem.
        if (marcadoresSof.has(marcador)) {

            // Confere se existem bytes suficientes para acessar os campos de altura e largura.
            // O teste evita tentar ler posições que ultrapassem o tamanho do buffer.
            if (offset + 7 > buffer.length) return null;

            // Retorna um objeto contendo as dimensões e a identificação do formato.
            return {
                // Lê a largura da imagem em dois bytes, na posição offset + 5.
                largura: buffer.readUInt16BE(offset + 5),

                // Lê a altura da imagem em dois bytes, na posição offset + 3.
                altura: buffer.readUInt16BE(offset + 3),

                // Informa o tipo MIME correspondente ao formato JPEG.
                mime: "image/jpeg",

                // Informa a extensão de arquivo correspondente ao formato JPEG.
                extensao: "jpg"
            };
        }

        // Caso o segmento não seja um marcador SOF, avança o deslocamento
        // pelo tamanho completo do segmento para continuar a análise.
        offset += tamanho;
    }

    // Se o percurso terminar sem encontrar um marcador SOF válido,
    // significa que não foi possível identificar as dimensões da imagem.
    return null;
}


// Declara uma função responsável por identificar as dimensões de uma imagem PNG.
// Recebe os bytes da imagem e retorna largura, altura e formato ou null.
function lerDimensoesPng(buffer) {

    // Cria um buffer contendo a assinatura oficial de arquivos PNG.
    // Os oito bytes permitem identificar o formato do arquivo.
    const assinatura = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
    ]);

    // Verifica se o arquivo possui pelo menos 24 bytes.
    // Também compara os primeiros oito bytes do arquivo com a assinatura PNG.
    // Se o tamanho for insuficiente ou a assinatura estiver incorreta,
    // a função interrompe a execução e retorna null.
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(assinatura)) return null;

    // Verifica se o identificador do primeiro bloco de dados PNG é IHDR.
    // O bloco IHDR contém informações importantes sobre a imagem,
    // incluindo sua largura e altura.
    // O método toString converte os bytes das posições 12 até 15 em texto ASCII.
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;

    // Retorna as dimensões e a identificação do formato PNG.
    return {

        // Lê quatro bytes a partir da posição 16 para obter a largura da imagem.
        // O valor é interpretado como um inteiro sem sinal de 32 bits em Big Endian.
        largura: buffer.readUInt32BE(16),

        // Lê quatro bytes a partir da posição 20 para obter a altura da imagem.
        altura: buffer.readUInt32BE(20),

        // Informa o tipo MIME correspondente ao formato PNG.
        mime: "image/png",

        // Informa a extensão utilizada em arquivos PNG.
        extensao: "png"
    };
}


// Declara a função responsável por validar uma fotografia facial recebida
// no formato Data URL, normalmente gerada pelo navegador.
function validarFotoFacialDataUrl(dataUrl) {

    // Verifica se o valor recebido é uma string.
    // Caso não seja, interrompe a operação e apresenta uma mensagem de erro.
    // Essa validação evita tentar executar operações de texto em um valor inválido.
    if (typeof dataUrl !== "string") throw new Error("Selecione uma fotografia facial.");

    // Utiliza uma expressão regular para verificar a estrutura do Data URL.
    // Aceita somente imagens JPEG no formato Base64.
    // O grupo ([A-Za-z0-9+/=]+) captura o conteúdo codificado da imagem.
    // O modificador i permite letras maiúsculas ou minúsculas no tipo informado.
    const correspondencia = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/i);

    // Se a expressão regular não encontrar correspondência,
    // significa que o conteúdo não segue o formato esperado.
    // Nesse caso, apresenta uma mensagem informando que é necessário selecionar JPG/JPEG.
    if (!correspondencia) throw new Error("Para cadastro facial no terminal, selecione uma fotografia JPG/JPEG.");

    // Obtém somente o conteúdo Base64 da imagem.
    // A posição 1 representa o primeiro grupo capturado pela expressão regular,
    // ou seja, os dados que aparecem depois de data:image/jpeg;base64,.
    const base64 = correspondencia[1];

    // A API CGI recebe a fotografia codificada em Base64 e limita o campo PhotoData a 200 kB.
    // Lê o limite configurado na variável de ambiente BIOMETRIA_FOTO_MAX_BASE64_CHARS.
    // Number converte o valor recebido em número.
    // O operador || utiliza 200000 como valor padrão quando a configuração não existe
    // ou resulta em um valor considerado falso, como zero ou NaN.
    // Math.min impede que a configuração ultrapasse o limite absoluto de 200000 caracteres.
    const limiteBase64 = Math.min(
        Number(process.env.BIOMETRIA_FOTO_MAX_BASE64_CHARS) || 200000,
        200000
    );

    // Verifica se o conteúdo Base64 está vazio ou ultrapassa o limite permitido.
    // Caso alguma dessas situações ocorra, interrompe o processamento da fotografia.
    if (!base64.length || base64.length > limiteBase64) {

        // Apresenta uma mensagem de erro informando o limite aproximado em KB.
        // A divisão por 1024 converte a quantidade de caracteres em uma referência aproximada de KB.
        // Math.round arredonda o resultado para um número inteiro.
        throw new Error(`A fotografia codificada deve ter no máximo ${Math.round(limiteBase64 / 1024)} KB em Base64.`);
    }

    // Converte o conteúdo Base64 em um Buffer.
    // Buffer é uma estrutura do Node.js utilizada para trabalhar diretamente com dados binários.
    // Nesse caso, ela permite analisar os bytes reais da fotografia.
    const buffer = Buffer.from(base64, "base64");

    // Chama lerDimensoesJpeg para identificar o cabeçalho JPEG
    // e obter as dimensões da fotografia.
    const dimensoes = lerDimensoesJpeg(buffer);

    // Verifica se as dimensões puderam ser identificadas.
    // Também confirma se o tipo MIME retornado corresponde a JPEG.
    // Se alguma condição não for atendida, considera a imagem inválida.
    if (!dimensoes || dimensoes.mime !== "image/jpeg") {
        throw new Error("O arquivo não parece ser uma imagem JPG/JPEG válida.");
    }

    // Valida a resolução da fotografia.
    // A largura não pode ser inferior a 150 nem superior a 600 pixels.
    // A altura não pode ser inferior a 300 nem superior a 1200 pixels.
    // O operador || significa que basta uma dessas condições ser verdadeira
    // para a fotografia ser rejeitada.
    if (
        dimensoes.largura < 150 ||
        dimensoes.altura < 300 ||
        dimensoes.largura > 600 ||
        dimensoes.altura > 1200
    ) {

        // Interrompe a operação caso a resolução esteja fora do intervalo permitido.
        throw new Error("A resolução deve ficar entre 150 × 300 e 600 × 1200 pixels.");
    }

    // Se todas as validações forem aprovadas, retorna os dados da fotografia.
    return {

        // Buffer com os bytes binários da imagem.
        // Pode ser utilizado para transmitir ou salvar o arquivo.
        buffer,

        // Conteúdo original da fotografia codificado em Base64.
        // Pode ser utilizado na comunicação com a API CGI do equipamento.
        base64,

        // Tipo MIME identificado durante a leitura do JPEG.
        mime: dimensoes.mime,

        // Largura da fotografia em pixels.
        largura: dimensoes.largura,

        // Altura da fotografia em pixels.
        altura: dimensoes.altura,

        // Quantidade de bytes ocupada pela imagem após a conversão do Base64.
        bytes: buffer.length,

        // Extensão do arquivo correspondente ao formato identificado.
        extensao: dimensoes.extensao
    };
}


// Declara uma função utilizada para identificar o formato de uma imagem
// recebida junto aos eventos enviados pelo terminal Intelbras.
function identificarImagemEvento(buffer) {

    // Verifica se o conteúdo recebido é realmente um Buffer.
    // Também exige pelo menos 12 bytes para continuar a identificação.
    // Se o tipo ou o tamanho estiver incorreto, retorna null.
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    // Verifica se os três primeiros bytes correspondem à assinatura inicial JPEG.
    // A sequência FF D8 FF é utilizada para reconhecer arquivos desse formato.
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {

        // Retorna o tipo MIME e a extensão correspondentes ao formato JPEG.
        return {
            mime: "image/jpeg",
            extensao: "jpg"
        };
    }

    // Cria um buffer contendo a assinatura oficial do formato PNG.
    // Esse valor será comparado com os primeiros oito bytes da imagem recebida.
    const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
    ]);

    // Compara os primeiros oito bytes do arquivo com a assinatura PNG.
    // O método subarray(0, 8) seleciona os oito primeiros bytes.
    // equals verifica se o conteúdo é exatamente igual à assinatura esperada.
    if (buffer.subarray(0, 8).equals(png)) {

        // Retorna o tipo MIME e a extensão correspondentes ao formato PNG.
        return {
            mime: "image/png",
            extensao: "png"
        };
    }

    // Se o arquivo não apresentar nenhuma das assinaturas reconhecidas,
    // a função retorna null para indicar que o formato não foi identificado.
    return null;
}


// Exporta as quatro funções para que outros arquivos do projeto possam utilizá-las.
// O module.exports permite compartilhar essas funções com outros módulos do Node.js.
module.exports = {

    // Disponibiliza a função de leitura das dimensões de imagens JPEG.
    lerDimensoesJpeg,

    // Disponibiliza a função de leitura das dimensões de imagens PNG.
    lerDimensoesPng,

    // Disponibiliza a função que valida fotografias faciais recebidas em Data URL.
    validarFotoFacialDataUrl,

    // Disponibiliza a função que identifica o formato das imagens recebidas em eventos.
    identificarImagemEvento
};
