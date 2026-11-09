# Despliegue En VPS DEV

Esta guia es solo para el entorno de desarrollo. No tocar produccion desde aqui.

## Datos actuales

- VPS DEV: `51.178.143.231`
- Usuario SSH: `ubuntu`
- Llave SSH: `%USERPROFILE%\.ssh\caf_dev_codex`
- Ruta en VPS: `/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web`
- Contenedor Docker: `caf-dev-app-financial-offer-web`
- Puerto tunel/local: `http://127.0.0.1:18030/`

## Validar en VPS DEV

El repo canonico esta en el VPS. Validar desde:

```bash
cd /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web
npx tsc --noEmit
npm test
npm run build
```

La PC local puede usarse para editar/copiar archivos, pero no es fuente de verdad.

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

## Reiniciar la app DEV

Despues de cambios validados:

```bash
cd /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web
docker stop caf-dev-app-financial-offer-web >/dev/null 2>&1 || true
sudo chown -R ubuntu:ubuntu .next 2>/dev/null || true
npm run build
docker start caf-dev-app-financial-offer-web >/dev/null
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
