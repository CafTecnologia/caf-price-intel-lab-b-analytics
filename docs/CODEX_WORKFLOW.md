# Trabajo Con Codex

Esta guia existe para bajar consumo de contexto y mantener foco entre sesiones.

## Regla principal

Trabajamos en modo VPS-first. El codigo canonico vive en:
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics

La PC local del usuario se usa solo como cliente: navegador, tuneles SSH, VS Code Web y chat.

## Como dividir sesiones

Abrir una sesion distinta por frente de trabajo:
1. financial-offer-web
2. ia-stages-web
3. Odoo clone / integracion
4. infraestructura VPS / GitHub / tuneles

No mezclar varios frentes en el mismo chat salvo que la tarea dependa de ambos.

## Que leer al arrancar

Para el simulador financiero:
- apps/financial-offer-web/VPS_WORKFLOW.md
- apps/financial-offer-web/docs/AGENT_HANDOFF.md
- apps/financial-offer-web/docs/API_CONTRACT.md

Para la extraccion IA por etapas:
- apps/ia-stages-web/VPS_WORKFLOW.md
- apps/ia-stages-web/docs/AGENT_HANDOFF.md

Para promocion a Odoo clone o produccion:
- docs/ODOO_PROMOTION_FLOW.md

## Cierre obligatorio de cada bloque

Cada bloque de trabajo debe cerrar con:
- resumen corto de lo hecho
- pruebas ejecutadas
- riesgo pendiente
- siguiente paso recomendado
- commit o razon por la que no se hizo commit

## Regla para Git

Antes de editar, confirmar siempre:
pwd
git status
git branch --show-current
git remote -v

No asumir que una carpeta local del PC es la fuente de verdad.
