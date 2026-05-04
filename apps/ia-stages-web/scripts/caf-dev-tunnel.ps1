# Mismo mapa de reenvio que tmp-financial-offer-web/scripts/caf-dev-tunnel.ps1
# (mantener ambos alineados). Ver comentario en TUNNEL.txt del fork.
param(
  [string] $DevHost = "51.178.143.231",
  [string] $User = "ubuntu",
  [int] $ServerAliveInterval = 60,
  [switch] $RegisterLogonTask
)

$ErrorActionPreference = "Stop"

$Forwards = @(
  "8088:127.0.0.1:8088",
  "18080:127.0.0.1:18080",
  "13100:127.0.0.1:13100",
  "13101:127.0.0.1:13101",
  "13102:127.0.0.1:13102",
  "13103:127.0.0.1:13103",
  "13104:127.0.0.1:13104",
  "13110:127.0.0.1:13110",
  "18069:127.0.0.1:18069",
  "18443:127.0.0.1:18443",
  "15678:127.0.0.1:15678",
  "13000:127.0.0.1:13000",
  "18020:127.0.0.1:18020",
  "18030:127.0.0.1:18030",
  "18031:127.0.0.1:18031",
  "19000:127.0.0.1:19000",
  "19090:127.0.0.1:19090",
  "13001:127.0.0.1:13001",
  "13002:127.0.0.1:13002",
  "13280:127.0.0.1:13280",
  "13200:127.0.0.1:13200",
  "13210:127.0.0.1:13210",
  "13220:127.0.0.1:13220",
  "13230:127.0.0.1:13230"
)

if ($RegisterLogonTask) {
  $scriptPath = $MyInvocation.MyCommand.Path
  $taskName = "CAF-DEV-SSH-Tunnels"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Tarea '$taskName' registrada."
  exit 0
}

$sshArgs = @("-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=$ServerAliveInterval", "-o", "ServerAliveCountMax=3")
foreach ($map in $Forwards) {
  $sshArgs += "-L"
  $sshArgs += $map
}
$sshArgs += "${User}@${DevHost}"

Write-Host ""
Write-Host "CAF DEV - Tunel seguro abierto"
Write-Host "Deja esta ventana abierta mientras uses el panel."
Write-Host "Si la conexion se cae, este archivo intentara reconectar solo."
Write-Host ""
Write-Host "Panel principal:  http://127.0.0.1:8088"
Write-Host "Panel seguro:     http://127.0.0.1:18080"
Write-Host "Chat IA DEV:      http://127.0.0.1:13100"
Write-Host "Chat Odoo DEV:    http://127.0.0.1:13101"
Write-Host "Chat Lab A:       http://127.0.0.1:13102"
Write-Host "Chat Lab B:       http://127.0.0.1:13103"
Write-Host "Chat Lab C:       http://127.0.0.1:13104"
Write-Host "Archivos DEV:     http://127.0.0.1:13110"
Write-Host "Odoo dev:         http://127.0.0.1:18069"
Write-Host "VS Code Web:      http://127.0.0.1:18443"
Write-Host "n8n:              http://127.0.0.1:15678"
Write-Host "Navegador VPS:    http://127.0.0.1:13000"
Write-Host "App B segura:     http://127.0.0.1:18080/app-b/"
Write-Host "App B directa:    http://127.0.0.1:18020"
Write-Host "Simulador Oferta: http://127.0.0.1:18030"
Write-Host "Pipeline IA fork: http://127.0.0.1:18031"
Write-Host "Portainer:        http://127.0.0.1:19000"
Write-Host "Cockpit:          https://127.0.0.1:19090"
Write-Host "App Proyecto 2:   http://127.0.0.1:13001"
Write-Host "App Local:        http://127.0.0.1:13002"
Write-Host ""
Write-Host "CAF OPS Panel:    http://127.0.0.1:13280"
Write-Host "OPS Browser:      http://127.0.0.1:13200"
Write-Host "OPS Archivos:     http://127.0.0.1:13210"
Write-Host "OPS Chat:         http://127.0.0.1:13220"
Write-Host "OPS OpenClaw:     http://127.0.0.1:13230"
Write-Host ""

while ($true) {
  $stamp = Get-Date -Format "[ddd dd/MM/yyyy HH:mm:ss,ff]"
  Write-Host "$stamp Conectando tunel CAF DEV..."
  & ssh @sshArgs
  $stamp = Get-Date -Format "[ddd dd/MM/yyyy HH:mm:ss,ff]"
  Write-Host ""
  Write-Host "$stamp El tunel se cerro. Reintentando en 5 segundos..."
  Write-Host ""
  Start-Sleep -Seconds 5
}
