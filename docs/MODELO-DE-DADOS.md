# Modelo de dados

O banco é organizado em coleções MongoDB. Os documentos são normalizados pela aplicação a partir das notificações do equipamento e das operações administrativas.

## 1. Coleções

### `eventos_acesso`

Armazena o histórico de eventos recebido do terminal.

| Campo | Descrição |
|---|---|
| `eventKey` | Hash SHA-256 calculado a partir de campos de identidade do evento; usado para idempotência |
| `device` | Identificador, IP de origem e canal do equipamento |
| `employee` | `userId` e nome, quando informados pelo terminal |
| `event` | Código, ação, tipo, status, método, porta e leitor |
| `timing` | Timestamp original, data interpretada, horário textual e horário de recebimento |

O evento é persistido por `updateOne` com `$setOnInsert` e `upsert`, associado a um índice único em `eventKey`. Isso impede a criação de cópias para notificações com a mesma chave calculada.

### `funcionarios`

Mantém o cadastro local usado pelo dashboard e pelo histórico individual. Os campos podem incluir `userId`, `nome`, `ativo`, `permissaoDispositivo`, `validadeDispositivo`, `origemCadastro`, `dispositivo`, `sincronizadoEm`, `createdAt` e `updatedAt`.

O índice `userId` é único. A importação CSV retém os dados cadastrais essenciais e ignora colunas de fotografia facial, templates, cartões, senhas e outras credenciais.

### `ocorrencias_face`

Mantém metadados das tentativas faciais não identificadas elegíveis para revisão.

| Grupo | Campos principais |
|---|---|
| Identificação da ocorrência | `eventKey`, `occurredAt`, `receivedAt` |
| Origem | `device.deviceId`, `device.ip` |
| Evento | `event.code`, `event.status`, `event.method`, `event.type`, `event.door` |
| Identificação | `identification.result`, `identification.linkedEmployeeUserId` |
| Revisão | `review.status`, `review.notes`, `review.reviewedBy`, `review.reviewedAt` |
| Fotografia | `photo.fileName`, `photo.contentType`, `photo.bytes`, `photo.sha256` |
| Retenção | `retention.expiresAt`, `retention.days` |

Os bytes da imagem ficam em `BIOMETRIA_STORAGE_DIR`, por padrão `./storage/ocorrencias-face`, fora da pasta servida estaticamente. MongoDB armazena metadados e referência ao arquivo.

### `auditoria_biometria`

Registra atividades administrativas, incluindo logins, teste de conexão, cadastro/atualização de face, criação de usuário, visualização de fotografia e revisão de ocorrência. Os registros podem conter usuário administrativo, ação, identificador de funcionário quando aplicável, resultado, IP de origem, hash de fotografia, detalhes e data.

### `clima_historico_cache`

Armazena os resultados diários consultados nas fontes meteorológicas. A chave inclui versão do cache, coordenadas e data. O cache evita chamadas repetidas para a mesma localidade e data.

## 2. Índices criados na inicialização

| Coleção | Índice | Objetivo |
|---|---|---|
| `eventos_acesso` | Único em `eventKey` | Idempotência de eventos |
| `eventos_acesso` | `timing.occurredAt` descendente | Consulta por data |
| `eventos_acesso` | `employee.userId` + `timing.occurredAt` | Histórico individual |
| `funcionarios` | Único em `userId` | Integridade do cadastro |
| `ocorrencias_face` | Único em `eventKey` | Evitar duplicar ocorrência |
| `ocorrencias_face` | `review.status` + `occurredAt` | Filtro e ordenação de revisão |
| `ocorrencias_face` | `retention.expiresAt` | Consulta de expiração |
| `auditoria_biometria` | `createdAt` descendente | Consulta cronológica de auditoria |

## 3. Relações conceituais

- Um funcionário pode possuir muitos eventos de acesso.
- Um evento pode originar, no máximo, uma ocorrência facial armazenada.
- Uma ocorrência pode receber uma associação manual opcional com um funcionário.
- Uma operação administrativa pode gerar um registro de auditoria.
- O histórico meteorológico é associado ao horário/localidade da entrada apenas como informação contextual; não modifica o evento original.

Como o MongoDB é orientado a documentos, essas relações são mantidas por identificadores e referências em vez de chaves estrangeiras relacionais.
