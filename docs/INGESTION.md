# Guía De Ingesta - Simulador Financiero

La app permite tres entradas: borrador manual, Excel y JSON/API. En todos los casos la regla es la misma: la ingesta trae datos externos y la app calcula.

## Mínimo aceptable

Un ítem solo necesita nombre para crear una fila editable:

```json
{
  "version": 2,
  "items": [{ "name": "Taladro profesional" }]
}
```

## Recomendado para calcular mejor

Enviar cantidad, unidad, precio techo y 1 a 3 fuentes de precio:

```json
{
  "version": 2,
  "items": [
    {
      "item": "1",
      "name": "Taladro profesional",
      "description": "Taladro 1/2 pulg, uso profesional.",
      "unit": "UND",
      "quantity": 2,
      "ceiling_unit_price": 350000,
      "price_sources": [
        { "name": "Proveedor A", "unit_price": 210000, "currency": "COP" },
        { "name": "Proveedor USA", "unit_price": 55, "currency": "USD", "trm": 4000 }
      ]
    }
  ]
}
```

## Defaults de la app

- La app crea su propio ID y nombre/consecutivo.
- Si falta moneda de una fuente, asume COP.
- Si falta cantidad pero hay valores unitarios, la app calcula totales con cantidad efectiva `1` sin modificar el dato original.
- Si falta precio techo, no compara contra techo.
- Si faltan fuentes, la fila queda para completar dentro del simulador.
- Los servicios/costos de ítem se envían en `additional_costs`. `review_status: suggested` deja una propuesta para aplicar o descartar sin sumarla; `included` se suma y es el valor por defecto para datos anteriores. `amount: null` indica que falta cotizar y no bloquea la utilidad calculada con costos conocidos. `has_associated_cost: true` sin lista crea una sugerencia heredada.
- `source_original` conserva la fila económica literal; `technical_annex` agrega extractos literales localizados de documentos técnicos aplicables, sin mezclarlos con la interpretación.
- Los costos de todo el proyecto se envían en `general_costs`; cada entrada necesita nombre y valor no negativo.
- Ni JSON ni Excel seleccionan proveedor, modo de costo o modo de oferta. Esas decisiones se hacen en la app.

## Excel

La plantilla se descarga en:

```text
GET /api/template
```

La pantalla principal permite cargar el Excel, CSV o JSON, o pegar datos desde Excel, Markdown o JSON.

Dentro de un calculo existente tambien se pueden agregar mas items por archivo o por pegado; la app los normaliza y los anexa al final.

La hoja `Carga de items` incluye una pareja de columnas para un costo asociado por ítem; para varios costos en un mismo ítem usa JSON. La hoja opcional `Costos generales` recibe nombre, categoría, valor y nota.
