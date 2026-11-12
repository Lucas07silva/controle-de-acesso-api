# Módulo de cadastro facial e ocorrências não identificadas

## Escopo

Este módulo acrescenta duas funções administrativas:

1. Enviar uma fotografia facial para um funcionário que já esteja cadastrado no terminal Intelbras, usando o `UserID` existente. A função não cria usuários nem altera permissões.
2. Guardar a fotografia anexada a um evento de reconhecimento facial local negado, sem `UserID`, para revisão humana. O sistema não compara rostos, não cria uma identidade automaticamente e não associa automaticamente a fotografia a um funcionário.

As fotografias de ocorrências ficam fora de `public/`, com nome derivado de hash e acesso somente por rota autenticada. A retenção padrão é de 30 dias e pode ser ajustada em `BIOMETRIA_RETENCAO_DIAS`.

## 1. Configurar a conta administrativa do dashboard

No `.env`, defina uma conta exclusiva para o painel. Não reutilize a senha do terminal Intelbras nem as contas dos funcionários.

```env
BIOMETRIA_ADMIN_USER=admin
BIOMETRIA_ADMIN_PASSWORD=PIN_NUMERICO_DE_4_DIGITOS_OU_SENHA_DE_12_CARACTERES
BIOMETRIA_SESSION_SECRET=COLOQUE_UM_SEGREDO_ALEATORIO_COM_32_OU_MAIS_CARACTERES
BIOMETRIA_RETENCAO_DIAS=30
BIOMETRIA_STORAGE_DIR=./storage/ocorrencias-face
BIOMETRIA_FOTO_MAX_BASE64_CHARS=200000
```

A senha administrativa aceita um PIN numérico de exatamente 4 dígitos ou uma senha tradicional de pelo menos 12 caracteres. Como o PIN tem baixa entropia, o login limita a 5 tentativas por endereço IP a cada janela de 15 minutos. Mantenha o painel acessível somente pela rede interna e sempre por HTTPS em outros computadores.

Gere um segredo aleatório localmente no PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Copie o resultado para `BIOMETRIA_SESSION_SECRET`. Não compartilhe o `.env` e não coloque credenciais em capturas de tela.

A sessão administrativa dura duas horas. O cookie é `HttpOnly` e `SameSite=Strict`; em HTTPS também recebe a marca `Secure`.

## 2. HTTPS do site e do POST de eventos

As funções biométricas remotas exigem HTTPS. O dashboard comum continua disponível em HTTP na porta configurada em `PORT`; a aplicação também inicia um listener HTTPS quando recebe um PFX (`HTTPS_PFX_PATH`) ou um par PEM (`HTTPS_KEY_PATH` e `HTTPS_CERT_PATH`).

```env
PORT=3000
HTTPS_PORT=3443
HTTPS_PFX_PATH=./certs/controle-acesso.pfx
HTTPS_PFX_PASSPHRASE=senha-do-pfx
# Alternativa PEM:
HTTPS_KEY_PATH=
HTTPS_CERT_PATH=
TRUST_PROXY=0
```

Para preparar um certificado local de validação no TIMIDIAS, execute o PowerShell na raiz do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$ipServidor = Read-Host "Informe o IP do computador servidor"
.\scripts\gerar-certificado-https.ps1 -IpServidor $ipServidor
```

O script cria uma CA privada local, o PFX de servidor e o certificado público `.cer` da CA; configura os caminhos e a senha do PFX no `.env` local, sem exibir a senha. O certificado `.cer` precisa ser confiado pelos clientes que acessam o HTTPS. Uma CA privada não é automaticamente confiável pelo terminal Intelbras: antes de trocar o POST do equipamento, confirme se o firmware aceita a cadeia apresentada. Se não aceitar, será necessário usar um certificado de uma CA que o terminal reconheça, associado a um nome DNS que o equipamento consiga resolver. Não desative a validação TLS nem use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Para uso atrás de proxy reverso, configure `TRUST_PROXY=1` somente quando o Express estiver protegido por um proxy confiável que remova/substitua os cabeçalhos `X-Forwarded-*` recebidos de clientes. Não habilite essa opção em acesso direto.

No próprio computador do servidor, `http://localhost:3000` é permitido para teste local. Em outros computadores, a área biométrica deve ser acessada pela URL HTTPS, por exemplo:

`https://nome-ou-ip-do-timidias:3443`

## 3. Configurar a conexão de saída para o terminal

A integração CGI utiliza autenticação HTTP Digest sobre HTTPS. Configure no `.env`:

