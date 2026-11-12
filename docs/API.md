# Referência da API REST

Esta documentação descreve as rotas implementadas. O contrato estruturado também está em [`../openapi.yaml`](../openapi.yaml). A aplicação não disponibiliza Swagger UI por padrão.

## 1. Endereços-base

- Desenvolvimento local: `http://localhost:3000`
- Listener HTTPS, quando configurado: `https://localhost:3443`

As portas são configuráveis por `PORT` e `HTTPS_PORT`.

## 2. Endpoints gerais

| Método | Rota | Parâmetros | Acesso na versão atual |
|---|---|---|---|
| `GET` | `/api/status` | — | Público |
| `POST` | `/api/eventos` | Corpo multipart ou JSON | Webhook do equipamento; IP allowlist opcional para rejeição de POST e obrigatória para gravar fotos |
| `GET` | `/api/eventos` | `limite` (1–100, padrão 50) | Sem autenticação de rota |
| `GET` | `/api/dashboard/resumo` | `data=AAAA-MM-DD` | Sem autenticação de rota |
| `GET` | `/api/relatorios/mensal` | `mes=AAAA-MM` | Sem autenticação de rota |
| `GET` | `/api/relatorios/mensal/csv` | `mes=AAAA-MM` | Sem autenticação de rota |
| `GET` | `/api/funcionarios` | `busca` | Sem autenticação de rota |
| `GET` | `/api/funcionarios/{userId}/movimentacoes` | `inicio`, `fim`, `pagina`, `porPagina` | Sem autenticação de rota |
| `GET` | `/api/clima/temperatura` | `dataHora` ISO 8601; `atualizar=1` opcional | Sem autenticação de rota |
| `GET` | `/relatorios/mensal/imprimir` | `mes=AAAA-MM` | Sem autenticação de rota |

> **Observação de segurança:** as rotas gerais de consulta não exigem login nesta versão. Mantenha a aplicação em rede controlada e implemente autorização antes de disponibilizar a API fora do ambiente interno.

### 2.1 `GET /api/status`

Retorna o estado básico da aplicação e do banco.

Exemplo de resposta:

```json
{
  "sucesso": true,
  "aplicacao": "Controle de Acesso da Rádio",
  "servidor": "online",
  "banco": "conectado",
  "dataHora": "2026-11-12T12:00:00.000Z"
}
```

### 2.2 `POST /api/eventos`

Webhook usado pelo terminal. O parser aceita `multipart/mixed`, `multipart/form-data`, `multipart/related` e payload estruturado em JSON/urlencoded conforme o adaptador. O formato multipart utilizado pelo terminal contém uma parte textual com os eventos e partes binárias JPEG/PNG.

- Sucesso: `200 OK` com corpo `OK`.
- Corpo inválido ou sem eventos reconhecidos: `400`.
- IP fora da lista quando `INTELBRAS_WEBHOOK_IPS` está preenchida: `403`.
- Falha temporária de persistência: `503`.

A gravação da fotografia exige simultaneamente `req.secure` e IP de origem permitido. Sem os dois requisitos, o evento textual pode ser preservado, mas a foto não é gravada.

O sistema só cria ocorrência fotográfica quando o evento corresponde a uma tentativa facial local negada, sem `UserID` válido, com imagem JPEG/PNG válida e de até 2 MB. O evento de acesso continua armazenado mesmo se a foto não puder ser persistida.

### 2.3 `GET /api/eventos`

Consulta os eventos mais recentes. O parâmetro `limite` é limitado ao intervalo de 1 a 100.

Resposta resumida:

```json
{
  "sucesso": true,
  "quantidade": 1,
  "eventos": [
    {
      "device": {},
      "employee": {},
      "event": {},
      "timing": {}
    }
  ]
}
```

### 2.4 Dashboard e relatórios

- `GET /api/dashboard/resumo?data=2026-11-12`: resumo de um dia e distribuição horária.
- `GET /api/relatorios/mensal?mes=2026-11`: consolidação mensal.
- `GET /api/relatorios/mensal/csv?mes=2026-11`: arquivo CSV em UTF-8 com BOM e delimitador `;`.
- `GET /relatorios/mensal/imprimir?mes=2026-11`: página HTML preparada para impressão ou exportação pelo navegador.

### 2.5 Funcionários

- `GET /api/funcionarios?busca=termo`: pesquisa por nome ou ID.
- `GET /api/funcionarios/{userId}/movimentacoes?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&pagina=1&porPagina=25`: retorna dados cadastrais, resumo, frequência e histórico paginado. `porPagina` é limitado a 100.

A temperatura exibida no histórico individual é uma estimativa regional baseada em dados meteorológicos modelados; não é uma medição feita por sensor local.

## 3. Endpoints administrativos de biometria

