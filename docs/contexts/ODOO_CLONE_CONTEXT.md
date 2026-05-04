# Contexto - Odoo clone

## Rol
Entorno de integracion y validacion previa a produccion.

## URL DEV
http://127.0.0.1:18069

## Regla principal
Odoo clone orquesta y valida. No debe absorber toda la logica externa en la primera fase.

## Integracion recomendada
Usar un modulo puente liviano que abra apps externas y guarde referencias minimas.

## No mezclar con
- cambios directos en produccion
- despliegues experimentales
- incrustacion total de apps Next.js dentro de Odoo

## Leer primero
- docs/ODOO_PROMOTION_FLOW.md
- apps/ia-stages-web/docs/AGENT_HANDOFF.md
- apps/financial-offer-web/docs/AGENT_HANDOFF.md
