# Instalacion

## Requisitos

- Python 3.12+
- Node.js 20+
- Docker Desktop
- PostgreSQL y Redis si no se usa Docker
- Tesseract OCR opcional
- OCRmyPDF opcional para PDF escaneado
- Ghostscript recomendado para stack OCR/PDF

## Local sin Docker

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -e .[dev,postgres,benchmark,ocr]
Copy-Item .env.example .env
.\.venv\Scripts\python scripts\verify_local_dependencies.py
```

Tambien puedes usar:

```powershell
.\scripts\setup_local.ps1
```

En Linux:

```bash
chmod +x scripts/setup_local.sh
./scripts/setup_local.sh
```

Backend:

```powershell
.\.venv\Scripts\uvicorn procurement_api.main:app --reload --app-dir apps/api/src
```

Worker:

```powershell
.\.venv\Scripts\celery -A procurement_api.worker.celery_app worker --loglevel=INFO
```

Frontend:

```powershell
cd apps\web
npm.cmd install
npm.cmd run dev
```

## Docker

```powershell
docker compose up --build
```

## Odoo

Agregar `addons/odoo_procurement_analysis` a `addons_path` y asegurar que el entorno Python de Odoo pueda importar `packages/procurement_core/src`.

## Notas de confiabilidad

- Si falta `Camelot`, el sistema cae a `pdfplumber`.
- Si falta `OCRmyPDF`, los PDF escaneados pasan a OCR local o a revision humana.
- Si faltan motores OCR, el sistema no inventa datos: conserva evidencia y genera excepciones.
