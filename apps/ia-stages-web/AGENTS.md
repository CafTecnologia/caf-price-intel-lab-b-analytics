# AGENTS - ia-stages-web

## Rol
Extraccion IA por etapas dentro de la suite.

## Ruta canonica
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web

## URL DEV
http://127.0.0.1:18031

## Regla principal
Generar salida normalizada y reusable. No duplicar la logica financiera del simulador.

## Antes de trabajar
Leer:
- docs/CODEX_WORKFLOW.md
- docs/contexts/IA_STAGES_CONTEXT.md
- docs/AGENT_HANDOFF.md
- docs/INTEGRATION_NOTES.md

## Validaciones minimas
npm test
npm run typecheck
npm run build
curl -I http://127.0.0.1:18031/
