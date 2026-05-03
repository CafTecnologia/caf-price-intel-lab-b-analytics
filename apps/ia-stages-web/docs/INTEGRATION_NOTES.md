# Notas de Integracion

## Objetivo
Integrar ia-stages-web con financial-offer-web y, despues, con Odoo clone sin acoplar todo en una sola app.

## Principio
- ia-stages-web extrae y estructura
- financial-offer-web calcula
- Odoo clone orquesta y referencia

## Primera fase recomendada
- ia-stages-web genera JSON normalizado
- financial-offer-web recibe ese JSON por API
- Odoo clone abre cada app por URL y guarda referencias minimas

## Lo que no conviene hacer al inicio
- meter logica financiera en la app de extraccion
- pedir a la ingesta calculos que la calculadora ya sabe hacer
- incrustar de golpe toda la UI externa dentro de Odoo
