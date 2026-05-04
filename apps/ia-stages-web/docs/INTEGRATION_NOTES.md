# Notas de Integracion

## Objetivo

Integrar ia-stages-web con financial-offer-web y, despues, con Odoo clone
sin acoplar todo en una sola app.

## Principio

- ia-stages-web extrae y estructura
- financial-offer-web calcula
- Odoo clone orquesta y referencia

## Estado actual (implementado en DEV, 2026-05-03)

La integracion entre ia-stages-web y financial-offer-web esta operativa:

1. ia-stages-web ejecuta Etapas 1, 2 y 3 sobre el documento del usuario
2. Etapa 4 genera el JSON normalizado y hace POST /api/import a financial-offer-web
3. financial-offer-web responde con { calculationId, url }
4. ia-stages-web redirige automaticamente a /finanzas?calc={calculationId}
5. /finanzas embebe el simulador financiero via iframe (con fallback CSP)

El flujo es continuo: el usuario sube el documento, ejecuta las etapas y al
terminar la cotizacion llega directamente al simulador para ajustar la oferta.

## Integracion con Odoo clone (pendiente)

La primera integracion recomendada es un modulo puente liviano:

1. Odoo clone abre ia-stages-web y financial-offer-web por URL (menu o boton)
2. Odoo guarda referencias minimas de cada corrida (run_id, calculation_id, url)
3. Cuando la salida sea estable, se conecta por API/JSON

Campos minimos a guardar en Odoo:

- external_app
- external_run_id
- external_url
- status

## Lo que no conviene hacer

- Meter logica financiera en ia-stages-web
- Pedir a la ingesta calculos que financial-offer-web ya sabe hacer
- Incrustar toda la UI externa dentro de Odoo de golpe
