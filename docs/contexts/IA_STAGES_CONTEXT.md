# Contexto - ia-stages-web

## Rol
App de extraccion IA por etapas.

## Ruta canonica
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web

## URL DEV
http://127.0.0.1:18031

## Regla principal
Debe producir datos normalizados reutilizables.
No debe empujar calculos financieros hacia la ingesta ni duplicar la logica del simulador.

## No mezclar con
- despliegues de produccion
- logica interna del simulador financiero
- trabajo de App B salvo referencia puntual

## Leer primero
- apps/ia-stages-web/AGENTS.md
- apps/ia-stages-web/docs/AGENT_HANDOFF.md
- apps/ia-stages-web/docs/INTEGRATION_NOTES.md
