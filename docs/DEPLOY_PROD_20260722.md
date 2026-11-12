# Despliegue financial-offer-web a producción - 2026-07-22

## Alcance

- Aplicación externa `financial-offer-web` actualizada en producción.
- Integración Odoo Proyecto -> simulador financiero -> callback Odoo validada.
- Los módulos Odoo `caf_external_apps` y `caf_financial_offer_app` no se reemplazaron: sus archivos ya eran idénticos en DEV y producción.
- No se modificaron otros módulos Odoo ni los datos funcionales existentes.

## Versión

- Repositorio DEV: `/opt/caf-dev/repos/caf-price-intel-lab-b-analytics`
- Commit: `55715ce feat(financial-offer): promote Odoo-connected workspace`
- Rama DEV: `chore/stable-apps-cleanup`
- SHA-256 del paquete: `2ed51406d38a23553cd8337cdca89a05a70c1356baf3cb8041137181ee1fed40`
- Ruta productiva: `/home/ubuntu/caf-prod-webapps/financial-offer-web`
- Contenedor: `caf-prod-financial-offer-web`

Se corrigió la compatibilidad con el prefijo productivo `/finanzas`. Las llamadas internas de la aplicación usan ahora el base path configurado, incluido el enlace que retorna al callback de Odoo.

## Configuración productiva

- `caf_external_apps.odoo_public_base_url=https://erp.caftecnologia.com`
- `caf_external_apps.financial_offer_base_url=https://erp.caftecnologia.com/finanzas`
- `caf_external_apps.ia_stages_base_url=https://erp.caftecnologia.com/ia`

## Copias y rollback

- Backup: `/home/ubuntu/backups/financial-offer/20260722_222446`
- Incluye dump `CafTest.before.dump`, datos del simulador, `.env.local`, inspección del contenedor y log posterior.
- Versión anterior completa: `/home/ubuntu/caf-prod-webapps/financial-offer-web.pre-20260722_222446`

## Validación

- Pruebas unitarias: 37/37 correctas.
- Build Next.js 15 con `NEXT_BASE_PATH=/finanzas`: correcto.
- Archivos DEV vs producción: 54/54 idénticos.
- `https://erp.caftecnologia.com/finanzas`: HTTP 200.
- API de proyectos financieros: HTTP 200.
- Plantilla Excel: HTTP 200.
- Odoo producción: HTTP 200.
- Cálculos persistentes conservados: 15.
- Prueba E2E temporal:
  - Odoo creó el vínculo desde un proyecto real.
  - La app generó `calculationId`.
  - El callback actualizó Odoo como `linked`.
  - La URL resultante incluyó `/finanzas/calculations/...`.
  - Los registros temporales se eliminaron en ambos sistemas.

## Pendientes técnicos

1. El acceso web y las APIs del simulador siguen publicados sin autenticación propia. Es una condición previa al despliegue, pero debe endurecerse con sesión Odoo o un proxy autenticado.
2. `npm audit` reporta 7 hallazgos. Los directos relevantes son Next.js (actualización disponible), Vitest (solo desarrollo, actualización disponible) y `xlsx` (sin corrección publicada en el paquete npm usado). Deben tratarse en una actualización de dependencias aislada y probada.
3. El commit existe en el VPS DEV, pero el `push` a GitHub fue rechazado porque `dev2` no tiene una llave autorizada para ese repositorio.
