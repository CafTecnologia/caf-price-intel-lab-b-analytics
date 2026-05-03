#Requires -Version 5.1
<#
  Sube la app completa (Extracción de datos estratégicos) a ia-stages-web en el VPS DEV,
  respalda la carpeta anterior, preserva data/ del servidor, instala, test, build y reinicia :18031.

  Requisitos: llave %USERPROFILE%\.ssh\caf_dev_codex (ver tmp-financial-offer-web/docs/DEPLOY_DEV.md).

  Uso (desde la raíz del fork):
    powershell -File scripts/deploy-vps-ia-full.ps1
#>
param(
  [string] $User = "ubuntu",
  [string] $DevHost = "51.178.143.231",
  [string] $RemoteRepo = "/opt/caf-dev/repos/caf-price-intel-lab-b-analytics",
  [string] $RemoteApp = "apps/ia-stages-web",
  [string] $IdentityFile = ""
)

$ErrorActionPreference = "Stop"

$defaultKey = Join-Path $env:USERPROFILE ".ssh\caf_dev_codex"
if (-not $IdentityFile -and (Test-Path -LiteralPath $defaultKey)) {
  $IdentityFile = $defaultKey
}

$SshScp = @()
if ($IdentityFile) {
  if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "IdentityFile no existe: $IdentityFile"
  }
  $SshScp += @("-i", $IdentityFile)
}
$SshScp += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=25")

$ForkRoot = Split-Path -Parent $PSScriptRoot
$Target = "${User}@${DevHost}"
$archive = Join-Path $env:TEMP "ia-stages-web.tgz"

if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }

Write-Host "Empaquetando desde $ForkRoot ..."
Set-Location $ForkRoot
& tar @(
  "--exclude=./node_modules",
  "--exclude=./.next",
  "--exclude=./data",
  "--exclude=./tsconfig.tsbuildinfo",
  "--exclude=./.git",
  "--exclude=./.cursor",
  "--exclude=./.remote_edit",
  "--exclude=./agentic-financial-analysis",
  "--exclude=./appb_edit",
  "--exclude=./logs",
  "-czf", $archive, "."
)
if ($LASTEXITCODE -ne 0) { throw "tar fallo (codigo $LASTEXITCODE)." }

Write-Host "Subiendo a ${Target}:/tmp/ia-stages-web.tgz ..."
& scp @SshScp $archive "${Target}:/tmp/ia-stages-web.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp fallo (codigo $LASTEXITCODE)." }

$remote = @'
set -e
cd /REPO
ts=$(date +%Y%m%d_%H%M%S)
mkdir -p /opt/caf-dev/backups/ia-stages-web
if [ -d apps/ia-stages-web ]; then sudo cp -a apps/ia-stages-web /opt/caf-dev/backups/ia-stages-web/ia-stages-web.backup-$ts; fi
DATA_BAK="/opt/caf-dev/backups/ia-stages-web/ia-stages-web.backup-$ts/data"
sudo fuser -k 18031/tcp 2>/dev/null || true
sleep 2
sudo rm -rf apps/ia-stages-web
sudo mkdir -p apps/ia-stages-web
sudo tar -xzf /tmp/ia-stages-web.tgz -C apps/ia-stages-web
sudo chown -R ubuntu:ubuntu apps/ia-stages-web
if [ -d "$DATA_BAK" ]; then sudo rm -rf apps/ia-stages-web/data; sudo cp -a "$DATA_BAK" apps/ia-stages-web/data; sudo chown -R ubuntu:ubuntu apps/ia-stages-web/data; fi
npm --prefix apps/ia-stages-web install >/tmp/ia-stages-npm-install.log
npm --prefix apps/ia-stages-web test
npm --prefix apps/ia-stages-web run build
sudo fuser -k 18031/tcp 2>/dev/null || true
sleep 2
cd apps/ia-stages-web
nohup npm run start:vps >>/tmp/ia-stages-start.log 2>&1 &
sleep 4
curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 25 http://127.0.0.1:18031/ || true
'@
$remote = $remote -replace "/REPO", $RemoteRepo
# Bash en Linux no tolera CRLF en el script remoto
$remote = $remote -replace "`r`n", "`n"

Write-Host "Instalando, probando, build y reinicio en VPS ..."
& ssh @SshScp $Target $remote
if ($LASTEXITCODE -ne 0) { throw "ssh deploy fallo (codigo $LASTEXITCODE)." }

Write-Host "Listo. Log arranque: /tmp/ia-stages-start.log en el VPS."
