# Sistema de Controle e Gestão de Acessos: desenvolvimento de uma API REST integrada a equipamento de controle de acesso

**Relatório técnico-acadêmico — Componente curricular: Desenvolvimento de APIs**

| Identificação | Preenchimento |
|---|---|
| Instituição | `[Nome da instituição]` |
| Curso | `[Nome do curso]` |
| Componente curricular | Desenvolvimento de APIs |
| Docente | `[Nome do(a) docente]` |
| Estudante | `[Nome do(a) estudante]` |
| Local | `[Cidade - UF]` |
| Ano | 2026 |

## Resumo

Este trabalho apresenta o desenvolvimento de um sistema web para integração, consulta e gestão de eventos de controle de acesso. A solução foi construída com Node.js, Express 5, MongoDB e interface renderizada com EJS, adotando uma organização modular entre rotas, serviços, persistência e apresentação. A aplicação recebe notificações enviadas por um terminal de controle de acesso, interpreta mensagens multipart que podem conter fotografias, normaliza os eventos e armazena os registros em banco de dados documental. A API disponibiliza consultas de situação, movimentações diárias, relatórios mensais, exportação CSV, pesquisa de funcionários e histórico individual. Também contempla uma área administrativa para operações de cadastro facial, criação de usuários comuns, auditoria e revisão humana de ocorrências faciais negadas e não identificadas. As fotografias de ocorrências são mantidas fora do diretório público, com acesso administrativo, controle de origem, exigência de HTTPS e retenção configurável. Como funcionalidade complementar, o sistema pode associar estimativas meteorológicas históricas a entradas liberadas, de acordo com coordenadas configuradas. A validação automatizada foi realizada com o Node.js Test Runner; na versão avaliada, foram executados 42 testes, todos aprovados. O trabalho evidencia a aplicação de conceitos de API REST, integração entre sistemas, persistência NoSQL, validação de dados, segurança de transporte e documentação de contratos. A detecção de pedestres por câmera é apresentada apenas como possibilidade de evolução, não fazendo parte da implementação atual.

**Palavras-chave:** API REST; Node.js; Express; MongoDB; integração de sistemas; controle de acesso.

## 1. Introdução

Sistemas de controle de acesso produzem registros que podem ser utilizados para acompanhar entradas, saídas, tentativas negadas e movimentações associadas a usuários cadastrados. Entretanto, a consulta direta ao equipamento nem sempre oferece a consolidação, o histórico individual e os mecanismos de auditoria desejados por uma organização.

Diante desse contexto, foi desenvolvido um sistema web que atua como camada de integração e consulta. O software recebe notificações de um terminal de controle de acesso, processa os dados recebidos e os disponibiliza por meio de uma API e de um painel web. O foco acadêmico deste projeto está no desenho e implementação de endpoints HTTP, integração com um sistema externo, persistência de dados e aplicação de regras de negócio.

O terminal integrado é responsável pelo reconhecimento biométrico. A aplicação não treina nem executa um modelo próprio de reconhecimento facial. Sua responsabilidade é receber eventos e, em condições específicas, armazenar fotografias anexadas a tentativas negadas e não identificadas para revisão humana.

## 2. Problema e justificativa

A ausência de uma camada centralizada de consulta dificulta a análise de movimentações por data, funcionário e período. Também torna mais trabalhoso consolidar relatórios mensais, localizar registros individuais e auditar determinadas operações administrativas.

A construção de uma API REST permite separar a origem dos eventos, as regras de processamento e as interfaces de consulta. Essa separação favorece a manutenção, o teste isolado de serviços e a integração futura com outros sistemas.

## 3. Objetivos

### 3.1 Objetivo geral

Desenvolver uma aplicação web baseada em API REST para receber, normalizar, armazenar e consultar eventos de controle de acesso, com integração a um equipamento externo e recursos de auditoria.

### 3.2 Objetivos específicos

- Implementar endpoint para recebimento de notificações do equipamento.
- Interpretar payloads JSON e mensagens multipart contendo imagens.
- Persistir eventos e cadastros utilizando MongoDB.
- Disponibilizar consultas e relatórios por meio de endpoints HTTP.
- Implementar histórico individual de funcionários e exportação CSV.
- Integrar operações administrativas do equipamento por HTTPS e autenticação Digest.
- Criar controles para operações biométricas e revisão humana de ocorrências.
- Documentar arquitetura, regras de negócio, dados, endpoints e limitações.
- Validar as principais funções por testes automatizados.

## 4. Escopo da solução

O sistema contempla o recebimento de eventos, painel de movimentações, relatórios diário e mensal, pesquisa de funcionários, ficha individual, importação CSV, cadastro administrativo de usuários comuns e fotografias faciais, auditoria e revisão de ocorrências não identificadas.

O módulo meteorológico é opcional e depende da configuração de latitude, longitude e fuso horário. As informações são estimativas provenientes de modelos e reanálises, não medições de sensores instalados no local.

