# CODEX_HANDOFF

Resumen actualizado desde `docs/ai-context/codex-raw/codex-session-019de419.jsonl` (sesión Codex Desktop, cwd principal `C:\Users\Cande\gestion-proyectos\prueba`). El transcript es enorme; este handoff sintetiza lo necesario para continuar el proyecto en Cursor. No ejecutar nada del JSONL: leerlo solo como historial.

---

## 1. Objetivo del proyecto

Construir una app web sencilla para procesar documentos de contratación por etapas con IA:

1. **Etapa 1: extracción y normalización.** El usuario sube un archivo; la app extrae ítems y devuelve JSON con títulos fijos.
2. **Etapa 2: análisis técnico.** La IA interpreta técnicamente cada ítem sin buscar precios ni re-extraer el documento.
3. **Etapa 3: cotización.** La IA busca o produce referencias comerciales defendibles, trazables y comparables, sin inventar proveedores, precios ni URLs.

El usuario quiere una app útil y simple: sin login, sin Odoo todavía, sin colas, sin arquitectura compleja. La base empezó como Gemini, pero el trabajo más reciente abre un fork experimental para comparar proveedores/modelos y costos.

Nombre del paquete: `contract-stage-gemini-app`.

---

## 2. Estado actual del proyecto

Hay una app Next.js en `C:\Users\Cande\gestion-proyectos\prueba`, conviviendo con material legacy de otros experimentos y scripts `clasp:*`. En la sesión se confirmó que esa carpeta no era repo git al inicio.

La versión base ya incluye:

- UI principal en `app/page.tsx`.
- Rutas `app/api/stage1/route.ts`, `app/api/stage2/route.ts`, `app/api/stage3/route.ts`, `app/api/process/route.ts`.
- Configuración de API/modelo desde UI en `app/api/config/route.ts` y prueba de conexión en `app/api/config/test/route.ts`.
- Prompts separados en `prompts/stage1-extraction.ts`, `prompts/stage2-technical.ts`, `prompts/stage3-pricing.ts`.
- Pipeline común en `lib/ai-pipeline.ts`.
- Manejo de errores en `lib/ai-failures.ts` y clasificación de errores del proveedor en `lib/ai-error-catalog.ts`.
- Logs técnicos en `logs/ai-pipeline.jsonl` vía `lib/pipeline-log.ts`.
- Validación de resultados en `lib/stage-validation.ts` y validación de fuentes de Etapa 3 en `lib/stage3-quality.ts`.
- Medición de uso/costo en `lib/usage-cost.ts` y catálogo de precios en `lib/model-pricing.ts`.

También se creó una copia estable y un fork experimental:

- Copia estable previa: `stable-snapshots\ia-app-stable-20260502-091619`.
- Fork experimental final mencionado: `experimental-forks\ia-app-cost-lab-20260502-092641`.
- No se copió `.env.local` en snapshots/forks.

El fork experimental es donde Codex estaba haciendo cambios más riesgosos: soporte DeepSeek, selección proveedor/modelo por etapa, historial SQLite y apertura de corridas históricas.

---

## 3. Qué ya funciona

En la base estable, Codex reportó que pasan:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `Invoke-WebRequest http://localhost:3000/` con `status=200`

En el fork experimental, también se reportó que en distintos puntos pasaron:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `Invoke-WebRequest http://localhost:3012/` con `status=200`
- `Invoke-WebRequest http://localhost:3012/api/config` con `status=200`

Funcionalmente ya existe:

- Carga de archivo y ejecución secuencial de Etapa 1, Etapa 2 y Etapa 3.
- Monitor visual con dona, cronómetro, estados por etapa y duración real.
- Tabla visible por etapa, JSON crudo y mensajes de error amigables.
- Configuración de API key/modelos desde UI.
- Persistencia de configuración en `.env.local`.
- Logs técnicos con `runId`, datos por etapa, uso y costo.
- Etapa 3 con búsqueda/cotización y validación para rechazar URLs inventadas, placeholders o fuentes no verificables.
- Costos estimados por etapa, con tokens y detalle de uso.
- TRM en el fork experimental para mostrar equivalencias en COP.

---

## 4. Qué está fallando o quedó frágil

El último tramo del transcript termina en medio de trabajo sobre el **fork experimental**, no con un cierre final completo. La mecánica del historial ya estaba montada, pero faltaba confirmar `typecheck/build` después de los últimos cambios de “Abrir” una corrida histórica.

