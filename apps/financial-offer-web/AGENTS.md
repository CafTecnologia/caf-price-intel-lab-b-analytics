# AGENTS - financial-offer-web

## Rol
Simulador financiero deterministico independiente.

## Ruta canonica
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/financial-offer-web

## URL DEV
http://127.0.0.1:18030

## Regla principal
No pedir a la ingesta calculos internos. La app recibe datos normalizados y calcula internamente.

## Antes de trabajar
Leer:
- docs/CODEX_WORKFLOW.md
- docs/contexts/FINANCIAL_OFFER_CONTEXT.md
- docs/API_CONTRACT.md
- docs/AGENT_HANDOFF.md

## Validaciones minimas
npm test
npx tsc --noEmit
npm run build
curl -I http://127.0.0.1:18030/
