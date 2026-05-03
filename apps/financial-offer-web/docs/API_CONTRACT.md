# Contrato Tecnico De Ingesta

Esta app recibe datos desde cualquier sistema externo y calcula la oferta economica. No busca precios y no usa IA.

La integracion esperada es simple: otra app prepara un JSON con items, cantidades, precio techo y fuentes de costo; esta app lo ingiere, guarda un calculo y devuelve una URL para continuar trabajando.

## Estado actual del contrato

El contrato recomendado vigente usa estos 3 bloques:

- `calculation`: datos generales del calculo o borrador.
- `items`: lista de items.
- `settings`: parametros globales opcionales.

No uses nombres historicos del codigo como contrato. El contrato publico nuevo usa `calculation`.

No envies costos ya calculados. La forma recomendada es enviar `price_sources` y dejar que esta app calcule:

- minimo;
- promedio;
- moderado.

En otras palabras: el sistema que alimenta esta app debe entregar fuentes/precios unitarios; esta app calcula los escenarios financieros.

## Endpoint principal

```text
POST /api/import
Content-Type: application/json
```

Respuesta:

```json
{
  "calculationId": "uuid",
  "url": "/calculations/uuid",
  "calculation": {
    "id": "uuid",
    "name": "Oferta ferreteria"
  }
}
```

Para validar sin guardar:

```text
POST /api/validate
```

## Payload minimo recomendado

Este es el contrato que debe usar otra app por defecto. No contiene calculos ni decisiones internas de la calculadora.

```json
{
  "version": 1,
  "calculation": {
    "name": "Oferta ferreteria"
  },
  "items": [
    {
      "item": "1",
      "description": "Taladro percutor profesional",
      "technical_description": "Taladro 1/2 pulg, uso profesional.",
      "quantity": 2,
      "unit": "UND",
      "reference_unit": 350000,
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
          "import_pct": 30
        }
      ]
    }
  ],
  "settings": {
    "usd_to_cop_rate": 4000
  }
}
```

`settings` puede omitirse si no hay fuentes USD. Si hay fuentes USD y no viene TRM por fuente, la app usa `settings.usd_to_cop_rate`.

La app asume por defecto:

- IVA incluido.
- IVA 19%.
- importacion USD 30%.
- costo aplicado inicial: moderado.
- oferta inicial: igual al precio techo.
- margen inicial: 0%.

Por eso esos campos no hacen falta en el contrato minimo.

## Regla de creacion vs actualizacion

- Si `calculation.external_id` viene vacio o `null`, cada importacion crea un calculo nuevo.
- Si `external_id` viene con valor y se combina con el mismo `source_system`, la app actualiza el calculo existente.
- Para pruebas de laboratorio conviene usar `external_id: null`.
- Para integraciones reales conviene usar un ID estable del sistema origen.

## Campos de calculo

| Campo | Requerido | Descripcion |
| --- | --- | --- |
| `external_id` | no | ID del sistema origen. Si se repite junto con `source_system`, actualiza el calculo. |
| `source_system` | no | Sistema que envia los datos. |
| `name` | si | Nombre visible del calculo. Se puede cambiar despues. |
| `entity` | no | Entidad o cliente. |
| `currency` | no | Por ahora `COP`. |

## Campos de item

| Campo | Requerido | Tipo | Descripcion |
| --- | --- | --- | --- |
| `item` | no | texto | Numero o codigo visible. |
| `description` | si | texto | Nombre o descripcion corta. |
| `technical_description` | no | texto | Ficha tecnica ampliada. |
| `quantity` | no | numero/texto | Cantidad. |
| `unit` | no | texto | Unidad de medida. |
| `reference_unit` | no | numero/texto | Precio techo unitario. |
| `price_sources` | recomendado | array | Fuentes de precio unitario. La app calcula minimo, promedio y moderado desde aqui. |

No documentes ni pidas campos de calculo en sistemas externos. La app decide y calcula internamente costo aplicado, oferta, descuento, utilidad, margen, IVA operativo y alertas.

### Compatibilidad

El codigo puede aceptar formatos antiguos para no romper datos previos, pero esos campos no hacen parte del contrato publico de ingesta. No los uses como referencia para construir nuevas integraciones.

Si otro sistema ya calculo valores financieros, no debe enviarlos en integraciones nuevas. Debe enviar las fuentes y dejar que esta app calcule todo con una sola logica.

## Fuente de precio

| Campo | Requerido | Descripcion |
| --- | --- | --- |
| `name` | no | Nombre de proveedor, tienda o fuente. |
| `unit_price` | no | Precio unitario de la fuente. |
| `currency` | no | `COP` o `USD`. Por defecto `COP`. |
| `url` | no | Enlace de trazabilidad. |
| `notes` | no | Observaciones de comparabilidad. |
| `trm` | no | TRM especifica para esa fuente USD. Si falta, usa `settings.usd_to_cop_rate`. |
| `import_pct` | no | Porcentaje de importacion de esa fuente USD. Si falta, usa `settings.usd_import_pct`. |

### Columnas planas para Excel

Tambien se aceptan:

```text
source_1_name, source_1_price, source_1_currency, source_1_url, source_1_trm, source_1_import_pct
source_2_name, source_2_price, source_2_currency, source_2_url, source_2_trm, source_2_import_pct
source_3_name, source_3_price, source_3_currency, source_3_url, source_3_trm, source_3_import_pct
```

## Calculos internos

La app calcula:

- costo minimo;
- costo promedio;
- costo moderado;
- costo aplicado;
- oferta;
- utilidad;
- margen;
- estados;
- alertas.

Estos calculos son internos. Un sistema externo no necesita conocer ni enviar esos campos.

## USD

Para fuentes en USD:

```text
COP_normalizado = unit_price * TRM * (1 + import_pct / 100)
```

Si no hay TRM global ni TRM de fuente, la fuente queda sin costo normalizado y se muestra alerta.

## Exportacion

```text
GET /api/projects/{id}/export?format=json
GET /api/projects/{id}/export?format=csv
```

El nombre `projects` se mantiene por compatibilidad interna. Conceptualmente el recurso es un calculo.

## Ejemplo de laboratorio

La pantalla principal incluye un ejemplo por defecto llamado `Laboratorio de calculo financiero` con 8 items. Cubre:

- fuentes COP y USD;
- importacion 30%;
- costo minimo, promedio, moderado y manual;
- oferta por descuento, utilidad objetivo y manual;
- item sin costo;
- item sin techo;
- costo mayor al techo;
- IVA incluido y exento.

Ese ejemplo usa `external_id: null` para que cada importacion cree un calculo nuevo.