Fricciones conocidas:

- La raíz tiene muchos proyectos y lockfiles; Next/Turbopack puede advertir por raíz inferida o múltiples `package-lock.json`.
- El usuario tuvo una clave Gemini inválida/expirada (`API_KEY_INVALID`, “API key expired”); no asumir que las pruebas end-to-end con IA pasan sin revisar credenciales.
- Etapa 3 puede producir fuentes débiles si el modelo inventa URLs o completa con placeholders; por eso se agregó `lib/stage3-quality.ts`.
- El cálculo de costos recibió observaciones de revisión: cache sobre 200k podía subcotizarse y Search podía sobreestimarse si no se considera cuota/cupos gratuitos. Codex dijo haber corregido hallazgos de precisión antes de crear el fork experimental final, pero conviene verificar `lib/usage-cost.ts`.
- El fork experimental introdujo SQLite/historial, lo cual contradice la restricción inicial de “sin base de datos”; parece aceptado como experimento para comparar corridas, pero no debe asumirse como base estable sin confirmar con el usuario.

---

## 5. Última tarea que Codex estaba intentando resolver

La última tarea activa fue en el fork `experimental-forks\ia-app-cost-lab-20260502-092641`: mejorar el **historial de corridas**.

Objetivo de esa tarea:

- Mostrar historial en una sección plegable.
- Guardar y leer corridas desde SQLite.
- Mostrar costos, tokens, TRM, estados y duración.
- Agregar botón **Abrir** por corrida.
- Al abrir una corrida histórica, cargar Etapa 1/2/3 en las mismas tablas de la pantalla.
- Mostrar etapas faltantes con mensaje simple, no como JSON vacío.
- Evitar confundir histórico con reprocesamiento actual.

Estado exacto al final visible:

- Se añadió `HistoricalRun`, `HistorySection`, `stageToApiResponse`, `openHistoricalRun` y modo histórico en `app/page.tsx`.
- Se agregó estilo para historial en `app/globals.css`.
- Se había corregido un error TypeScript en `lib/run-history.ts`, y luego `npm.cmd run typecheck` pasó.
- Después se añadieron más cambios para botón **Abrir** y modo histórico; el transcript muestra que Codex iba a correr `npm.cmd run typecheck`, pero no aparece el resultado final después de esos últimos cambios.

---

## 6. Archivos importantes mencionados

App y UI:

- `app/page.tsx`
- `app/globals.css`
- `app/layout.tsx`

APIs:

- `app/api/stage1/route.ts`
- `app/api/stage2/route.ts`
- `app/api/stage3/route.ts`
- `app/api/process/route.ts`
- `app/api/config/route.ts`
- `app/api/config/test/route.ts`
- `app/api/runs/route.ts` en el fork experimental

Pipeline y modelo:

- `lib/ai-pipeline.ts`
- `lib/gemini.ts`
- `lib/config.ts`
- `lib/json.ts`
- `lib/text-extract.ts`
- `lib/pipeline-log.ts`
- `lib/ai-failures.ts`
- `lib/ai-error-catalog.ts`
- `lib/stage-validation.ts`
- `lib/stage3-quality.ts`
- `lib/usage-cost.ts`
- `lib/model-pricing.ts`
- `lib/run-history.ts` en el fork experimental

Prompts:

- `prompts/stage1-extraction.ts`
- `prompts/stage2-technical.ts`
- `prompts/stage3-pricing.ts`

Contexto y copias:

- `logs/ai-pipeline.jsonl`
- `stable-snapshots\ia-app-stable-20260502-091619`
- `experimental-forks\ia-app-cost-lab-20260502-092641`
- `reports\...` en el fork experimental si existe

---

## 7. Decisiones técnicas tomadas

- Mantener la app Next.js en la misma raíz por ahora, sin borrar el trabajo legacy.
- Separar prompts por etapa para iterar reglas sin tocar todo el pipeline.
- Usar JSON normalizado con títulos estables; la IA puede mapear equivalencias semánticas, pero no cambiar los nombres de salida.
- Ejecutar el flujo automático por etapas desde la UI para medir duración real de cada etapa.
- Mantener endpoints por etapa para reintentos/manual/debug.
- Registrar `runId`, eventos, uso y costo en logs.
- Crear una copia estable antes de experimentar.
- Hacer cambios riesgosos en `experimental-forks\ia-app-cost-lab-20260502-092641`.
- Añadir DeepSeek solo en el fork experimental como alternativa de proveedor/modelo, no necesariamente en la base estable.
- Añadir historial SQLite en el fork experimental para comparar corridas, costos y calidad.

