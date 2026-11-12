# Painel de movimentação da portaria

## Abas disponíveis

### Movimentação diária
- Permite selecionar uma data.
- Exibe o total de eventos `AccessControl`, entradas liberadas, saídas liberadas e tentativas negadas.
- Mostra um gráfico por hora, separado em entradas, saídas e tentativas negadas.
- Lista as 15 movimentações mais recentes do dia.

### Relatório mensal
- Permite selecionar o mês de referência.
- Consolida as movimentações por funcionário e por dia.
- Exporta os registros detalhados em CSV com UTF-8 BOM e separador `;`, compatível com Excel.
- Abre uma página limpa de impressão; no diálogo do navegador, escolha **Salvar como PDF** para gerar o PDF.

### Funcionários
- Lista os cadastros presentes na coleção `funcionarios`.
- Permite pesquisar por nome ou ID.
- Exibe os dados cadastrais, ID Intelbras, origem do cadastro, número de série, permissão administrativa no terminal e validade importada.
- Mostra a situação do cadastro local e sinaliza validade ainda não iniciada, vigente ou expirada. Essa situação de validade é calculada a partir do backup importado e não representa uma consulta em tempo real ao terminal.
- Ao abrir um funcionário sem filtros de data, carrega todo o histórico disponível desde a primeira movimentação registrada.
- Exibe indicadores de entradas, saídas e tentativas negadas para todo o período filtrado.
- Mostra a frequência por hora, dia da semana e data.
- O histórico detalhado é paginado, com 25 eventos por página; todas as páginas podem ser percorridas sem truncar o histórico do período.
- Cada entrada liberada pode exibir a temperatura histórica estimada para a hora do acesso, na localidade configurada. A temperatura é obtida no servidor, com cache diário no MongoDB, sem gravar ou modificar documentos de acesso.
- A ficha individual foi ajustada para telas pequenas: filtros e botões com área de toque maior, gráficos roláveis e histórico em cartões no celular.

## APIs criadas

| Rota | Finalidade |
|---|---|
| `GET /api/status` | Estado do servidor e conexão inicial do banco |
| `GET /api/dashboard/resumo?data=AAAA-MM-DD` | Resumo diário e distribuição por hora |
| `GET /api/relatorios/mensal?mes=AAAA-MM` | Resumo mensal por dia e por funcionário |
| `GET /api/relatorios/mensal/csv?mes=AAAA-MM` | Exportação detalhada em CSV |
| `GET /api/funcionarios?busca=termo` | Pesquisa de funcionários cadastrados |
| `GET /api/funcionarios/:userId/movimentacoes?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&pagina=1&porPagina=25` | Histórico individual, indicadores, frequência, paginação e temperatura estimada nas entradas liberadas |
| `GET /api/clima/temperatura?dataHora=ISO-8601` | Consulta a temperatura histórica para um instante específico |
| `GET /relatorios/mensal/imprimir?mes=AAAA-MM` | Página preparada para impressão/PDF |

## Regras utilizadas na contagem

- Somente documentos cujo `event.code` seja `AccessControl` entram nos relatórios. Eventos de sistema, como inicialização/reinicialização, não são contados como movimentações de acesso.
- `event.type = Entry` representa entrada; `event.type = Exit` representa saída.
- `event.status = 1` representa sucesso; `event.status = 0` representa tentativa negada.
- Quando `event.status` não existe, o evento é tratado como sucesso, conforme a especificação de integração Intelbras.
- Status diferentes de `0` e `1` ficam em `indefinidos` e não são somados às entradas ou saídas liberadas.
- As consultas e exibições de data/hora usam o fuso configurado em `CLIMA_TIMEZONE` (padrão `America/Sao_Paulo`).
- A primeira consulta individual sem `inicio` usa a primeira data em que existe evento do funcionário; sem `fim`, usa a data atual da Bahia.
- A paginação afeta somente as linhas do histórico detalhado. Indicadores e frequências são calculados sobre todo o período filtrado.

## Estrutura de dados esperada

Os relatórios utilizam os documentos gravados pelo serviço atual em `eventos_acesso`, especialmente:

- `event.code`, `event.type`, `event.status`, `event.method` e `event.door`;
- `employee.userId` e `employee.nome`;
- `timing.occurredAt`.

A aba Funcionários consulta a coleção `funcionarios`, preenchida automaticamente pelo `evento-service.js` quando um evento contém `UserID`.

## Instalação e testes

