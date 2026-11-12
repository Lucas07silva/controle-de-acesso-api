# Importação dos usuários da Intelbras

Esta rotina importa os cadastros exportados do terminal Intelbras SS 3532 MF W para a coleção `funcionarios` do banco `controle_acesso_radio`.

## Campos importados

A rotina usa somente as cinco primeiras colunas do CSV sem cabeçalho:

| Coluna | Uso no sistema |
|---:|---|
| 1 | ID do usuário (`userId`) |
| 2 | Nome |
| 3 | Início da validade |
| 4 | Fim da validade |
| 5 | Permissão do terminal: `1` = Administrador; `2` = Usuário comum |

A permissão é a permissão administrativa **do terminal Intelbras**. Ela não concede acesso administrativo ao dashboard.

O CSV pode conter foto facial e outros dados de credenciais em colunas posteriores. Essas colunas não são copiadas para o MongoDB. Esta importação não armazena fotos faciais, templates biométricos, cartões, senhas ou outros segredos.

## Antes de executar

1. Faça um backup do banco `controle_acesso_radio`.
2. Coloque o CSV exportado do equipamento em uma pasta acessível pelo TIMIDIAS.
3. Confira o arquivo e use primeiro o modo de simulação.
4. Execute a gravação somente depois de conferir a quantidade e a separação entre administradores e usuários comuns.

## Simulação (não altera o banco)

No CMD ou PowerShell, dentro da pasta do projeto:

```powershell
npm run importar:funcionarios -- "C:\caminho\arquivo-exportado.csv"
```

## Gravação no MongoDB

Depois de revisar a simulação e realizar o backup:

```powershell
npm run importar:funcionarios -- "C:\caminho\arquivo-exportado.csv" --confirmar
```

Para outro número de série:

```powershell
npm run importar:funcionarios -- "C:\caminho\arquivo.csv" --serial NUMERO_DE_SERIE --confirmar
```

## Segurança e integridade

- Sem `--confirmar`, a rotina apenas valida o arquivo e mostra um resumo.
- A importação usa `userId` como chave e faz upsert; repetir a importação atualiza os dados cadastrais sem criar cópias do mesmo usuário.
- Campos de histórico e movimentação não são removidos.
- A coleção `eventos_acesso` não é modificada.
- IDs duplicados, permissões desconhecidas, campos ausentes ou formato diferente do CSV validado interrompem a importação antes da conexão ao MongoDB.
- O script não sincroniza alterações do MongoDB de volta para o terminal.
