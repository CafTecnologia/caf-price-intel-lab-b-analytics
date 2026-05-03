# Guia De Ingesta - Calculadora De Oferta

## Para una persona no tecnica

La app funciona como una calculadora grande:

1. Recibe o permite escribir una lista de items.
2. Cada item puede tener hasta 3 fuentes de precio.
3. La app calcula costo minimo, promedio y moderado.
4. El usuario puede escoger que costo usar o escribir un costo manual.
5. La app calcula oferta, utilidad, alertas y exporta resultados.

No busca precios y no usa IA. Quien entregue los datos debe enviar fuentes y precios.

La idea correcta es: otro sistema hace la investigacion o captura de datos; esta app recibe esos datos y calcula una oferta financiera editable.

## Para sistemas externos

Enviar `POST /api/import` con JSON. El contrato recomendado usa `calculation`, `items` y `settings`.

Importante para integradores:

- Usa `calculation`, no `project`, en integraciones nuevas.
- Envia fuentes de precio en `price_sources`.
- No envies costos calculados; la app los calcula internamente desde las fuentes.
- No envies modos de costo, modos de oferta, descuentos, utilidad, margen, IVA operativo ni costos calculados. Eso es logica interna de la app.
- `settings` puede venir vacio. Si hay fuentes USD, envia solo `usd_to_cop_rate` o una TRM por fuente.

Ejemplo corto:

```json
{
  "version": 1,
  "calculation": {
    "name": "Calculo oferta ferreteria"
  },
  "items": [
    {
      "item": "1",
      "description": "Taladro profesional",
      "quantity": 2,
      "unit": "UND",
      "reference_unit": 350000,
      "price_sources": [
        { "name": "Proveedor A", "unit_price": 210000, "currency": "COP" },
        { "name": "Proveedor USA", "unit_price": 55, "currency": "USD" }
      ]
    }
  ],
  "settings": {
    "usd_to_cop_rate": 4000
  }
}
```

Respuesta esperada:

```json
{
  "calculationId": "...",
  "url": "/calculations/..."
}
```

Despues de importar, abre la URL recibida en `url`. Esa URL apunta al calculo guardado.

Si quieres que cada envio cree un calculo nuevo, usa `external_id: null`.
Si quieres actualizar un calculo existente desde otra app, envia siempre el mismo `external_id` y `source_system`.

## Validar sin guardar

```text
POST /api/validate
```

Devuelve `ok: true` si el JSON es aceptado.

## Campos minimos por item

| Campo | Requerido | Explicacion |
| --- | --- | --- |
| `description` | si | Nombre o descripcion del item. |
| `quantity` | no | Cantidad. |
| `unit` | no | Unidad. |
| `reference_unit` | no | Precio techo unitario. |
| `price_sources` | no | Fuentes de precio. |

Con esos datos la app calcula minimo, promedio, moderado, costo aplicado inicial, oferta, utilidad, margen y alertas.

## Lo que no debe enviar la ingesta

La ingesta no debe enviar calculos ni decisiones internas de simulacion. No hacen parte del contrato publico.

Ejemplos de cosas que debe calcular o decidir la app:

- costo minimo;
- costo promedio;
- costo moderado;
- costo aplicado;
- oferta unitaria;
- descuento;
- utilidad;
- margen;
- estado;
- alertas.

## Regla practica de costo

- Si hay fuentes, la app calcula los costos.
- Si faltan fuentes pero hay costo manual, el usuario puede trabajar en manual.
- Si falta TRM para USD, esa fuente no se usa hasta completar la TRM.
- Si hay fuente USD y no trae `trm`, se usa `settings.usd_to_cop_rate`.
- Si hay fuente USD y no trae `import_pct`, se usa `settings.usd_import_pct`, normalmente 30.

## Regla practica de oferta

- Por defecto la oferta queda igual al precio techo.
- Si el usuario quiere bajar oferta frente al techo, usa modo `discount`.
- Si el usuario quiere partir desde costo y utilidad, usa modo `profit`.
- Si el usuario quiere escribir la oferta exacta, usa modo `manual`.

## IVA en palabras simples

Por defecto, se asume que los precios ya vienen con IVA incluido.

Usa:

- `included`: precio ya tiene IVA incluido.
- `excluded`: precio viene sin IVA y la app debe sumarlo para comparar.
- `exempt`: no aplica IVA.

## Excel o carga manual

La plantilla se descarga en:

```text
/api/template
```

La plantilla usa columnas planas para 3 fuentes:

```text
source_1_name, source_1_price, source_1_currency, source_1_url, source_1_trm, source_1_import_pct
```

Tambien existen columnas equivalentes para fuente 2 y 3.

## Regla para no enganar al usuario

La app separa:

- Total completo: solo si todos los items tienen datos suficientes.
- Parcial evaluable: solo los items con cantidad, costo, techo y oferta.

Si faltan precios, la app permite trabajar, pero no presenta el costo parcial como costo total.

## Como probar rapido

En la pantalla principal:

1. Pulsa `Usar ejemplo`.
2. Pulsa `Importar y abrir calculo`.
3. Debe abrir un calculo llamado `Laboratorio de calculo financiero`.
4. Debe mostrar 8 items.
5. Debe mostrar resumen total pendiente y resumen parcial evaluable.
