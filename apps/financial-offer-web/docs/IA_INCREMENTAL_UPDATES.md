# Contrato incremental IA -> Simulador Financiero

Este documento describe como `ia-stages-web` puede alimentar un calculo ya creado en `financial-offer-web` mientras el usuario sigue trabajando en la tabla.

## Idea central

Hay dos momentos distintos:

1. Crear el calculo inicial: usar `POST /api/import` con el contrato publico v2.
2. Actualizar datos externos del calculo: usar `POST /api/projects/{calculationId}/external-updates`.

El endpoint incremental solo actualiza hechos externos del item. No toca decisiones comerciales del usuario.

## Endpoint

```text
POST /api/projects/{calculationId}/external-updates
Content-Type: application/json
```

`calculationId` es el ID que devuelve `financial-offer-web` cuando `ia-stages-web` crea el calculo inicial.

## Campos que IA puede actualizar

| Campo enviado | Campo interno actualizado | Regla |
| --- | --- | --- |
| `items[].fields.item` | numero/codigo del item | Solo si se envia ese campo. |
| `items[].fields.name` | descripcion corta visible | Se actualiza por campo. En la UI en vivo solo se absorbe si estaba vacio. |
| `items[].fields.description` | ficha tecnica | Se actualiza por campo. En la UI en vivo solo se absorbe si estaba vacia. |
| `items[].fields.technical_description` | ficha tecnica | Alias de `description`. |
| `items[].fields.quantity` | cantidad | En endpoint se actualiza; en UI en vivo solo se absorbe si estaba vacia. |
| `items[].fields.unit` | unidad | En endpoint se actualiza; en UI en vivo solo se absorbe si estaba vacia. |
| `items[].fields.ceiling_unit_price` | precio techo unitario | Se actualiza. |
| `items[].fields.reference_unit` | precio techo unitario | Alias heredado. |
| `items[].fields.price_sources` | fuentes de precio | Se mergean por `source_id`, `id`, `url` o nombre. |
| `items[].fields.notes` | notas/alertas externas | Se actualiza. |

## Campos que IA no debe enviar

No enviar campos de trabajo del usuario ni calculos internos:

- `manual_unit_cost` / costo manual;
- `selected_cost_mode`;
- `cost_scenario_*`;
- `offer_mode`;
- `discount_pct`;
- `profit_pct`;
- `manual_offer_unit`;
- IVA operativo;
- costo aplicado;
- oferta calculada;
- utilidad, margen, totales o estados.

La app financiera conserva esos valores aunque IA mande otros campos en el mismo item.

## Matching de items

Cada update debe indicar como encontrar la fila:

```json
{
  "match": { "item": "28" },
  "fields": { "ceiling_unit_price": 1181882 }
}
```

Orden de busqueda:

1. `match.id` contra el ID interno de la fila, si lo conocen.
2. `match.item` contra el numero/codigo del item.
3. `match.name` contra la descripcion corta normalizada.
4. `match.description` contra la ficha tecnica normalizada.

Recomendacion para `ia-stages-web`: usar `item` estable desde la tabla maestra. Si se puede conservar un ID estable por fila, mejor, pero hoy `item` es suficiente para el flujo normal.

## Fuentes de precio

Cada fuente debe traer un identificador estable cuando sea posible:

```json
{
  "source_id": "stage3-item-28-source-1",
  "name": "Proveedor A",
  "unit_price": 76000,
  "currency": "COP",
  "url": "https://example.com/producto",
  "notes": "Comparable por medida y referencia"
}
```

Reglas:

- Si `source_id` ya existe, se actualiza esa fuente.
- Si no hay `source_id`, se intenta por `id`.
- Si no hay ID, se intenta por `url`.
- Si no hay URL, se intenta por nombre.
- Si no hay coincidencia, se agrega una fuente nueva.
- `currency` debe ser `COP` o `USD`.
- Si es `USD`, enviar `trm` cuando la IA tenga una TRM especifica. Si no, la financiera usa su TRM/configuracion y puede mostrar alerta.

## Payload recomendado

```json
{
  "version": 2,
  "source": {
    "system": "ia-stages-web",
    "analysis_id": "uuid-analisis",
    "run_id": "uuid-corrida",
    "stage": "stage3",
    "sequence": 12,
    "sent_at": "2026-06-05T15:20:00.000Z"
  },
  "idempotency_key": "analysis-uuid-run-uuid-stage3-seq-12",
  "items": [
    {
      "match": { "item": "28" },
      "fields": {
        "ceiling_unit_price": 1181882,
        "price_sources": [
          {
            "source_id": "stage3-28-1",
            "name": "Proveedor A",
            "unit_price": 920000,
            "currency": "COP",
            "url": "https://example.com/a",
            "notes": "Producto comparable"
          }
        ],
        "notes": "Benchmark actualizado por IA. Revisar garantia."
      }
    }
  ]
}
```

## Respuesta

```json
{
  "ok": true,
  "changed": true,
  "applied": [
    {
      "itemId": "28-1",
      "item": "28",
      "fields": ["ceiling_unit_price", "price_sources", "notes"]
    }
  ],
  "conflicts": [],
  "idempotencyKey": "analysis-uuid-run-uuid-stage3-seq-12",
  "calculation": { "...": "proyecto actualizado" },
  "project": { "...": "alias de calculation" }
}
```

Si no encuentra una fila:

```json
{
  "ok": true,
  "changed": false,
  "applied": [],
  "conflicts": [
    { "item": "999", "reason": "item_not_found" }
  ]
}
```

## Agregar items nuevos

Por defecto, si no encuentra el item, no crea filas. Para permitir append controlado:

```json
{
  "match": { "item": "99" },
  "append_if_missing": true,
  "fields": {
    "item": "99",
    "name": "Item nuevo detectado",
    "quantity": 1,
    "unit": "UND",
    "ceiling_unit_price": 100000,
    "price_sources": []
  }
}
```

## Comportamiento en la UI abierta

La pantalla del simulador consulta el proyecto cada pocos segundos. Cuando detecta cambios externos, absorbe solo hechos seguros:

- precio techo unitario;
- fuentes de precio;
- notas;
- descripcion/ficha, cantidad y unidad solo si estaban vacias.

No absorbe desde polling:

- costo manual;
- costo aplicado;
- escenario de costo;
- oferta, descuento o utilidad objetivo;
- controles de IVA.

Esto permite que el usuario siga escribiendo costo manual o ajustando oferta mientras IA alimenta fuentes y precios en segundo plano.

## Guia para adaptar `ia-stages-web`

1. Cuando no exista calculo financiero, seguir usando `/api/financial-offer/import`, que internamente llama `POST /api/import` de la financiera.
2. Guardar el `calculationId` devuelto en el analisis (`calculation_id`).
3. Cuando Stage 3 o Stage 3-B tenga nueva informacion de una fila, construir un payload incremental.
4. Enviar ese payload a la financiera:

```ts
await proxyToFinancialOfferApi(`/api/projects/${calculationId}/external-updates`, payload);
```

5. Usar `source_id` estable por fuente para que los reintentos no dupliquen fuentes.
6. No reenviar campos de costo manual, descuento, oferta, utilidad o totales.

## Nota sobre idempotencia

`idempotency_key` queda reflejado en la respuesta para trazabilidad. La idempotencia practica de fuentes depende de usar `source_id`, `id` o `url` estables; si se cambia el identificador en cada intento, la financiera lo tratara como fuente nueva.
