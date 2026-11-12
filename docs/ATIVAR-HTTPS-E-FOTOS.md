# Ativar HTTPS e fotos das ocorrências Intelbras

Este guia mantém o dashboard HTTP atual na porta 3000 e acrescenta HTTPS na porta 3443. Não altera o MongoDB, os cadastros, os eventos existentes nem as regras de acesso do terminal.

## 1. Antes de começar

1. Faça uma cópia de segurança da pasta do projeto.
2. Não apague `.env`, `storage/`, `certs/` nem `node_modules/` existentes.
3. A versão do pacote não inclui `.env`, certificados, fotografias armazenadas ou credenciais.
4. Pare o Node.js com `Ctrl+C` antes de substituir os arquivos de código.

Extraia o conteúdo do projeto na pasta escolhida para a instalação e aceite substituir somente os arquivos de código. Como `.env`, `certs/` e `storage/` não estão no ZIP, eles não serão substituídos.

## 2. Gerar o certificado local no TIMIDIAS

Abra PowerShell na pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$ipServidor = Read-Host "Informe o IP do computador que executará o servidor"
.\scripts\gerar-certificado-https.ps1 -IpServidor $ipServidor
```

O script cria `certs\controle-acesso.pfx` e `certs\controle-acesso-root-ca.cer`, importa a CA para o perfil Windows do usuário atual e atualiza no `.env` somente as variáveis HTTPS. A senha do PFX é aleatória e fica gravada no `.env` local; não a envie pelo chat.

A CA é privada/local. Outros computadores que precisem abrir a área biométrica deverão confiar no arquivo `certs\controle-acesso-root-ca.cer`. O terminal Intelbras também precisa aceitar a cadeia do certificado para enviar o POST HTTPS. A documentação pública consultada explica a opção HTTPS de POST, mas não documenta um procedimento de importação de CA personalizada no terminal. Portanto, não altere o POST do equipamento até validar essa confiança; caso o terminal rejeite a CA local, será necessário um certificado de uma CA reconhecida pelo firmware e um nome DNS que o terminal resolva.

## 3. Liberar a porta 3443 no Firewall

Abra PowerShell como Administrador, entre na pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\configurar-firewall-https.ps1
```

A regra permite TCP 3443 somente a partir da sub-rede local. A regra TCP 3000 não é removida nem alterada.

## 4. Conferir o `.env`

O script de certificado já configura as variáveis HTTPS. Confira sem exibir o restante do `.env`:

```powershell
Get-Content .\.env | Where-Object {
    $_ -match '^(PORT|HTTPS_PORT|HTTPS_PFX_PATH|HTTPS_KEY_PATH|HTTPS_CERT_PATH)='
}
```

Mantenha `PORT=3000`. O HTTPS deve ficar em `HTTPS_PORT=3443` com `HTTPS_PFX_PATH=./certs/controle-acesso.pfx`.

Depois, inclua manualmente esta variável no `.env`, ainda sem valor até conferir o IP de origem:

```env
INTELBRAS_WEBHOOK_IPS=
```

O IP correto é o que aparece em `Origem:` no console do `server.js` quando chega uma notificação real enviada pelo terminal. Não presuma que o endereço de origem seja igual ao IP usado para acessar a interface web do terminal. Configure a variável somente com o IP efetivamente observado no log.

As fotos ficam em `BIOMETRIA_STORAGE_DIR=./storage/ocorrencias-face` e a retenção continua em 30 dias (`BIOMETRIA_RETENCAO_DIAS=30`). Se omitidas, essas são as opções padrão do aplicativo.

## 5. Iniciar e testar o servidor, sem mexer no terminal

Na pasta do projeto:

```powershell
npm start
```

O console deverá mostrar o MongoDB conectado e os dois listeners:

```text
Servidor HTTP iniciado em http://localhost:3000
Servidor HTTPS iniciado na porta configurada em HTTPS_PORT (padrão: 3443)
```

Em outro PowerShell no TIMIDIAS:

```powershell
Test-NetConnection 127.0.0.1 -Port 3000
Test-NetConnection 127.0.0.1 -Port 3443
$ipServidor = Read-Host "Informe o IP do computador servidor"
Test-NetConnection $ipServidor -Port 3443
```

Abra `https://IP_DO_SERVIDOR:3443` no navegador, substituindo `IP_DO_SERVIDOR` pelo endereço real do servidor. O navegador precisa confiar na CA local. Para outro computador Windows, importe `certs\controle-acesso-root-ca.cer` em **Autoridades de Certificação Raiz Confiáveis** do usuário que abrirá o site. Não ignore avisos de certificado em produção.

## 6. Confirmar o IP de origem antes de editar o POST Intelbras

Com o terminal ainda apontando para o destino atual, aguarde uma notificação normal e anote apenas o endereço mostrado em `Origem:` no console Node. Se ele for diferente do IP que está em `INTELBRAS_WEBHOOK_IPS`, atualize a variável. Não configure uma lista com IP incorreto: quando a lista contém um endereço, o servidor rejeita notificações de outros endereços, inclusive os eventos em texto.

Se a lista ficar vazia, os eventos textuais continuam sendo recebidos, mas as fotos não serão gravadas porque nenhuma origem estará autorizada.

## 7. Só depois: configurar POST eventos na Intelbras

Quando a porta 3443 estiver testada e a confiança do certificado pelo terminal estiver confirmada, configure no menu POST eventos:

- Ativar: habilitado;
- Transmissão continuada: habilitada;
- ReportPicture: habilitado;
- Endereço do servidor: IP real do computador servidor;
- Porta: `3443`;
- Path do servidor: `/api/eventos`;
- HTTPS: habilitado.

A opção POST/HTTPS não deve ser confundida com a opção HTTPS de CGI em Utilidades/Segurança: são comunicações diferentes. Não mude o POST enquanto a conexão HTTPS não tiver sido aprovada no terminal, pois isso pode interromper o recebimento atual.

## 8. Como validar o armazenamento

Faça um teste controlado de tentativa facial negada e não identificada. No console, verifique:

- `Canal seguro: true`;
- `Origem:` com o IP que está autorizado em `INTELBRAS_WEBHOOK_IPS`;
- `Partes de imagem recebidas: 1` (ou quantidade maior, conforme eventos enviados);
- `Imagens associadas a eventos: 1`;
- `ocorrenciasFaciaisSalvas: 1` no resultado.

O sistema somente cria ocorrência fotográfica para eventos `AccessControl`, `Status=0`, `Method=15`, sem `UserID` válido, com imagem JPEG/PNG válida de até 2 MB. Eventos de funcionários reconhecidos continuam no histórico comum, mas não entram na lista de pendentes não identificados.

Se `Partes de imagem recebidas: 0`, o terminal não anexou imagem ou enviou um formato diferente do esperado; confira ReportPicture, Content-Type e o log. Se houver imagens mas forem descartadas por segurança, confira HTTPS e IP permitido. Se `ocorrenciasFaciaisSalvas` for zero apesar de a imagem estar associada, confira os campos do evento, o formato e o tamanho da foto ou a existência de duplicata.