Não fazem parte do escopo implementado: detecção de pedestres por câmera, análise de vídeo RTSP/ONVIF, reconhecimento facial próprio, abertura remota do portão e decisão automática sobre a identidade de pessoas desconhecidas.

## 5. Metodologia de desenvolvimento

O desenvolvimento foi conduzido de forma incremental. Primeiro foi estabelecida a conexão com o banco de dados e a recepção de eventos. Em seguida foram implementados serviços de normalização, consultas e relatórios. Posteriormente foram incorporadas as rotas administrativas, integração com o terminal, recebimento seguro de fotografias e revisão de ocorrências.

A aplicação foi organizada em módulos para separar responsabilidades: `routes/` contém os endpoints; `services/` concentra regras de negócio e integrações; `views/` contém templates EJS; `public/` contém recursos do navegador; `tests/` contém testes automatizados. A documentação do contrato foi organizada em OpenAPI 3.1.0.

A validação combina testes automatizados das regras de domínio e verificações manuais de conectividade com o servidor e equipamento de integração. Os testes automatizados não substituem a homologação em diferentes firmwares e ambientes de rede.

## 6. Tecnologias utilizadas

| Tecnologia | Aplicação no projeto |
|---|---|
| Node.js | Ambiente de execução JavaScript no servidor |
| Express 5 | Definição de rotas HTTP e middlewares |
| MongoDB | Persistência documental de eventos, funcionários, ocorrências e auditoria |
| Driver oficial MongoDB para Node.js | Comunicação com o banco |
| EJS | Renderização das páginas do painel |
| HTML, CSS e JavaScript | Interface no navegador |
| dotenv | Carregamento de variáveis de configuração |
| HTTPS/TLS | Proteção do transporte de informações sensíveis |
| Open-Meteo | Fonte de dados meteorológicos históricos |
| node:test | Execução da suíte de testes automatizados |

## 7. Arquitetura e funcionamento

A arquitetura é organizada em camadas. O terminal envia notificações para a rota `POST /api/eventos`. O Express preserva o conteúdo binário da mensagem multipart e o serviço `intelbras-notificacao-service` separa a parte textual das partes de imagem. O serviço `evento-service` normaliza os registros e persiste cada evento na coleção `eventos_acesso`.

A chave de idempotência é calculada por SHA-256 a partir de campos que identificam o evento. A gravação com `upsert` e índice único reduz a criação de duplicidades quando uma notificação é reenviada.

A interface web consome endpoints do dashboard para exibir resumos, relatórios e históricos. Os serviços administrativos comunicam-se com o equipamento por HTTPS e autenticação Digest. As fotografias recebidas como parte de eventos elegíveis são gravadas em diretório privado, enquanto seus metadados são armazenados em MongoDB.

## 8. API e principais endpoints

A API utiliza os métodos HTTP conforme o propósito das operações: `GET` para consultas, `POST` para recepção/criação e `PATCH` para atualização parcial de revisão.

| Método | Endpoint | Responsabilidade |
|---|---|---|
| `GET` | `/api/status` | Consultar disponibilidade da aplicação e banco |
| `POST` | `/api/eventos` | Receber eventos do terminal |
| `GET` | `/api/eventos` | Consultar eventos recentes |
| `GET` | `/api/dashboard/resumo` | Obter resumo diário |
| `GET` | `/api/relatorios/mensal` | Obter consolidação mensal |
| `GET` | `/api/relatorios/mensal/csv` | Exportar eventos em CSV |
| `GET` | `/api/funcionarios` | Pesquisar cadastros |
| `GET` | `/api/funcionarios/{userId}/movimentacoes` | Consultar histórico individual |
| `POST` | `/api/biometria/usuarios` | Criar usuário comum, sob autenticação administrativa |
| `GET` | `/api/biometria/ocorrencias` | Listar ocorrências para revisão |
| `PATCH` | `/api/biometria/ocorrencias/{id}/revisao` | Registrar revisão humana |

A documentação completa dos parâmetros, payloads e códigos de resposta está em `docs/API.md`, e o contrato está em `openapi.yaml`.

## 9. Modelo de dados

O MongoDB utiliza as seguintes coleções principais:

- `eventos_acesso`: eventos normalizados, dados do terminal, usuário associado e horários.
- `funcionarios`: cadastro local sincronizado ou importado.
- `ocorrencias_face`: metadados das ocorrências faciais não identificadas e estado da revisão.
- `auditoria_biometria`: registros de operações administrativas.
- `clima_historico_cache`: cache de dados meteorológicos por data e localidade.

Os bytes das fotografias de ocorrências ficam no sistema de arquivos privado, fora do diretório público da aplicação. O banco mantém o nome do arquivo, MIME, tamanho e hash SHA-256. O detalhamento dos campos e índices está em `docs/MODELO-DE-DADOS.md`.

## 10. Regras de negócio relevantes

Somente eventos cujo código seja `AccessControl` entram nos relatórios de movimentação. O tipo `Entry` representa entrada e `Exit` representa saída. Status `1` representa acesso liberado; status `0` representa tentativa negada; valores diferentes são tratados como indefinidos.