As rotas administrativas exigem HTTPS em acesso remoto, sessão válida e verificação de origem nas operações de alteração. O cookie de sessão chama-se `controle_acesso_admin`.

| Método | Rota | Finalidade | Requisitos |
|---|---|---|---|
| `GET` | `/api/biometria/sessao` | Estado da sessão e da configuração | Sem login; informa se o canal é seguro |
| `POST` | `/api/biometria/login` | Autenticação administrativa | HTTPS remoto; JSON `usuario` e `senha` |
| `POST` | `/api/biometria/logout` | Encerrar sessão | HTTPS remoto |
| `GET` | `/api/biometria/dispositivo/teste` | Testar conexão CGI | HTTPS remoto e administrador |
| `POST` | `/api/biometria/funcionarios/{userId}/face` | Adicionar/atualizar fotografia de funcionário cadastrado | HTTPS remoto, administrador e confirmação explícita |
| `POST` | `/api/biometria/usuarios` | Criar usuário comum e enviar fotografia | HTTPS remoto, administrador e confirmação explícita |
| `GET` | `/api/biometria/ocorrencias` | Listar ocorrências | HTTPS remoto e administrador |
| `GET` | `/api/biometria/ocorrencias/{id}/foto` | Consultar fotografia privada | HTTPS remoto e administrador |
| `PATCH` | `/api/biometria/ocorrencias/{id}/revisao` | Registrar revisão humana | HTTPS remoto, administrador e verificação de origem |

### 3.1 Login

`POST /api/biometria/login`

```json
{
  "usuario": "administrador",
  "senha": "senha-configurada-localmente"
}
```

Respostas principais: `200` no sucesso, `401` em credenciais incorretas, `429` após exceder o limite temporário de tentativas e `503` quando a conta não está configurada. A política atual limita cinco tentativas por IP em uma janela de 15 minutos, mantida em memória do processo.

### 3.2 Criar usuário

`POST /api/biometria/usuarios`

```json
{
  "userId": "12345",
  "nome": "Nome de exemplo",
  "situacao": "congelado",
  "validadeInicio": "2026-01-01",
  "validadeFim": "2026-12-31",
  "fotoDataUrl": "data:image/jpeg;base64,...",
  "confirmacaoResponsavel": true
}
```

O ID precisa ser único na base local e no terminal. O usuário é enviado como usuário comum (`Authority=2`), e o estado inicial padrão é congelado. A criação do registro no terminal e o envio da fotografia são operações distintas; a API pode retornar `207` quando o usuário foi criado, mas a fotografia não foi confirmada pelo terminal.

### 3.3 Fotografia de funcionário existente

`POST /api/biometria/funcionarios/{userId}/face`

```json
{
  "operacao": "add",
  "fotoDataUrl": "data:image/jpeg;base64,...",
  "confirmacaoResponsavel": true
}
```

`operacao` aceita `add` ou `update`. O funcionário precisa existir na coleção local `funcionarios`.

### 3.4 Ocorrências

`GET /api/biometria/ocorrencias?status=pendente&limite=50`

`status` aceita `pendente`, `analisada` ou `todas`. A resposta contém metadados e uma URL protegida para a foto. A consulta efetiva da imagem é auditada.

`PATCH /api/biometria/ocorrencias/{id}/revisao`

```json
{
  "status": "analisada",
  "observacoes": "Revisão realizada por responsável autorizado.",
  "funcionarioUserId": null
}
```

O status aceita `pendente` ou `analisada`; observações têm limite de 1.000 caracteres. A associação de uma ocorrência a um funcionário é opcional e manual.

## 4. Códigos de resposta relevantes

| Código | Significado no projeto |
|---:|---|
| `200` | Consulta ou operação concluída |
| `201` | Novo usuário criado e fotografia confirmada |
| `207` | Usuário criado, mas fotografia ainda pendente de confirmação |
| `400` | Parâmetro, corpo ou regra de domínio inválidos |
| `401` | Sessão ausente ou credenciais incorretas |
| `403` | IP/origem não autorizado |
| `404` | Rota, funcionário ou fotografia não encontrada |
| `409` | ID já cadastrado |
| `426` | HTTPS obrigatório para operação remota |
| `429` | Limite de tentativas excedido |
| `500` | Erro interno |
| `502` | Falha na comunicação com equipamento externo |
| `503` | Serviço ou persistência indisponível/configuração ausente |

## 5. Contrato OpenAPI

O arquivo [`../openapi.yaml`](../openapi.yaml) descreve os endpoints, parâmetros e esquemas principais em OpenAPI 3.1.0. Como o webhook multipart do fabricante possui estrutura própria, a descrição do corpo também é complementada por este documento e pela implementação de `services/intelbras-notificacao-service.js`.