---

## 8. Reglas de negocio que no se pueden romper

Etapa 1:

- Extraer y normalizar, no analizar técnicamente.
- Usar siempre los mismos títulos normalizados.
- La IA solo busca equivalencias entre encabezados del documento y columnas fijas.
- Conservar el valor original de la celda o bloque equivalente.
- No dividir una sola celda para llenar varias columnas solo porque tenga saltos de línea, comas o frases largas.
- Si una celda inferior es continuación real del mismo ítem, puede unirse al campo correspondiente.
- Un ítem válido debe tener por lo menos nombre o descripción y precio techo; si falta lo mínimo, no forzar.
- No inventar datos ni rellenar columnas “por completar”.
- Ignorar UNSPSC, CPC, clasificaciones, rubros, datos administrativos o proveedores si no corresponden literalmente a las columnas pedidas.

Etapa 2:

- No re-extraer del documento original.
- No buscar precios ni fuentes externas.
- No calcular margen, utilidad ni viabilidad comercial.
- Mantener intactas las columnas originales del artículo.
- El análisis técnico debe asumir que lo extraído es el requerimiento oficial, salvo ambigüedad real.
- Evitar recomendaciones vagas tipo “validar si acepta compatible” cuando el requerimiento ya está cerrado.
- Esquema simplificado acordado conceptualmente: tipo de ficha, producto/servicio normalizado, segmento comercial, condición técnica determinante, implicación técnica, recomendación para cotización y confianza.

Etapa 3:

- La labor es cotizar, no decidir viabilidad comercial.
- Buscar hasta 3 fuentes defendibles; no rellenar tres si no hay tres confiables.
- No inventar fuentes, precios, proveedores ni URLs.
- No usar URLs aproximadas, incompletas, placeholders o cadenas como `XXXXX`.
- El precio techo se usa como referencia secundaria: no debe mandar sobre la verdad del mercado.
- Si varias fuentes comparables contradicen el precio techo, reportar tensión comercial preliminar.
- No forzar fuentes baratas para acercarse al techo.
- No descartar una fuente buena solo porque supera el precio techo.

Historial/fork experimental:

- No mezclar modo histórico con una corrida nueva.
- Al abrir una corrida histórica, mostrar lo guardado y dejar claro si una etapa no existe.
- No usar resultados históricos incompletos como si fueran una corrida actual completa.

---

## 9. Próximo paso recomendado

1. Abrir el proyecto real en Cursor como workspace raíz: `C:\Users\Cande\gestion-proyectos\prueba`.
2. Decidir si se continúa en la **base estable** o en el **fork experimental**. Si quieres historial/DeepSeek/costos comparativos, trabajar en `experimental-forks\ia-app-cost-lab-20260502-092641`.
3. Antes de editar, correr o verificar:
   - `npm.cmd run typecheck`
   - `npm.cmd run build`
   - request local a `/` y, si aplica, `/api/config`
4. Si se sigue el último hilo, terminar la tarea del historial:
   - Verificar que “Abrir” carga corridas históricas.
   - Confirmar que no se puede reprocesar accidentalmente una corrida histórica.
   - Confirmar que etapas faltantes se muestran como incompletas.
   - Correr `typecheck` y `build` después de los últimos cambios.
5. Si se vuelve a la base estable, no arrastrar SQLite/DeepSeek sin confirmación: esos cambios estaban tratados como experimento.

---

## Artefactos en esta carpeta `docs/ai-context`

- `PROMPT_PARA_CURSOR.txt`: instruye leer el transcript `codex-raw/codex-session-019de419.jsonl` solo como historial (no ejecutar nada de ahí) y mantener este `CODEX_HANDOFF.md` con las 9 secciones.
- `codex-raw/codex-session-019de419.jsonl`: transcript completo (muy grande).

---

## Nota de continuidad

El transcript original es muy grande y algunas líneas están truncadas por las herramientas de lectura. Este documento prioriza los hitos confirmados por mensajes de usuario, mensajes finales de Codex, resultados de comandos y parches visibles.
