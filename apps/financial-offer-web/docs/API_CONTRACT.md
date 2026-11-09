# Contrato De Ingesta V2 - Simulador Financiero

Esta app recibe datos externos y calcula la oferta económica. No busca precios, no usa IA y no debe recibir cálculos finales.

## Idea central

La ingesta solo trae hechos externos:

- ítems;
- cantidades;
- unidades;
- precio techo unitario;
- fuentes de precio;
- notas útiles para el usuario.

La app crea su propio cálculo, ID y consecutivo. También calcula internamente costo mínimo, promedio, moderado, oferta, utilidad, margen, alertas y totales.

## Endpoint

```text
POST /api/import
Content-Type: application/json
```

Respuesta:

```json
{
  "calculationId": "uuid-creado-por-la-app",
  "url": "/calculations/uuid-creado-por-la-app"
}
```

## Campos del contrato

| Grupo | Campo | Nivel | Qué significa | Si viene vacío |
| --- | --- | --- | --- | --- |
| Sistema | `version` | Opcional | Versión del contrato. Usar `2`. | La app intenta normalizar el formato recibido. |
| Origen | `source.system` | Opcional | Sistema que envía datos. | Queda como ingesta manual/API. |
| Origen | `source.analysis_id` | Opcional | ID del análisis IA origen. | No se vincula a análisis. |
| Origen | `source.odoo_project_id` | Opcional | ID del proyecto Odoo. | No se vincula a proyecto. |
| Ítem | `items[].name` | Obligatorio | Nombre corto del ítem. | La fila no es válida. |
| Ítem | `items[].item` | Opcional | Número o código del ítem. | La app puede numerar. |
| Ítem | `items[].description` | Opcional | Ficha técnica o detalle ampliado. | Queda en blanco. |
| Ítem | `items[].quantity` | Recomendado | Cantidad. | No hay totales para esa fila. |
| Ítem | `items[].unit` | Recomendado | Unidad de medida. | Se muestra sin unidad. |
| Ítem | `items[].ceiling_unit_price` | Recomendado | Precio techo unitario. | No compara contra techo. |
| Fuentes | `items[].price_sources` | Recomendado | Fuentes de precio. Ideal 1 a 3. | No calcula costo automático. |
| Fuentes | `price_sources[].name` | Recomendado | Proveedor, tienda o fuente. | Se muestra como fuente sin nombre. |
| Fuentes | `price_sources[].unit_price` | Recomendado | Precio unitario encontrado. | Esa fuente no sirve para costo. |
| Fuentes | `price_sources[].currency` | Recomendado | `COP` o `USD`. | Asume `COP`. |
| Fuentes | `price_sources[].url` | Opcional | Link de trazabilidad. | Sin link. |
| Fuentes | `price_sources[].notes` | Opcional | Observaciones útiles. | Sin notas. |
| Fuentes | `price_sources[].trm` | Opcional | TRM específica si esa fuente está en USD. | Usa TRM interna/configurable o muestra alerta. |
| Ítem | `items[].notes` | Opcional | Notas generales del ítem. | Sin notas. |

## Ejemplo mínimo aceptable

```json
{
  "version": 2,
  "items": [
    { "name": "Taladro profesional" }
  ]
}
```

## Ejemplo recomendado

```json
{
  "version": 2,
  "source": {
    "system": "ia-stages-web",
    "analysis_id": "uuid-analisis",
    "odoo_project_id": "123"
  },
  "items": [
    {
      "item": "1",
      "name": "Taladro profesional",
      "description": "Taladro 1/2 pulg, uso profesional.",
      "unit": "UND",
      "quantity": 2,
      "ceiling_unit_price": 350000,
      "price_sources": [
        {
          "name": "Proveedor A",
          "unit_price": 210000,
          "currency": "COP",
          "url": "https://example.com/a",
          "notes": "Producto comparable"
        },
        {
          "name": "Proveedor USA",
          "unit_price": 55,
          "currency": "USD",
          "url": "https://example.com/us",
          "trm": 4000
        }
      ],
      "notes": "Revisar garantía mínima solicitada."
    }
  ]
}
```

## No enviar en el contrato público

No enviar campos que la app calcula o que el usuario ajusta dentro del simulador:

- costo manual;
- costo mínimo, promedio o moderado;
- modo de costo seleccionado;
- modo de oferta;
- descuento;
- utilidad objetivo;
- oferta manual;
- IVA operativo;
- totales;
- utilidad;
- margen;
- alertas;
- estados.

## Compatibilidad

La app puede seguir aceptando formatos anteriores (`calculation`, `project`, `reference_unit`, `source_1_*`) para no romper datos viejos ni Excel heredado. Esos campos no son el contrato público recomendado.
## Actualizaciones Incrementales IA

Para alimentar un calculo ya creado sin pisar el trabajo del usuario, usar el contrato incremental documentado en:

```text
apps/financial-offer-web/docs/IA_INCREMENTAL_UPDATES.md
```

Endpoint:

```text
POST /api/projects/{calculationId}/external-updates
```

Este endpoint actualiza solo hechos externos por item: precio techo, fuentes, notas y datos base puntuales. No modifica costo manual, costo aplicado, oferta, descuentos, utilidad, IVA ni totales.

Resumen de reglas:

- `POST /api/import` crea el calculo inicial.
- `POST /api/projects/{calculationId}/external-updates` actualiza campos puntuales mientras el usuario trabaja.
- Las fuentes se mergean por `source_id`, `id`, `url` o nombre.
- Si el usuario esta editando costo manual/oferta, esos campos se conservan.
- La UI abierta absorbe cambios externos seguros cada pocos segundos.
