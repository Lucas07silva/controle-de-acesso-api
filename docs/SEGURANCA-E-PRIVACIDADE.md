# Segurança e privacidade

Este documento descreve os controles presentes no código e as precauções necessárias para uma implantação responsável. A existência dos controles descritos não representa certificação de segurança nem declaração de conformidade jurídica.

## 1. Proteção dos segredos

- Credenciais e segredos são carregados de `.env` por `dotenv`.
- `.env`, certificados, chaves privadas, fotografias, pastas de armazenamento e backups são ignorados pelo Git.
- A conta administrativa do dashboard é independente das credenciais do terminal.
- Recomenda-se uma senha longa (12 ou mais caracteres). O código atual também aceita um PIN de quatro dígitos por compatibilidade, mas esse formato oferece menor resistência a tentativas de adivinhação.
- `BIOMETRIA_SESSION_SECRET` deve ser aleatório e ter pelo menos 32 caracteres.
- Não envie `.env`, PFX, chave privada, senha, exportação de funcionário ou fotografia em commits, issues ou capturas de tela.

## 2. Sessão administrativa

- A senha é comparada com `crypto.timingSafeEqual`.
- O token de sessão é assinado com HMAC-SHA-256.
- A sessão expira após duas horas.
- O cookie usa `HttpOnly` e `SameSite=Strict`; em conexão HTTPS, também recebe `Secure`.
- O login limita cinco tentativas por IP em uma janela de 15 minutos. O contador é mantido em memória; reiniciar o processo limpa os contadores.
- Rotas administrativas usam middleware de sessão e exigem canal seguro para acesso remoto.
- Rotas que alteram estado também verificam a origem da requisição.

## 3. Criptografia e comunicação

Existem dois fluxos TLS distintos:

1. **Terminal → aplicação:** o POST de eventos deve usar HTTPS para permitir o armazenamento de fotografias. O servidor verifica o IP remoto contra `INTELBRAS_WEBHOOK_IPS`.
2. **Aplicação → terminal:** as operações CGI usam HTTPS, autenticação Digest e validação do certificado do terminal. `INTELBRAS_CA_PATH` pode indicar a CA confiável.

Não desative a validação TLS e não use `NODE_TLS_REJECT_UNAUTHORIZED=0`. Certificados locais são úteis para desenvolvimento controlado, mas a aceitação pelo equipamento deve ser validada no firmware real.

## 4. Fotografias e arquivos sensíveis

- As fotografias de ocorrências ficam fora de `public/`.
- A rota de leitura da foto exige sessão administrativa e registra a consulta em auditoria.
- A resposta da imagem inclui cabeçalhos de cache privado e `nosniff`.
- O sistema registra metadados, tamanho, MIME detectado e hash SHA-256; os bytes são armazenados em diretório local privado.
- A rotina de retenção remove arquivo e documento após o prazo configurado.
- O diretório deve ter permissões de sistema operacional restritas ao usuário de serviço e administradores.

## 5. Limitação importante das rotas gerais

Na versão atual, rotas como `GET /api/eventos`, `GET /api/dashboard/resumo`, `GET /api/relatorios/mensal`, `GET /api/funcionarios` e `GET /api/funcionarios/{userId}/movimentacoes` não exigem uma sessão de usuário. Portanto:

- mantenha a aplicação em rede interna controlada;
- não publique essas rotas diretamente na Internet;
- restrinja o acesso por firewall/rede enquanto não houver autorização por perfil;
- implemente autenticação e autorização também para consultas gerais antes de uma implantação mais ampla.

O webhook `POST /api/eventos` só rejeita IPs não autorizados quando a lista `INTELBRAS_WEBHOOK_IPS` está preenchida. Para armazenar fotografias, a lista deve estar preenchida com o IP real de origem e a requisição precisa chegar por HTTPS.

## 6. Proteção de dados e LGPD

Fotografias faciais e dados biométricos vinculados a uma pessoa identificada ou identificável podem constituir dados pessoais sensíveis. Antes do uso real, a organização responsável deve avaliar a hipótese legal aplicável, necessidade e proporcionalidade, transparência aos titulares, controle de acesso, prazo de retenção, descarte, registros de auditoria e atendimento aos direitos dos titulares.

O projeto inclui confirmação administrativa no fluxo de cadastro facial, mas essa confirmação técnica não substitui a avaliação jurídica nem garante conformidade com a LGPD.

## 7. Recomendações para publicação no GitHub

Antes de publicar:

1. Execute `git status --short` e revise todos os arquivos preparados.
2. Confirme que `.env`, `certs/`, `storage/`, CSVs, backups e fotos não aparecem na lista de arquivos versionados.
3. Remova dados reais, IPs internos, número de série, nomes, IDs de funcionários e capturas com informações pessoais.
4. Use apenas exemplos fictícios nos documentos e testes.
5. Não inclua dumps de MongoDB ou exportações do terminal.
