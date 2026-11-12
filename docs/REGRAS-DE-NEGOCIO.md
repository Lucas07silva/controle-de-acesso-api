# Regras de negócio

## 1. Normalização dos eventos

- A aplicação aceita o campo `Events` como lista ou objeto indexado e normaliza os itens para uma sequência.
- Campos de evento podem estar no próprio objeto ou em `Data`; o serviço consulta as duas estruturas.
- O `UserID` vazio, `0`, `-1`, `unknown`, `none` ou `null` é tratado como ausência de identificação.
- O horário é interpretado a partir de `UTC`, `RealUTC` ou `CreateTime`, conforme disponibilidade.
- A chave de idempotência é gerada por SHA-256 a partir de atributos do dispositivo, evento, horário, identificação, método e resultado.

## 2. Contabilização de movimentações

- Somente eventos com `event.code = AccessControl` entram nos relatórios de acesso.
- `event.type = Entry` representa entrada; `event.type = Exit` representa saída.
- `event.status = 1` representa acesso liberado.
- `event.status = 0` representa tentativa negada.
- Status diferentes de `0` e `1` são classificados como indefinidos.
- Quando o status não é informado, a regra atual considera o evento como sucesso para fins de consolidação.
- As datas e horários são interpretados no fuso definido por `CLIMA_TIMEZONE`.

## 3. Elegibilidade de fotografias de ocorrências

A aplicação armazena uma fotografia como ocorrência facial não identificada somente quando todas as condições abaixo são atendidas:

1. O código do evento é `AccessControl`.
2. O status indica negação (`0`).
3. O método é `15` (reconhecimento facial local, conforme o mapeamento adotado para o equipamento integrado).
4. Não há `UserID` válido.
5. A imagem tem assinatura binária JPEG ou PNG reconhecida.
6. A imagem tem até 2 MB.
7. A notificação chegou por HTTPS (`req.secure`).
8. O IP de origem consta em `INTELBRAS_WEBHOOK_IPS`.
9. A ocorrência ainda não foi registrada com a mesma `eventKey`.

A não elegibilidade da fotografia não apaga o evento textual já persistido. Eventos de funcionários identificados permanecem no histórico regular, mas não são apresentados como tentativas não identificadas.

## 4. Cadastro e atualização de usuários

- O ID deve ser numérico, com até 20 dígitos, e único no cadastro local e no terminal.
- O nome tem limite de 64 caracteres.
- A permissão enviada ao terminal para novos cadastros é sempre `Authority=2` (usuário comum).
- A situação inicial padrão é congelada; a opção normal precisa ser escolhida expressamente.
- O fluxo exige autenticação administrativa e confirmação de que a pessoa foi informada e de que a hipótese legal aplicável foi avaliada.
- O sistema não envia comando de abertura de portão.
- Se o usuário for criado no terminal, mas o envio da fotografia falhar, o cadastro local é preservado com a face pendente para correção posterior.

## 5. Importação CSV

- A rotina possui modo de simulação por padrão.
- A escrita no MongoDB exige a opção `--confirmar`.
- A chave de upsert é `userId`.
- São importados identificador, nome, validade e código de permissão do terminal.
- Fotografias, templates biométricos, cartões e senhas não são importados.
- A importação não modifica a coleção `eventos_acesso`.

## 6. Revisão humana e retenção

- As ocorrências começam com status `pendente`.
- O administrador pode marcar como `analisada`, inserir observações e opcionalmente associar a ocorrência a um cadastro existente.
- A associação é manual; não há correspondência facial automática.
- Fotografias e metadados são removidos após o prazo configurado em `BIOMETRIA_RETENCAO_DIAS` (padrão de 30 dias).
- A rotina de limpeza é executada na inicialização e a cada seis horas.
