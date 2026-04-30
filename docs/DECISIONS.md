# Decisions - Lab B - Analytics

Registrar aqui decisiones tecnicas importantes, con fecha y razon.

## 2026-04-28 - App B IA-first con Gemini

- Decision: App B conserva el enfoque IA-first, pero separa interpretacion IA, validacion/auditoria y calculos deterministas de la app.
- Razon: la documentacion de Gemini 3.1 Pro Preview permite contexto largo, PDF, salida estructurada, cache y herramientas, pero Google advierte que recuperar muchas piezas dentro de contexto largo requiere validacion y diseno de pipeline.
- Guia: docs/AI_FIRST_GEMINI_3_1_PRO_STRATEGY.md

## 2026-04-28 - Promocion DEV PDF nativo Gemini

- Decision: Promover a App B DEV la ruta de PDF nativo con Gemini File API, conteo de tokens, prompt compacto y schema con descripciones.
- Prueba: PDF real de ferreteria devolvio 192/192 filas con `gemini-3.1-pro-preview`, sin warnings, y redujo tokens de entrada frente al baseline de 18.209 a 5.470.
- Prueba adicional: Excel pequeño devolvio 4 filas sin warnings.
- Limite: la auditoria de cobertura sigue siendo basica; falta fase IA dedicada de mapa/auditoria.

## 2026-04-30 - Separacion UX entre notas y caja negra

- Decision: La vista normal de App B muestra solo notas comerciales/documentales utiles para el usuario. La trazabilidad completa de IA, etapas, tokens, fallback, errores crudos y auditorias internas queda en una "Caja negra tecnica" cerrada por defecto.
- Razon: Los logs son valiosos para mejora continua y soporte, pero confunden al usuario cuando se mezclan con el resultado de negocio.
- Prueba esperada: E2E debe verificar que la caja negra existe y esta cerrada por defecto, y que mensajes como `STREAM_GEMINI`, modelo efectivo, conteo de tokens o auditoria local no aparecen en el texto visible normal.