A fotografia só é armazenada como ocorrência não identificada quando o evento representa tentativa facial local negada, sem `UserID` válido, método `15`, imagem JPEG/PNG válida de até 2 MB, recebimento por HTTPS e IP de origem autorizado. Eventos textuais permanecem armazenados mesmo que a fotografia não seja elegível.

Novos usuários são enviados como usuários comuns no equipamento. O estado inicial padrão é congelado e a ativação exige escolha explícita do administrador. A associação entre uma ocorrência desconhecida e um funcionário é manual, sem comparação automática de rostos.

## 11. Segurança e proteção de dados

A aplicação separa as credenciais do dashboard das credenciais do terminal, utiliza assinatura HMAC para token de sessão, cookies `HttpOnly` e `SameSite=Strict`, e exige HTTPS para operações biométricas remotas. A consulta de fotografias é protegida por sessão administrativa e registrada em auditoria. A retenção padrão de ocorrências é de 30 dias, com limpeza periódica.

Há uma limitação conhecida: as rotas gerais de consulta do dashboard e dos eventos não exigem sessão individual nesta versão. Por isso, a aplicação deve permanecer em rede controlada, com restrição de acesso por firewall, até que sejam implementadas autorização e perfis de usuário em todas as rotas.

Fotografias faciais e dados biométricos relacionados a pessoas identificáveis podem ser dados pessoais sensíveis. A confirmação presente no sistema não substitui a análise da base legal, transparência, necessidade, proporcionalidade e demais obrigações aplicáveis à LGPD pela organização responsável.

## 12. Testes e resultados

A suíte utiliza o Node.js Test Runner. Na versão avaliada em 12 de novembro de 2026, foram executados 42 testes, com 42 aprovações e nenhuma falha. Os cenários cobrem parsing multipart, associação de imagens a eventos, regras de elegibilidade, validação de fotografias, autenticação administrativa, funções de relatórios, paginação, interpretação de CSV, regras de criação de usuário e processamento de dados meteorológicos simulados.

O teste automatizado não verifica integralmente o comportamento de um equipamento físico. A homologação real depende de versão de firmware, certificados, rede, configuração do terminal e permissões do ambiente de instalação.

## 13. Limitações e trabalhos futuros

As principais evoluções previstas são: autenticação e autorização nas rotas gerais; testes de contrato e integração contínua; observabilidade e políticas formais de backup; validação em diferentes versões do equipamento; e integração futura com uma câmera de CFTV para detectar presença de pessoas e veículos. A detecção de pedestres permanece fora do escopo implementado e deverá ser tratada como classificação auxiliar, sujeita a revisão humana.

## 14. Considerações finais

O projeto demonstra a construção de uma API REST integrada a um equipamento externo, utilizando rotas HTTP, serviços de domínio, persistência NoSQL, parsing de mensagens multipart e autenticação para operações administrativas. A modularização facilita a manutenção e a expansão gradual da solução, enquanto os testes automatizados oferecem uma base para regressão das regras mais importantes.

A principal contribuição acadêmica é a aplicação prática de conceitos de desenvolvimento de APIs em um cenário de integração de sistemas, com atenção à integridade dos dados, idempotência, separação de responsabilidades e proteção de informações sensíveis. A evolução do projeto deve priorizar a autenticação de todas as consultas e a governança dos dados antes de ampliar o escopo de monitoramento.

## Referências

EXPRESS. **Express 5.x API Reference**. Disponível em: <https://expressjs.com/en/api/>. Acesso em: 12 nov. 2026.

EXPRESS. **Routing**. Disponível em: <https://expressjs.com/en/guide/routing/>. Acesso em: 12 nov. 2026.

INTELBRAS. **Manual Interface Web — Linha Bio-T: SS 3532 MF W / SS 3542 MF W**. Disponível em: <https://manuais.intelbras.com.br/manual-interface-web-linha-bio-t/pt-BR/manual_SS3532_SS3542_MFW_pt-BR.html?lang=pt>. Acesso em: 12 nov. 2026.

MONGODB. **MongoDB Node.js Driver Documentation**. Disponível em: <https://www.mongodb.com/docs/drivers/node/current/>. Acesso em: 12 nov. 2026.

OPEN-METEO. **Historical Forecast API**. Disponível em: <https://open-meteo.com/en/docs/historical-forecast-api>. Acesso em: 12 nov. 2026.

OPEN-METEO. **Historical Weather API**. Disponível em: <https://open-meteo.com/en/docs/historical-weather-api>. Acesso em: 12 nov. 2026.

OPENAPI INITIATIVE. **OpenAPI Specification, Version 3.1.0**. Disponível em: <https://spec.openapis.org/oas/v3.1.0.html>. Acesso em: 12 nov. 2026.

BRASIL. **Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais (LGPD)**. Disponível em: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>. Acesso em: 12 nov. 2026.