```env
INTELBRAS_DEVICE_URL=https://IP_DO_TERMINAL
INTELBRAS_DEVICE_USER=USUARIO_ADMINISTRATIVO_DO_TERMINAL
INTELBRAS_DEVICE_PASSWORD=SENHA_DO_TERMINAL
INTELBRAS_DEVICE_SERIAL=NUMERO_DE_SERIE_CONFIGURADO
INTELBRAS_WEBHOOK_IPS=IP_REAL_DO_LOG_DE_ORIGEM
INTELBRAS_TIMEOUT_MS=12000
INTELBRAS_CA_PATH=./certs/ca-intelbras.pem
```

`INTELBRAS_CA_PATH` é opcional e deve apontar para a CA que assinou o certificado HTTPS apresentado pelo equipamento. Se o terminal usar certificado autoassinado, instale/confie na CA ou no certificado apropriado; não desligue a validação TLS.

Depois de reiniciar a aplicação, abra a aba **Biometria e ocorrências**, faça login e utilize **Testar terminal**. O teste usa o endpoint de leitura `magicBox.cgi?action=getSystemInfo`; ele não altera as configurações do equipamento.

## 4. Cadastro facial

Na aba **Funcionários**:

1. Selecione a pessoa que já possui `UserID` cadastrado no terminal.
2. Escolha uma fotografia autorizada JPG/JPEG.
3. Selecione **Adicionar** quando ainda não houver face no terminal ou **Atualizar** para substituir uma face existente.
4. Confirme que a rádio validou a base legal aplicável e informou o titular.
5. Envie a fotografia.

A imagem é validada no servidor (JPEG/JPG, campo Base64 limitado a 200.000 caracteres e resolução de 150×300 a 600×1200 pixels) e encaminhada ao terminal pelo endpoint CGI `FaceInfoManager.cgi`. O servidor não guarda a foto de cadastro facial no MongoDB nem no disco local. Somente metadados de auditoria e o hash da imagem são registrados.

A operação `add`/`update` deve ser testada inicialmente com um funcionário de teste, pois a compatibilidade exata dos comandos CGI depende da versão/firmware do terminal. O sistema não cria usuário nem altera perfil, permissão, validade ou zonas de tempo.

## 5. Captura de fotografias de eventos negados

No terminal, verifique a configuração de integração POST Events. O manual da interface web descreve a opção **Captura de fotos**, que anexa a foto ao evento de acesso. Configure o callback para o servidor e a porta HTTPS:

- IP/nome do servidor: endereço do TIMIDIAS;
- Porta: valor de `HTTPS_PORT` (padrão `3443`);
- Caminho: `/api/eventos` (substitua o caminho antigo, como `/notification`, pelo endpoint real do projeto);
- HTTPS: habilitado;
- Captura de fotos: habilitada.

Aplique a configuração somente após validar a URL HTTPS e a confiança do certificado no equipamento. Faça primeiro um teste controlado de evento.

O servidor mantém os eventos textuais mesmo quando a notificação chega por HTTP, mas descarta a imagem recebida por canal não criptografado. O IP de origem do webhook também precisa constar em `INTELBRAS_WEBHOOK_IPS`. Use o IP que aparece na linha `Origem` do terminal do Node.js quando chega uma notificação real; não presuma que o IP de gerenciamento web e o IP de origem do POST sejam iguais. Quando essa lista estiver configurada, notificações de outros IPs serão recusadas. A fotografia é armazenada somente quando todos estes critérios forem atendidos:

- evento `AccessControl`;
- resultado `Status=0` (negado);
- método `Method=15` (reconhecimento facial local);
- `UserID` vazio/ausente;
- parte binária JPEG/PNG válida anexada ao POST;
- notificação recebida por HTTPS;
- IP de origem incluído em `INTELBRAS_WEBHOOK_IPS`;
- imagem JPEG/PNG associada ao evento, válida e com até 2 MB.

A configuração de entrada é diferente da integração CGI de saída. `INTELBRAS_DEVICE_URL` e `INTELBRAS_CA_PATH` tratam da comunicação Node.js → terminal. `HTTPS_PFX_PATH` / `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` e `INTELBRAS_WEBHOOK_IPS` tratam do recebimento terminal → Node.js.

Eventos sem fotografia não criam uma ocorrência de imagem. Eventos reconhecidos com `UserID` não entram na galeria de pessoas não identificadas.

## 6. Revisão humana e retenção

