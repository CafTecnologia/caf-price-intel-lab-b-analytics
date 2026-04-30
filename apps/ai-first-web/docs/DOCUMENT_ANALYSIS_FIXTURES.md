# Fixtures de analisis documental

Este sistema convierte errores reales de documentos en casos de prueba reutilizables.

## Carpetas

- `tests/fixtures/document_analysis/`: documentos fuente reales o sinteticos.
- `tests/expected/document_analysis/`: expectativas por caso.

## Formato expected.json

```json
{
  "case_id": "lab50_estudio_mercado_20250506",
  "document_name": "lab50_estudio_mercado_20250506.xlsx",
  "expected": {
    "json_valid": true,
    "item_count": { "min": 1 },
    "required_fields": [
      "item",
      "description",
      "technical_description",
      "quantity",
      "fit_analysis",
      "source_1",
      "source_2",
      "source_3",
      "reference_unit",
      "notes"
    ],
    "minimum_field_coverage": {
      "quantity": 0.5,
      "reference_unit": 0.5,
      "technical_description": 0.5
    },
    "expected_items": [
      {
        "item": "1",
        "description": "texto esperado parcial",
        "quantity": "unidad",
        "reference_unit": "1000"
      }
    ],
    "warnings": { "allow": true, "max": 10 }
  }
}
```

## Evaluar un resultado real

Desde `apps/ai-first-web`:

```bash
npm run evaluate:document -- \
  --expected tests/expected/document_analysis/lab50_estudio_mercado_20250506.expected.json \
  --run-id <RUN_ID>
```

Tambien se puede comparar contra un JSON exportado:

```bash
npm run evaluate:document -- \
  --expected tests/expected/document_analysis/lab50_estudio_mercado_20250506.expected.json \
  --actual /ruta/resultado.json
```

## Convertir un fallo en fixture

1. Abre el run fallido o problemático.
2. Copia el `runId`.
3. Ejecuta:

```bash
npm run fixture:from-run -- --run-id <RUN_ID> --case-id caso_descriptivo
```

Eso crea:

- documento en `tests/fixtures/document_analysis/`
- expected inicial en `tests/expected/document_analysis/`
- actual seed para revisar manualmente

Despues ajusta el expected a mano. No busques perfeccion al comienzo: primero captura cantidad de items, campos obligatorios y casos evidentes.

## Score inicial

El evaluador mide:

- JSON valido
- cantidad de items
- campos obligatorios
- cantidades
- precios techo / referencia
- ficha tecnica
- warnings

La meta inicial es detectar regresiones gruesas y repetir errores reales, no certificar exactitud perfecta.
