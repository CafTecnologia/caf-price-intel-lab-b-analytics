from __future__ import annotations

import importlib
import shutil
import sys


PYTHON_IMPORTS = {
    "openpyxl": "Excel extraction",
    "pdfplumber": "PDF layout extraction",
    "pypdf": "PDF text extraction",
    "docx": "Word extraction",
    "cv2": "Image preprocessing",
    "pytesseract": "Tesseract OCR bridge",
}

BINARY_DEPENDENCIES = {
    "tesseract": "OCR fallback",
    "ocrmypdf": "Searchable scanned PDF preprocessing",
    "gswin64c": "Ghostscript on Windows for OCR/table stack",
    "gs": "Ghostscript on Linux/macOS for OCR/table stack",
}


def main() -> int:
    print("Verificacion local de dependencias")
    print("-" * 40)
    failed = False

    for module_name, purpose in PYTHON_IMPORTS.items():
        try:
            importlib.import_module(module_name)
            print(f"[OK] Python module '{module_name}' disponible: {purpose}")
        except Exception:
            failed = True
            print(f"[WARN] Python module '{module_name}' no disponible: {purpose}")

    for binary_name, purpose in BINARY_DEPENDENCIES.items():
        if shutil.which(binary_name):
            print(f"[OK] Binario '{binary_name}' disponible: {purpose}")
        else:
            print(f"[WARN] Binario '{binary_name}' no encontrado: {purpose}")

    if failed:
        print("\nHay dependencias opcionales faltantes. El motor seguira funcionando, pero con rutas de fallback y mas revisiones humanas.")
    else:
        print("\nDependencias Python principales disponibles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
