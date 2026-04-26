#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev,postgres,benchmark,ocr]'

if [ ! -f .env ]; then
  cp .env.example .env
fi

python scripts/verify_local_dependencies.py

echo
echo "Entorno local listo."
echo "API: .venv/bin/uvicorn procurement_api.main:app --reload --app-dir apps/api/src"
echo "Web: cd apps/web && npm install && npm run dev"
