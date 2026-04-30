# AGENTS - analisis Financiero - B

Contexto rapido para Codex dentro del VPS DEV CAF.

- Proyecto: analisis Financiero - B
- Carpeta real DEV: /opt/caf-dev/repos/caf-price-intel-lab-b-analytics/apps/ai-first-web
- Enfoque: Laboratorio B para analisis de precios. Es el mas trabajado y amplio, pero requiere estabilizacion.
- Regla principal: no tocar produccion ni usar credenciales reales.
- Git: crear ramas de trabajo; no trabajar directo sobre main.
- Antes de editar: explicar archivos a tocar y confirmar si el cambio es delicado.
- Al terminar: resumir cambios, pruebas ejecutadas y riesgos pendientes.

Lee tambien docs/PROJECT_CONTEXT.md antes de proponer trabajo nuevo.
Para cambios de analisis Financiero - B IA-first, lee docs/AI_FIRST_GEMINI_3_1_PRO_STRATEGY.md antes de tocar prompts, proveedor IA o calculos.

## Reglas IA-first

- La evaluacion inicial del documento la hace la IA: mapear, interpretar, extraer, auditar y reparar.
- No reemplazar esa evaluacion por reglas deterministicas locales.
- La app orquesta, guarda estado, maneja errores, valida JSON, reintenta, calcula y muestra resultados.
- Los calculos financieros, ponderaciones, TRM e importacion son responsabilidad de la app.
- Antes de declarar exito, revisar trazabilidad de etapas y correr una prueba real o explicar el bloqueo.

## Diagnostico obligatorio

Cada problema de analisis debe poder clasificarse como:

- Gemini
- prompt
- timeout
- JSON invalido
- schema
- backend
- frontend
- documento mal cargado
- lote/etapa especifica

Usar:

- API estado: /api/market-analysis/<runId>
- API debug: /api/market-analysis/<runId>/debug
- Registrar fixture: POST /api/market-analysis/<runId>/fixture
- Reintentar: POST /api/market-analysis/<runId>/retry
- CLI replay: npm run replay:market -- --run-id <runId>
- CLI archivo: npm run replay:market -- --file <ruta>

## Protocolo UI de resultados

- La pantalla normal del usuario debe mostrar solo notas comerciales/documentales utiles para decidir.
- Los eventos tecnicos completos viven en "Caja negra tecnica", cerrada por defecto.
- No mostrar como notas normales: `STREAM_GEMINI`, modelo efectivo, tokens, auditoria local, fallback interno, errores crudos del proveedor o detalles de etapas.
- Si hay `completed_with_warnings`, la UI debe decir que hay notas de revision, no que el resultado fallo.
- Si hay `partial_review_required`, la UI debe advertir que faltan validaciones o datos importantes.
- Las pruebas E2E deben verificar que la caja negra existe, esta cerrada por defecto y que los mensajes tecnicos no aparecen en el texto visible normal.

## Roles de subagentes para App B

- QA Runner: valida que los warnings tecnicos sigan auditables sin convertirse en mensajes de usuario.
- Backend Quality Gate: mantiene estados honestos (`completed`, `completed_with_warnings`, `partial_review_required`, `failed`) sin ocultar fallas internas.
- Frontend/E2E/Excel: compara backend, UI y XLSX; ademas verifica separacion entre resumen para usuario y caja negra tecnica.
- IA Audit / Prompt: revisa calidad documental y prompt sin convertir logs internos en instrucciones para el usuario final.
- Performance / Test Strategy: cuida tiempos, retries y fallbacks; los detalles de performance deben quedar en caja negra, no en UX principal.
