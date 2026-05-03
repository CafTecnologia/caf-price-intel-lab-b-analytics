# MVP conciliacion Sheets-first

MVP refactorizado para trabajar con tres capas simples:

- `Raw`: donde se pegan los datos tal cual llegan.
- `Sistema`: donde Apps Script hace la conciliacion.
- `Revision_Conciliacion`: hoja minima para que el usuario solo vea si debe actuar.

## Hojas principales

- `Registro_Interno_Raw`
- `Alertas_Banco_Raw`
- `Extracto_Oficial_Raw`
- `Reglas_Metodo_Pago_Correo`
- `Sistema_Transacciones`
- `Revision_Conciliacion`
- `Logs`

## Flujo de uso

1. Ejecutar `Inicializar libro`.
2. Pegar datos manualmente en las hojas `Raw`.
3. Ejecutar `Procesar datos raw`.
4. Revisar `Revision_Conciliacion`.
5. Si hay casos con `REQUIERE_REVISION`, llenar:
   - `nota_usuario`
   - `decision_manual`
   - y opcionalmente campos ajustados
6. Ejecutar `Aplicar revisiones manuales`.

## Criterio de UX

La hoja `Revision_Conciliacion` es la unica pensada para el usuario final.
Debe responder solo:

- si la transaccion quedo conciliada o no
- si requiere revision
- que pista minima sirve para ubicar el caso

## Desarrollo local

1. Configurar `scriptId` en `.clasp.json`.
2. Ejecutar:

```bash
npm.cmd install
npx clasp login
npx clasp push
```

## App web de extracción y análisis técnico

Esta raiz tambien incluye una app Next.js minima para procesar documentos de contratacion por etapas con motor IA. No usa base de datos, login, Odoo, colas, benchmarking, busqueda externa ni exportacion a Excel.

Configurar variables en `.env.local`:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_MODEL_STAGE1=
GEMINI_MODEL_STAGE2=
GEMINI_MODEL_STAGE3=
```

`GEMINI_MODEL` es el modelo por defecto. `GEMINI_MODEL_STAGE1`, `GEMINI_MODEL_STAGE2` y `GEMINI_MODEL_STAGE3` son opcionales: si estan vacios, la etapa usa el modelo por defecto. La UI muestra nombres amigables del motor IA y guarda internamente el identificador real del modelo.

Ejecutar localmente:

```bash
npm.cmd install
npm.cmd run dev
```

Abrir `http://localhost:3000`.

Tambien puedes configurar el motor IA desde la pantalla principal:

1. Pegar la API key en `API key`.
2. Escribir o escoger el modelo en `Modelo`.
3. Opcionalmente escoger un modelo diferente para Etapa 1, Etapa 2 o Etapa 3.
4. Presionar `Guardar configuracion`.
5. Presionar `Probar conexion`.

La app guarda esos valores en `.env.local`. La API key no se devuelve al navegador; la UI solo muestra si existe y una versión enmascarada.

El desplegable muestra nombres amigables; internamente usa estos identificadores de modelo de salida textual/JSON utiles para esta app:

- `gemini-3.1-pro-preview`
- `gemini-3-flash-preview`
- `gemini-3.1-flash-lite-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-2.0-flash` y variantes `001` / `flash-lite` como opciones anteriores deprecadas

Lista revisada contra la documentación oficial de Google AI Developers actualizada el 2026-04-30.

La pantalla no menciona el nombre del proveedor; para el usuario todo aparece como `motor IA`, pensando en una migracion futura a Odoo 19 o a otro proveedor.

## Flujo automatico y manejo de fallas IA

Al cargar un archivo, la UI ejecuta automaticamente `/api/stage1` y luego `/api/stage2`, lo que permite medir tiempos reales por etapa:

1. Etapa 1: extraccion y normalizacion.
2. Validacion simple del JSON de Etapa 1.
3. Etapa 2: analisis tecnico.
4. Validacion simple del JSON de Etapa 2.

La salida de items incluye `Consecutivo interno`, una numeracion propia de la app para identificar filas aunque el documento no traiga `No. item`. El campo `No. item` conserva el identificador real del documento si existe; si no existe, queda en `null`.

