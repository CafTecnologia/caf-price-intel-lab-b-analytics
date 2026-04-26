# Procurement Analytics Monorepo

Plataforma auditable para analisis documental, benchmark y viabilidad financiera de procesos de contratacion publica en Colombia.

## Objetivo

La solucion corre de dos maneras usando el mismo motor de negocio:

- `apps/api` + `apps/web`: web app standalone con FastAPI, React, PostgreSQL y Celery.
- `addons/odoo_procurement_analysis`: addon Odoo 18 que reutiliza `procurement_core`.

## Principios de diseno

- Integridad documental antes que automatizacion agresiva.
- Arquitectura `local-first` y `LLM-last`.
- Capa RAW inmutable y trazable.
- El LLM nunca es la fuente final para cifras.
- OCR y parsing corren localmente o en infraestructura propia.
- Odoo es una capa adaptadora, no una reimplementacion.

## Estructura

```text
procurement-analytics/
|- apps/
|  |- api/                      FastAPI + Celery + Alembic
|  `- web/                      React + Vite
|- packages/
|  `- procurement_core/         Motor reusable de negocio
|- addons/
|  `- odoo_procurement_analysis/ Addon Odoo 18
|- demo/                        Seeds y ejemplo end-to-end
|- docs/                        Arquitectura y guias
|- infra/docker/                Dockerfiles
|- scripts/                     Setup y verificacion local
`- tests/                       Unit + integration
```

## Arquitectura local-first

- `Document classifier`: reglas locales primero, LLM solo si queda incierto.
- `Local extraction engine`: `ExcelExtractor`, `WordExtractor`, `PDFNativeExtractor`, `PDFScannedExtractor`, OCR local y fallback por tablas.
- `Validation engine`: reglas duras por item y por proceso.
- `Normalization engine`: capa derivada, con identidad canonica por `No. item + lote + descripcion`.
- `Exception queue`: incidencias auditables y revision humana.
- `Optional LLM layer`: solo para tareas semanticas y ambiguas.
- `Reporting/export`: base lista para reportes, benchmark y assessment.

## Estado actual del core

- Deduplicacion mas robusta por `No. item`, lote y descripcion.
- Seleccion de fuente primaria estructurada sin bloquear por fuentes corroborativas ruidosas.
- Routing local para PDF nativo vs escaneado.
- Fallback `Camelot -> pdfplumber` para tablas.
- OCR local con cadena `OCRmyPDF -> PaddleOCR -> Tesseract` cuando esta disponible.
- Motor de validacion clase por clase, sin delegar aritmetica a IA.
- Tests unitarios e integracion para identidad, extraccion Excel y priorizacion de fuentes.

## Arranque rapido

1. Crear entorno virtual e instalar dependencias:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -e .[dev,postgres,benchmark,ocr]
.\.venv\Scripts\python scripts\verify_local_dependencies.py
```

Tambien puedes usar:

```powershell
.\scripts\setup_local.ps1
```

2. Copiar variables:

```powershell
Copy-Item .env.example .env
```

3. Levantar stack con Docker:

```powershell
docker compose up --build
```

4. Cargar demo:

```powershell
.\.venv\Scripts\python demo\seed_demo.py
```

## Documentacion

- Arquitectura: [docs/architecture.md](docs/architecture.md)
- Instalacion: [docs/installation.md](docs/installation.md)
- Roadmap por fases: [docs/roadmap.md](docs/roadmap.md)
