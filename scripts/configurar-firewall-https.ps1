#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$nomeRegra = "ControleAcessoRadioHTTPS3443"
$regra = Get-NetFirewallRule -Name $nomeRegra -ErrorAction SilentlyContinue

if ($regra) {
    Set-NetFirewallRule -Name $nomeRegra -Enabled True -Direction Inbound -Action Allow -Profile Any
    Write-Host "Regra de Firewall existente habilitada: TCP 3443 (rede local)." -ForegroundColor Green
} else {
    New-NetFirewallRule `
        -Name $nomeRegra `
        -DisplayName "Controle de Acesso da Rádio - HTTPS 3443 (rede local)" `
        -Direction Inbound `
        -Enabled True `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 3443 `
        -Profile Any `
        -RemoteAddress LocalSubnet | Out-Null
    Write-Host "Regra criada: TCP 3443 permitido somente para endereços da sub-rede local." -ForegroundColor Green
}
