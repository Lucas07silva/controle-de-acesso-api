# Roadmap e limitações conhecidas

Este roadmap separa o que está implementado do que ainda é proposta de evolução.

## Implementado nesta versão

- API Express para webhook e consultas de eventos.
- Persistência MongoDB com índices e prevenção de duplicidade por chave de evento.
- Dashboard de movimentações diárias e relatórios mensais.
- Pesquisa de funcionários e histórico individual paginado.
- Exportação CSV e página de impressão.
- Importação de cadastros do terminal por CSV, com simulação e confirmação.
- Integração CGI/HTTPS Digest para operações administrativas suportadas.
- Cadastro de usuário comum e envio/atualização de fotografia facial sob autenticação administrativa.
- Armazenamento privado de fotografias de tentativas faciais negadas e não identificadas.
- Revisão humana, auditoria e retenção configurável.
- Enriquecimento meteorológico histórico quando uma localidade é configurada.

## Não implementado — trabalho futuro

### Integração com câmera de CFTV e detecção de pedestres

A versão atual não recebe RTSP/ONVIF e não detecta pessoas, automóveis, motocicletas ou bicicletas por vídeo. O próximo estudo pode avaliar uma câmera IP compatível, um serviço separado de visão computacional e uma regra de correlação temporal entre o vídeo e os eventos do terminal. Qualquer classificação deve ser tratada como indício para revisão humana, não como identificação ou decisão automática.

### Segurança e governança

- Adicionar autenticação e autorização às rotas gerais do dashboard e consultas de eventos.
- Definir perfis administrativos e princípio do menor privilégio.
- Persistir limites de tentativas de login ou adotar middleware apropriado.
- Melhorar observabilidade, mascaramento de logs e gestão de incidentes.
- Definir política organizacional de retenção, backup e descarte.
- Revisar a exposição de dados e as bases legais aplicáveis antes de uso operacional.

### Qualidade e operação

- Adicionar testes de contrato para todos os endpoints.
- Executar testes com diferentes versões/firmwares do equipamento em ambiente de homologação.
- Criar pipeline de integração contínua.
- Versionar mudanças do contrato OpenAPI com revisão compatível.
- Avaliar serviço de fila/reprocessamento se o volume de notificações crescer.
