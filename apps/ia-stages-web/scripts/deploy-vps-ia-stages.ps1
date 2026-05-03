#Requires -Version 5.1
<#
  Sube la Etapa 4 (bridge financiero) al ia-stages-web del VPS y ejecuta build.
  Por defecto usa %USERPROFILE%\.ssh\caf_dev_codex si existe (DEPLOY_DEV.md). Opcional: -IdentityFile.

  Origen del page.tsx fusionado (historial + TRM + Etapa 4):
    C:\Users\Cande\gestion-proyectos\prueba\vps-ia-stages-page.tsx
#>
param(
  [string] $User = "ubuntu",
  [string] $DevHost = "51.178.143.231",
  [string] $RemoteApp = "/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web",
  [string] $IdentityFile = ""
)

$ErrorActionPreference = "Stop"

$defaultKey = Join-Path $env:USERPROFILE ".ssh\caf_dev_codex"
if (-not $IdentityFile -and (Test-Path -LiteralPath $defaultKey)) {
  $IdentityFile = $defaultKey
}

$SshOpts = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
if ($IdentityFile) {
  if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "IdentityFile no existe: $IdentityFile"
  }
  $SshOpts += @("-i", $IdentityFile)
}
else {
  Write-Warning "No se encontro $defaultKey ni se paso -IdentityFile. SSH puede fallar sin agente."
}

$ForkRoot = Split-Path -Parent $PSScriptRoot
$MergedPage = "C:\Users\Cande\gestion-proyectos\prueba\vps-ia-stages-page.tsx"
$Target = "${User}@${DevHost}"

if (-not (Test-Path $MergedPage)) {
  throw "No existe el page fusionado: $MergedPage"
}

Write-Host "Destino: ${Target}:$RemoteApp"

function Stop-OnFailure {
  param([string] $Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step fallo (codigo $LASTEXITCODE)."
  }
}

& ssh @SshOpts "${Target}" "mkdir -p `"$RemoteApp/app/api/financial-offer/preview`" `"$RemoteApp/app/api/financial-offer/validate`" `"$RemoteApp/app/api/financial-offer/import`""
Stop-OnFailure "ssh mkdir"

$libFiles = @(
  "stage3-to-financial-ingest.ts",
  "financial-offer-env.ts",
  "financial-offer-proxy.ts",
  "financial-ingest-preview-rows.ts"
)
foreach ($f in $libFiles) {
  & scp @SshOpts "${ForkRoot}/lib/${f}" "${Target}:${RemoteApp}/lib/${f}"
  Stop-OnFailure "scp lib/$f"
}

& scp @SshOpts "${ForkRoot}/app/api/financial-offer/preview/route.ts" "${Target}:${RemoteApp}/app/api/financial-offer/preview/route.ts"
Stop-OnFailure "scp preview route"
& scp @SshOpts "${ForkRoot}/app/api/financial-offer/validate/route.ts" "${Target}:${RemoteApp}/app/api/financial-offer/validate/route.ts"
Stop-OnFailure "scp validate route"
& scp @SshOpts "${ForkRoot}/app/api/financial-offer/import/route.ts" "${Target}:${RemoteApp}/app/api/financial-offer/import/route.ts"
Stop-OnFailure "scp import route"

& scp @SshOpts $MergedPage "${Target}:${RemoteApp}/app/page.tsx"
Stop-OnFailure "scp page.tsx"

& scp @SshOpts "${PSScriptRoot}/etapa4-globals-fragment.css" "${Target}:/tmp/etapa4-globals-fragment.css"
Stop-OnFailure "scp globals fragment"

# Una sola linea: los here-strings de PS insertan CR y rompen bash en el servidor.
$remoteBuild = "cd '$RemoteApp' && if ! grep -qF '.inlineCode' app/globals.css; then cat /tmp/etapa4-globals-fragment.css >> app/globals.css; fi && npm install && npm run build"
& ssh @SshOpts "${Target}" $remoteBuild
Stop-OnFailure "ssh build"

Write-Host ""
Write-Host "Build terminado. Reinicia el proceso que escucha en :18031 (p. ej. npm run start -p 18031 o tu systemd)."
Write-Host "Si el puerto sigue ocupado: fuser -k 18031/tcp   # Linux"