Na aba **Biometria e ocorrências**, o administrador pode abrir a foto, registrar observações e marcar a ocorrência como analisada. Uma associação a um funcionário é opcional e manual; o usuário precisa ser escolhido na lista e a operação fica registrada na auditoria.

A limpeza automática é executada na inicialização do servidor e, depois, a cada seis horas. Registros e arquivos vencidos são removidos conforme `BIOMETRIA_RETENCAO_DIAS`. A rotina registra no terminal a quantidade de ocorrências removidas e informa falhas sem interromper o servidor.

Faça backup da coleção `ocorrencias_face` e da pasta privada `storage/ocorrencias-face` em local protegido, conforme a política de retenção. A pasta não deve ser publicada pelo servidor estático nem colocada em repositório Git.

## 7. Proteção de dados

Fotografias faciais e dados biométricos associados a pessoas identificáveis são dados pessoais sensíveis. A autorização operacional da gestão não substitui a avaliação da hipótese legal adequada da LGPD. Antes de ativar em produção, valide a base legal aplicável, a necessidade/proporcionalidade, a informação aos titulares, o controle de acesso, a retenção, os procedimentos de atendimento e o descarte com o encarregado/responsável por proteção de dados da rádio.

A galeria deve ser acessada somente por administradores. Não compartilhe links diretos de fotos. O sistema não executa reconhecimento ou identificação automática das pessoas desconhecidas.

No Windows, mantenha a pasta privada com ACL restrita à conta que executa o Node.js, ao SYSTEM e aos administradores locais. Exemplo (PowerShell elevado; ajuste a conta se o Node for executado por uma conta de serviço diferente):

```powershell
New-Item -ItemType Directory -Force .\storage\ocorrencias-face | Out-Null
$conta = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls .\storage\ocorrencias-face /inheritance:r
icacls .\storage\ocorrencias-face /grant:r "${conta}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
```

Confirme que a conta usada para iniciar o Node.js consegue criar, ler e excluir arquivos nessa pasta. Não conceda permissão a `Everyone` ou `Users`.

## Cadastro de novo usuário pela interface web

A aba **Novo usuário** permite criar um usuário comum diretamente no terminal e enviar sua fotografia facial na mesma operação. A função exige sessão administrativa válida, canal HTTPS (ou `localhost` para teste no próprio servidor), credenciais Digest configuradas no `.env` e confirmação de que a pessoa foi informada e de que a rádio validou a hipótese legal aplicável.

### Dados enviados ao terminal

- `UserID`: identificador numérico informado pelo administrador.
- `UserName`: nome com até 64 caracteres.
- `UserType=0`: usuário geral.
- `Authority=2`: usuário comum; a interface não oferece criação de administradores.
- `UserStatus=1` (congelado) é o padrão inicial. A opção `normal` envia `UserStatus=0` somente quando o administrador escolhe expressamente.
- `ValidFrom` e `ValidTo` são opcionais.

A opção `normal` não cria regras individuais de portas ou horários; o terminal continuará aplicando as regras que já estiverem configuradas para o equipamento. Não há comando de abertura de portão nesse fluxo.

### Fotografia

A pessoa administradora pode capturar uma imagem pela webcam ou selecionar JPG, PNG ou WebP no computador/celular. O navegador converte a imagem em JPG, redimensiona para até 600 × 1200 pixels e tenta comprimir o arquivo para o limite da API facial. A câmera do navegador requer contexto seguro (HTTPS ou `localhost`) e permissão do usuário.

O fluxo consulta o ID no terminal antes de criar o cadastro. Se o ID já existir, a operação é interrompida. Depois, o serviço cria o usuário pela interface CGI `AccessUser.cgi?action=insertMulti` e envia a face por `FaceInfoManager.cgi?action=add`. Se o terminal criar o usuário mas não confirmar a fotografia, o cadastro local é preservado com estado facial pendente; não repita o ID. Abra a ficha do funcionário para tentar incluir a fotografia novamente.

O arquivo da fotografia é processado em memória e enviado ao terminal. O MongoDB recebe apenas os metadados do novo funcionário e o hash SHA-256 da imagem na trilha de auditoria, não uma cópia da fotografia.

### Validação em equipamento real

Os testes automatizados verificam normalização dos dados, usuário comum, situação inicial bloqueada, datas e interpretação de resposta. Eles não substituem o teste de compatibilidade com o firmware físico do SS 3532 MF W. Faça o primeiro cadastro com uma pessoa voluntária e informada, usando um ID de teste livre, mantendo o usuário bloqueado até que um administrador confirme as regras de acesso.
