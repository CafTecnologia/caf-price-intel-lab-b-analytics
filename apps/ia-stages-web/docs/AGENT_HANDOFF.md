# Handoff Para Otro Agente

## Que es esta app
Esta app es la capa de extraccion IA por etapas de la suite.

Su rol es:
- recibir archivos o contexto documental
- ejecutar extraccion y estructuracion
- producir datos normalizados reutilizables
- servir como alimentador del simulador financiero

No reemplaza al simulador financiero. No debe absorber calculos financieros internos que ya pertenecen a financial-offer-web.

## Ubicacion canonica
VPS DEV:
/opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ia-stages-web

URL DEV:
http://127.0.0.1:18031/

## Regla central
Esta app trabaja en modo VPS-first. No tomar una carpeta del PC local como fuente de verdad.

## Relacion con la suite
- Extraccion IA por etapas: esta app
- Simulador financiero deterministico: apps/financial-offer-web
- Odoo clone: punto de integracion y validacion previa a produccion

## Contrato conceptual hacia el simulador
Esta app debe entregar datos normalizados, no calculos financieros.

Debe aspirar a producir por item:
- identificador del item
- descripcion
- ficha tecnica
- cantidad
- unidad
- precio techo unitario o referencia unitaria
- fuentes de precio (price_sources), con moneda, valor unitario, URL y notas
- observaciones documentales utiles

No debe forzar al otro sistema a recibir:
- costos ya promediados
- modos de costo
- modos de oferta
- utilidad calculada
- margen calculado

Eso vive en financial-offer-web.

## Uso con Odoo clone
La primera integracion recomendada no es meter esta app dentro del core de Odoo.
La via segura es:
1. Odoo clone abre la app mediante menu o boton
2. Odoo guarda referencias minimas de la corrida
3. Cuando la salida este estable, se conecta por API/JSON al simulador financiero

## Validaciones minimas
Antes de cerrar trabajo:
npm test
npm run typecheck
npm run build
curl -I http://127.0.0.1:18031/
