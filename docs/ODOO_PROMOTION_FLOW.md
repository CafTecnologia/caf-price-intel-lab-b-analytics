# Flujo Odoo Clone y Produccion

Esta suite se promociona por etapas. No se desarrolla en produccion.

## Entornos

### VPS DEV
- IP: 51.178.143.231
- Ruta base: /opt/caf-dev
- Repo canonico: /opt/caf-dev/repos/caf-price-intel-lab-b-analytics
- Odoo clone: http://127.0.0.1:18069
- financial-offer-web: http://127.0.0.1:18030
- ia-stages-web: http://127.0.0.1:18031

### Produccion
- IP: 54.36.208.179
- Dominio: odooerp.caftecnologia.com

Produccion solo recibe cambios probados.

## Regla operativa
1. Se construye y valida una app externa en DEV.
2. Se limpia repo, docs y contrato de datos.
3. Se integra primero con Odoo clone.
4. Se prueba como usuario real.
5. Solo despues se evalua produccion.

## Integracion recomendada en Odoo clone
Primera fase: modulo puente liviano, por ejemplo caf_external_apps.
Ese modulo debe:
- agregar menus o botones
- abrir ia-stages-web y financial-offer-web
- guardar referencias minimas: external_app, external_run_id, external_url, status

No incrustar toda la logica Next.js dentro de Odoo en la primera iteracion.

## Criterio para produccion
No promocionar a produccion hasta que exista:
- validacion funcional en la app externa
- validacion funcional en Odoo clone
- backup
- rollback claro
- lista exacta de archivos o modulos a desplegar
