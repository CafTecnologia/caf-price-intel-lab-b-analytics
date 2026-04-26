$ErrorActionPreference = "Stop"

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e .[dev,postgres,benchmark,ocr]

if (-not (Test-Path ".env")) {
  Copy-Item .env.example .env
}

.\.venv\Scripts\python.exe scripts\verify_local_dependencies.py

Write-Host ""
Write-Host "Entorno local listo."
Write-Host "API: .\.venv\Scripts\uvicorn procurement_api.main:app --reload --app-dir apps/api/src"
Write-Host "Web: cd apps\web; npm.cmd install; npm.cmd run dev"
