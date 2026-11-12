[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$IpServidor
)

$ErrorActionPreference = "Stop"
$raizProjeto = Split-Path -Parent $PSScriptRoot
$arquivoEnv = Join-Path $raizProjeto ".env"
$diretorioCertificados = Join-Path $raizProjeto "certs"

if (-not (Test-Path $arquivoEnv -PathType Leaf)) {
    throw "Arquivo .env não encontrado em $raizProjeto. Execute este script na cópia correta do projeto."
}

$ipObjeto = $null
if (-not [System.Net.IPAddress]::TryParse($IpServidor, [ref]$ipObjeto)) {
    throw "IP inválido: $IpServidor"
}

New-Item -ItemType Directory -Path $diretorioCertificados -Force | Out-Null
$pfxPath = Join-Path $diretorioCertificados "controle-acesso.pfx"
$caPath = Join-Path $diretorioCertificados "controle-acesso-root-ca.cer"

# Gera uma senha aleatória para o PFX e grava-a apenas no .env local.
$bytesSenha = New-Object byte[] 48
$gerador = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $gerador.GetBytes($bytesSenha)
}
finally {
    $gerador.Dispose()
}
$senhaPfxTexto = [Convert]::ToBase64String($bytesSenha).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$senhaPfx = ConvertTo-SecureString -String $senhaPfxTexto -AsPlainText -Force

Write-Host "Criando certificado HTTPS local para $IpServidor..." -ForegroundColor Cyan

$ca = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=Controle de Acesso Radio - Local CA" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage CertSign, CRLSign `
    -NotAfter (Get-Date).AddYears(8) `
    -TextExtension @("2.5.29.19={critical}{text}ca=1")

$certificadoServidor = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$IpServidor" `
    -Signer $ca `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @(
        "2.5.29.17={text}IPAddress=$IpServidor",
        "2.5.29.37={text}1.3.6.1.5.5.7.3.1"
    )

Export-Certificate -Cert $ca -FilePath $caPath -Type CERT -Force | Out-Null
Export-PfxCertificate -Cert $certificadoServidor -FilePath $pfxPath -Password $senhaPfx -ChainOption BuildChain -Force | Out-Null

# Confia na CA no perfil Windows do usuário que executa o servidor Node.js.
Import-Certificate -FilePath $caPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null

$conteudoEnv = [System.IO.File]::ReadAllText($arquivoEnv)
if (-not $conteudoEnv.EndsWith("`n")) { $conteudoEnv += "`r`n" }

$configuracoes = [ordered]@{
    "HTTPS_PORT" = "3443"
    "HTTPS_PFX_PATH" = "./certs/controle-acesso.pfx"
    "HTTPS_PFX_PASSPHRASE" = $senhaPfxTexto
    "HTTPS_KEY_PATH" = ""
    "HTTPS_CERT_PATH" = ""
}

# Completa somente as variaveis ausentes; preserva IPs e demais configuracoes ja existentes.
$padroesAusentes = [ordered]@{
    "INTELBRAS_WEBHOOK_IPS" = ""
    "INTELBRAS_WEBHOOK_MAX_BYTES" = "12mb"
    "BIOMETRIA_STORAGE_DIR" = "./storage/ocorrencias-face"
    "BIOMETRIA_RETENCAO_DIAS" = "30"
}
foreach ($item in $padroesAusentes.GetEnumerator()) {
    $padrao = "(?m)^" + [regex]::Escape($item.Key) + "=.*$"
    if (-not [regex]::IsMatch($conteudoEnv, $padrao)) {
        $conteudoEnv += $item.Key + "=" + $item.Value + "`r`n"
    }
}

foreach ($item in $configuracoes.GetEnumerator()) {
    $padrao = "(?m)^" + [regex]::Escape($item.Key) + "=.*$"
    $linha = $item.Key + "=" + $item.Value
    if ([regex]::IsMatch($conteudoEnv, $padrao)) {
        $conteudoEnv = [regex]::Replace(
            $conteudoEnv,
            $padrao,
            [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $linha }
        )
    } else {
        $conteudoEnv += $linha + "`r`n"
    }
}

$utf8SemBOM = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($arquivoEnv, $conteudoEnv, $utf8SemBOM)

Write-Host "" 
Write-Host "Certificado HTTPS criado e configurado no .env." -ForegroundColor Green
Write-Host "PFX: $pfxPath"
Write-Host "CA pública: $caPath"
Write-Host "IP incluído no certificado: $IpServidor"
Write-Host "A senha do PFX foi gerada automaticamente e salva somente no .env local."
Write-Host "" 
Write-Host "IMPORTANTE: este certificado usa uma CA privada local. Outros computadores precisam confiar no arquivo .cer." -ForegroundColor Yellow
Write-Host "A confiança TLS pelo terminal Intelbras ainda precisa ser validada antes de trocar o POST para HTTPS." -ForegroundColor Yellow
