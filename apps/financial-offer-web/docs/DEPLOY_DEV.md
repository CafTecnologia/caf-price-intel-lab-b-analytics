# Despliegue En VPS DEV

Esta guia es solo para el entorno de desarrollo. No tocar produccion desde aqui.

## Datos actuales

- App local de trabajo: `C:\Users\Cande\gestion-proyectos\prueba\tmp-financial-offer-web`
- VPS DEV: `51.178.143.231`
- Usuario SSH: `ubuntu`
- Llave SSH: `%USERPROFILE%\.ssh\caf_dev_codex`
- Ruta en VPS: `/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web`
- Contenedor Docker: `caf-dev-app-financial-offer-web`
- Puerto tunel/local: `http://127.0.0.1:18030/`

## Validar local antes de subir

Desde la carpeta local:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Si todo pasa, se puede subir al VPS DEV.

## SSH sin `-i` cada vez (Windows)

Las llaves no van en el repo: usuario `%USERPROFILE%\.ssh\caf_dev_codex`. Para que `ssh ubuntu@51.178.143.231` use esa clave automaticamente, en `%USERPROFILE%\.ssh\config` debe existir (o equivalente):

```ssh-config
Host 51.178.143.231
  HostName 51.178.143.231
  User ubuntu
  IdentityFile ~/.ssh/caf_dev_codex
  IdentitiesOnly yes

Host caf-dev
  HostName 51.178.143.231
  User ubuntu
  IdentityFile ~/.ssh/caf_dev_codex
  IdentitiesOnly yes
```

Luego podés usar `ssh caf-dev` o `scp archivo caf-dev:/tmp/`.

## Desplegar al VPS DEV

Desde PowerShell en Windows, ubicado en la carpeta local de la app:

```powershell
$ErrorActionPreference='Stop'
$archive = Join-Path $env:TEMP 'financial-offer-web.tgz'
if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
tar --exclude='./node_modules' --exclude='./.next' --exclude='./tsconfig.tsbuildinfo' -czf $archive .
scp -i "$env:USERPROFILE\.ssh\caf_dev_codex" $archive ubuntu@51.178.143.231:/tmp/financial-offer-web.tgz
ssh -i "$env:USERPROFILE\.ssh\caf_dev_codex" ubuntu@51.178.143.231 'set -e; cd /opt/caf-dev/repos/caf-price-intel-lab-b-analytics; docker stop caf-dev-app-financial-offer-web >/dev/null 2>&1 || true; sudo chown -R ubuntu:ubuntu apps/financial-offer-web 2>/dev/null || true; ts=$(date +%Y%m%d_%H%M%S); mkdir -p /opt/caf-dev/backups/financial-offer-web; if [ -d apps/financial-offer-web ]; then sudo cp -a apps/financial-offer-web /opt/caf-dev/backups/financial-offer-web/financial-offer-web.backup-$ts; fi; sudo rm -rf apps/financial-offer-web; sudo mkdir -p apps/financial-offer-web; sudo tar -xzf /tmp/financial-offer-web.tgz -C apps/financial-offer-web; sudo chown -R ubuntu:ubuntu apps/financial-offer-web; sudo chmod -R u+rwX apps/financial-offer-web; npm --prefix apps/financial-offer-web install >/tmp/financial-offer-npm-install.log; npm --prefix apps/financial-offer-web test; npm --prefix apps/financial-offer-web run build; docker start caf-dev-app-financial-offer-web >/dev/null || docker restart caf-dev-app-financial-offer-web'
```

## Verificar en VPS

```powershell
ssh -i "$env:USERPROFILE\.ssh\caf_dev_codex" ubuntu@51.178.143.231 "docker ps -a --filter name=caf-dev-app-financial-offer-web --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'; curl -I --max-time 20 http://127.0.0.1:18030/"
```

Debe devolver `HTTP/1.1 200 OK`.

## Prueba funcional rapida

1. Abrir `http://127.0.0.1:18030/?v=latest`.
2. Pulsar `Usar ejemplo`.
3. Pulsar `Importar y abrir calculo`.
4. Debe abrir un calculo nuevo llamado `Laboratorio de calculo financiero`.
5. Debe mostrar 8 items.

## Notas

- El contenedor recompila al iniciar. Despues de reiniciar puede tardar 1 o 2 minutos en responder.
- Si `curl` da `Connection reset by peer` justo despues de reiniciar, esperar y repetir.
- Cada despliegue crea respaldo en `/opt/caf-dev/backups/financial-offer-web/`.
- No usar estos comandos para produccion.
