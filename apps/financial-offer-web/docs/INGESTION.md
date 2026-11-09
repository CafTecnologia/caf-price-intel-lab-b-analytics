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

## Excel

La plantilla se descarga en:

```text
GET /api/template
```

La pantalla principal permite cargar el Excel, CSV o JSON, o pegar datos desde Excel, Markdown o JSON.

Dentro de un calculo existente tambien se pueden agregar mas items por archivo o por pegado; la app los normaliza y los anexa al final.
