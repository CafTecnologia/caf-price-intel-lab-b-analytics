from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path

from procurement_core.config import get_settings
from procurement_core.models.enums import FileType
from procurement_core.schemas.extraction import FileIngested


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def detect_file_type(file_name: str) -> FileType:
    suffix = Path(file_name).suffix.lower()
    if suffix == ".pdf":
        return FileType.PDF
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        return FileType.EXCEL
    if suffix in {".docx", ".doc"}:
        return FileType.WORD
    if suffix in {".png", ".jpg", ".jpeg", ".tiff", ".bmp"}:
        return FileType.IMAGE
    return FileType.OTHER


class LocalFileStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or get_settings().storage_root
        self.root.mkdir(parents=True, exist_ok=True)

    def save_process_file(self, process_id: str, file_name: str, content: bytes) -> FileIngested:
        file_hash = sha256_bytes(content)
        file_type = detect_file_type(file_name)
        process_dir = self.root / process_id
        process_dir.mkdir(parents=True, exist_ok=True)
        target = process_dir / f"{file_hash}{Path(file_name).suffix.lower()}"
        if not target.exists():
            target.write_bytes(content)
        mime_type = mimetypes.guess_type(file_name)[0]
        return FileIngested(
            file_name=file_name,
            file_hash=file_hash,
            file_type=file_type,
            mime_type=mime_type,
            storage_path=target,
            metadata={"size_bytes": len(content), "stored_name": target.name},
        )

