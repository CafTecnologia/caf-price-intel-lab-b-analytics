# Arquitectura

## Vista general

La solucion sigue una arquitectura `local-first` y `LLM-last`. El pipeline intenta resolver todo con extractores locales, reglas duras y revision humana antes de considerar una llamada semantica a LLM.

La separacion principal es:

- `procurement_core`: reglas de negocio, extractores, normalizacion, validacion, scoring y proveedores LLM.
- `procurement_api`: exposicion HTTP, persistencia, autenticacion y orquestacion de jobs.
- `apps/web`: experiencia de auditoria para analistas y revisores.
- `odoo_procurement_analysis`: adaptacion de Odoo 18 sobre el mismo motor.

## Capas obligatorias

### A. Document classifier

Responsabilidades:

- Clasificacion por reglas, keywords y layout.
- Confianza explicita y bandera `requires_llm_review`.
- Nunca usa LLM por defecto si las reglas ya son suficientemente buenas.

### B. Local extraction engine

Responsabilidades:

- Routing por tipo y perfil del documento.
- `ExcelExtractor`: lectura estructurada con `openpyxl`.
- `WordExtractor`: tablas y parrafos con `python-docx`.
- `PDFNativeExtractor`: `pypdf` + `Camelot` + `pdfplumber`.
- `PDFScannedExtractor`: `OCRmyPDF` cuando esta disponible, con fallback OCR local.
- `ImageOCRExtractor`: cadena `PaddleOCR -> Tesseract`.
- Extraccion RAW siempre con trazabilidad a pagina, hoja, fila o rango.

### C. Validation engine

Responsabilidades:

- Reglas duras por item y por proceso.
- Aritmetica, faltantes, baja confianza, duplicados y contradicciones.
- Nunca delega calculo numerico al LLM.

### D. Normalization engine

Responsabilidades:

- Capa derivada, nunca destructiva.
- Identidad canonica por `No. item + lote + descripcion`.
- Priorizacion de fuentes estructuradas.

### E. Exception queue / human review

Responsabilidades:

- Issues auditables con severidad, evidencia y estado.
- Cola de revision humana desacoplada del extractor.

### F. Optional LLM layer

Responsabilidades:

- Clasificacion ambigua.
- Homologacion de descripciones.
- Queries de benchmark y narrativa de riesgo.
- Siempre limitada por presupuesto, timeout y esquema.

### G. Reporting / export layer

Responsabilidades:

- Resumen por proceso, lote e item.
- Exportaciones y trazabilidad hasta la fuente.

## Flujo actual del pipeline

1. El usuario crea un proceso.
2. Sube uno o mas documentos.
3. Se calcula `SHA-256` y se registra metadata.
4. El `LocalExtractionEngine` construye el perfil documental y enruta el extractor local correcto.
5. Se persiste la capa `extracted_item_raw`.
6. Se genera `extracted_item_normalized`, incluyendo clave canonica e identidad de item.
7. Se prioriza una fuente primaria por item y se marcan las corroborativas.
8. El `ValidationEngine` ejecuta reglas por item y por grupo.
9. Solo si hace falta, una capa LLM opcional puede apoyar tareas semanticas.
10. Se genera el assessment financiero y la base para reportes.

## Diseno de integridad

- El texto original se conserva en `raw_description`.
- Cada item RAW guarda archivo, hash, hoja o pagina y evidencia posicional.
- La normalizacion nunca sobrescribe el dato fuente.
- Las correcciones humanas viven en `review_decision`.
- Los prompts y respuestas LLM quedan trazados en `llm_task_log`.

## Estrategia OCR local

- PDF nativo: `pypdf` + `Camelot`, fallback `pdfplumber`.
- PDF escaneado: `OCRmyPDF` si existe, luego OCR local.
- Imagenes: `PaddleOCR` como principal y `Tesseract` como fallback.
- OpenCV queda como capa preparada para preprocesamiento posterior.

## Guardrails LLM

- Proveedor configurable por variables de entorno.
- Respuesta estructurada validada con Pydantic.
- Budget por tarea y por proceso.
- Timeouts, retries acotados y modo `disabled`.
- El motor puede operar sin LLM.
