# Publicação do projeto no GitHub

Este guia descreve uma publicação inicial do repositório acadêmico. Antes de publicar, confirme que a instituição/empresa permite divulgar o código e que não há dados de pessoas ou detalhes internos no histórico do Git.

## 1. Criar o repositório remoto

1. Entre em https://github.com/ e crie um repositório vazio.
2. Escolha um nome, por exemplo `sistema-controle-acesso-api`.
3. Não marque a opção para gerar README, `.gitignore` ou licença, pois esses arquivos já estão neste projeto.

## 2. Preparar a pasta local

Extraia o ZIP e abra um terminal na pasta que contém `package.json` e `README.md`.

Verifique se arquivos locais sensíveis estão fora da pasta publicada:

- `.env` (mantenha apenas `.env.example` no repositório);
- `certs/`, chaves privadas e arquivos PFX/P12;
- `storage/`, fotografias e dados biométricos;
- planilhas/arquivos CSV com cadastros reais;
- backups, logs e cópias de bancos de dados.

O `.gitignore` já contém regras para esses itens, mas ele não remove arquivos que tenham sido adicionados ao Git anteriormente. Revise a lista antes de publicar.

## 3. Enviar usando Git

Substitua `USUARIO` e `NOME-DO-REPOSITORIO` pelos dados do repositório criado:

```bash
git init
git add .
git status --short
```

Revise cuidadosamente a saída de `git status --short`. Não prossiga se aparecer `.env`, `certs/`, `storage/`, fotografias, planilhas reais, backups ou logs.

Se a lista estiver correta:

```bash
git commit -m "Versão acadêmica inicial do sistema de controle de acesso"
git branch -M main
git remote add origin https://github.com/USUARIO/NOME-DO-REPOSITORIO.git
git push -u origin main
```

## 4. Conferência após publicação

Abra a página do repositório no GitHub e confirme que o `README.md`, `openapi.yaml`, `docs/`, `routes/`, `services/`, `tests/` e `views/` estão presentes. Não publique capturas de tela que mostrem nomes, imagens, endereços IP internos, números de série ou credenciais.

## 5. Licença e autoria

O `package.json` está marcado como `UNLICENSED`, pois o direito de redistribuição do código não foi presumido. Se houver autorização para publicar o projeto como software livre, escolha uma licença apropriada e inclua o arquivo correspondente. A visibilidade pública do repositório, por si só, não equivale à concessão de uma licença de reutilização.