1. Preserve o arquivo `.env` que já existe no ambiente da rádio.
2. Caso seja uma instalação nova, copie `.env.example` para `.env` e ajuste a conexão do MongoDB.
3. Instale as dependências com `npm install`.
4. Execute os testes automatizados com `npm test`.
5. Inicie em desenvolvimento com `npm run dev` ou normalmente com `npm start`.

O projeto não precisa de uma nova coleção nem de migração dos eventos existentes para estas abas.

## Sincronização dos cadastros do terminal

A coleção `funcionarios` recebe cadastros automaticamente quando o terminal envia eventos com `UserID` e também pode ser preenchida pelo importador do backup CSV Intelbras. O importador foi utilizado para trazer os 104 usuários do backup inicial da rádio. Quando houver mudanças cadastrais no equipamento, gere um novo backup CSV e execute novamente a pré-validação antes de confirmar a atualização.

A situação exibida na ficha diferencia o estado cadastrado localmente (`ativo`) da validade importada do terminal. A validade é calculada a partir das datas do último backup importado; não é uma consulta ao vivo ao SS 3532 MF W. A lista também não importa imagens faciais, cartões, senhas ou outras credenciais.

## Temperatura histórica das entradas

- Para eventos a partir de 2022, a aplicação consulta primeiro a Open-Meteo Historical Forecast API; se ela não retornar dados, tenta a Open-Meteo Historical Weather API. Para datas anteriores a 2022, consulta a Historical Weather API.
- A variável utilizada é `temperature_2m`, em graus Celsius, com referência horária no fuso `America/Bahia`. Um evento às 08:37 usa a estimativa da faixa das 08:00.
- O resultado é uma estimativa regional baseada em modelos/reanálises meteorológicas, não uma medição feita por termômetro na portaria. A resolução espacial e a metodologia das bases variam conforme o produto histórico utilizado.
- O cache diário é salvo em `clima_historico_cache`, separado das coleções `eventos_acesso` e `funcionarios`. Uma indisponibilidade da API não impede a exibição do histórico de acesso.
- A localidade é definida na implantação por meio de `CLIMA_LATITUDE`, `CLIMA_LONGITUDE`, `CLIMA_LOCALIDADE` e `CLIMA_TIMEZONE`. Sem coordenadas válidas, o módulo informa que os dados meteorológicos estão indisponíveis e não consulta a API externa.
- A API é consultada pelo servidor, não diretamente pelo navegador. A tela mantém o crédito à Open-Meteo.

Exemplo de consulta manual:

```http
GET /api/clima/temperatura?dataHora=2026-11-10T12%3A15%3A00.000Z
```

## Layout mobile-first

A interface usa uma composição compacta por padrão, com expansão progressiva em telas maiores. Em celulares, as abas podem ser percorridas horizontalmente, os gráficos têm rolagem horizontal própria, os filtros ocupam a largura disponível e o histórico individual muda de tabela para cartões por evento.

## Condições meteorológicas históricas na ficha do funcionário

Na aba Funcionários, cada entrada liberada pode exibir o contexto meteorológico estimado para a hora local do evento: temperatura, condição do tempo, sensação térmica, umidade relativa, precipitação e velocidade do vento, conforme os campos retornados pela Open-Meteo.

O servidor consulta primeiro a API de previsão com dados passados para datas recentes; depois tenta a Historical Forecast API e, por fim, a Historical Weather API. As respostas por dia são armazenadas na coleção `clima_historico_cache`, com chave de cache `open-meteo:v2`. A troca para `v2` invalida automaticamente falhas guardadas pela implementação meteorológica anterior.

A consulta manual pode ser testada no próprio servidor, substituindo o horário por um ISO de um evento real:

```text
http://localhost:3000/api/clima/temperatura?dataHora=2026-11-10T12:15:00.000Z&atualizar=1
```

O parâmetro `atualizar=1` força nova consulta, sem utilizar o cache daquele dia. A resposta contém `temperatura.disponivel`, `temperaturaC`, `condicao`, `sensacaoC`, `umidadePct`, `precipitacaoMm` e `ventoKmh`, quando a fonte disponibilizar esses dados.

Os valores são estimativas regionais de modelos meteorológicos para as coordenadas configuradas no `.env`; não são medições realizadas na portaria. Ajuste `CLIMA_LATITUDE`, `CLIMA_LONGITUDE`, `CLIMA_LOCALIDADE` e `CLIMA_TIMEZONE` para a localização da rádio.