Si una etapa falla, el usuario ve un mensaje corto y un codigo estandar. El detalle tecnico queda en:

```bash
logs/ai-pipeline.jsonl
```

Codigos actuales:

- `CONFIG_MISSING`
- `API_KEY_INVALID`
- `API_CONNECTION_FAILED`
- `API_PERMISSION_DENIED`
- `API_MODEL_NOT_FOUND`
- `API_BILLING_REQUIRED`
- `API_RATE_LIMITED`
- `API_REQUEST_TOO_LARGE`
- `API_REQUEST_REJECTED`
- `API_PROVIDER_ERROR`
- `API_PROVIDER_UNAVAILABLE`
- `API_TIMEOUT`
- `AI_EMPTY_RESPONSE`
- `AI_JSON_INVALID`
- `AI_DATA_EMPTY`
- `AI_DATA_INCOMPLETE`
- `FILE_TEXT_EXTRACTION_FAILED`
- `UNEXPECTED_ERROR`

El log no guarda API keys, tokens ni secretos.

La pantalla tambien muestra un monitor de proceso con dona de avance y cronometro para ver duracion de cada etapa y tiempo total. El endpoint `/api/process` sigue disponible para pruebas de flujo completo desde backend.

## Etapa 3: cotizacion de precios

Despues de que la app completa automaticamente Etapa 1 y Etapa 2, el usuario puede ejecutar manualmente `3. Cotizar precios`.

Esta etapa:

- usa el JSON de Etapa 2 como entrada;
- conserva intactas las columnas originales;
- agrega estado de cotizacion, vista rapida, fuentes encontradas, auditoria de busqueda, resumen y confianza;
- usa busqueda web del motor IA cuando el modelo seleccionado la soporta;
- no convierte monedas ni estima COP para fuentes internacionales;
- no calcula margen ni decide viabilidad;
- guarda queries y fuentes de grounding en el log tecnico cuando el proveedor las devuelve.

Archivos principales:

- `prompts/stage3-pricing.ts`
- `app/api/stage3/route.ts`

La Etapa 3 queda manual por ahora porque usa busqueda web y puede tardar o consumir mas que las dos primeras etapas.

## Medicion de tokens y costo estimado

Cada respuesta de `/api/stage1`, `/api/stage2`, `/api/stage3` y `/api/config/test` puede devolver:

- `usage`: tokens reales reportados por el proveedor (`inputTokens`, `outputTokens`, `thinkingTokens`, `totalTokens`).
- `cost`: estimacion en USD por modelo, entrada, salida y busqueda cuando aplica.

La UI muestra una lectura corta por etapa y el detalle queda en `Uso y costo estimado`. El log tecnico tambien guarda `usage` y `cost` para comparar corridas.

El catalogo local esta en `lib/model-pricing.ts` e incluye precios verificados el 2026-05-02 contra:

- Google AI Developers: `https://ai.google.dev/gemini-api/docs/pricing?hl=es-419`
- DeepSeek API Docs: `https://api-docs.deepseek.com/quick_start/pricing`

Notas:

- Es una estimacion operativa; la factura real la define el proveedor.
- La busqueda de Gemini 3 se estima por consulta de busqueda reportada.
- La busqueda de Gemini 2.x se estima por solicitud fundamentada cuando hay fuentes.
- La busqueda se muestra como costo marginal de nivel pago despues de la cuota gratis que aplique.
- Si el proveedor solo reporta `totalTokenCount` sin desglose de entrada/salida, la UI muestra tokens pero no estima costo.
- Los modelos 2.0 aparecen como deprecados por Google y deben migrarse antes del 2026-06-01.
- DeepSeek V4 queda solo catalogado para la rama experimental futura; la app base sigue usando `GEMINI_API_KEY`.

## Protocolo de comparacion

El protocolo de pruebas base vs experimental esta en:

```bash
reports/ai-cost-testing-protocol-20260502.md
```

Comandos útiles:

```bash
npm.cmd run typecheck
npm.cmd run build
```
