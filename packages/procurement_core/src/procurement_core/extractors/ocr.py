from __future__ import annotations

import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from decimal import Decimal
from pathlib import Path

from procurement_core.schemas.extraction import PageExtraction

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None

try:
    import pytesseract
except Exception:  # pragma: no cover
    pytesseract = None

try:
    from paddleocr import PaddleOCR
except Exception:  # pragma: no cover
    PaddleOCR = None


class OCRResult(PageExtraction):
    confidence: Decimal | None = None
    provider_name: str
    succeeded: bool = False


class OCRProvider(ABC):
    provider_name: str

    @abstractmethod
    def is_available(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def run(self, file_path: Path) -> OCRResult:
        raise NotImplementedError


class PaddleOCRProvider(OCRProvider):
    provider_name = "paddleocr"

    def is_available(self) -> bool:
        return PaddleOCR is not None

    def run(self, file_path: Path) -> OCRResult:
        if not self.is_available():
            return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": "paddleocr not installed"})
        try:
            ocr = PaddleOCR(use_angle_cls=True, lang="es", show_log=False)
            result = ocr.ocr(str(file_path), cls=True)
        except Exception as exc:  # pragma: no cover
            return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": str(exc)})
        lines: list[str] = []
        confidences: list[float] = []
        for page in result:
            for line in page or []:
                text = line[1][0] if len(line) > 1 and line[1] else ""
                score = float(line[1][1]) if len(line) > 1 and line[1] else 0.0
                if text:
                    lines.append(text)
                    confidences.append(score)
        confidence = Decimal(str(sum(confidences) / len(confidences))) if confidences else None
        return OCRResult(
            provider_name=self.provider_name,
            succeeded=bool(lines),
            extracted_text="\n".join(lines) or None,
            confidence=confidence,
            metadata={"line_count": len(lines)},
        )


class TesseractOCRProvider(OCRProvider):
    provider_name = "tesseract"

    def is_available(self) -> bool:
        return pytesseract is not None and Image is not None and shutil.which("tesseract") is not None

    def run(self, file_path: Path) -> OCRResult:
        if not self.is_available():
            return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": "tesseract not available"})
        try:
            image = Image.open(file_path)
            text = pytesseract.image_to_string(image, lang="spa+eng")
        except Exception as exc:  # pragma: no cover
            return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": str(exc)})
        return OCRResult(
            provider_name=self.provider_name,
            succeeded=bool(text.strip()),
            extracted_text=text or None,
            confidence=Decimal("0.55") if text.strip() else None,
            metadata={"mode": "image_to_string"},
        )


class OCRmyPDFProvider(OCRProvider):
    provider_name = "ocrmypdf"

    def is_available(self) -> bool:
        return shutil.which("ocrmypdf") is not None

    def run(self, file_path: Path) -> OCRResult:
        if not self.is_available():
            return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": "ocrmypdf not installed"})
        with tempfile.TemporaryDirectory() as tmpdir:
            output_pdf = Path(tmpdir) / "searchable.pdf"
            sidecar = Path(tmpdir) / "sidecar.txt"
            command = [
                "ocrmypdf",
                "--skip-text",
                "--force-ocr",
                "--sidecar",
                str(sidecar),
                str(file_path),
                str(output_pdf),
            ]
            try:
                completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=180)
            except Exception as exc:  # pragma: no cover
                return OCRResult(provider_name=self.provider_name, succeeded=False, metadata={"warning": str(exc)})
            text = sidecar.read_text(encoding="utf-8", errors="ignore") if sidecar.exists() else ""
            succeeded = completed.returncode == 0 and bool(text.strip())
            return OCRResult(
                provider_name=self.provider_name,
                succeeded=succeeded,
                extracted_text=text or None,
                confidence=Decimal("0.72") if succeeded else None,
                metadata={
                    "returncode": completed.returncode,
                    "stdout": completed.stdout[-500:],
                    "stderr": completed.stderr[-500:],
                    "searchable_pdf": str(output_pdf) if output_pdf.exists() else None,
                },
            )


class LocalOCRChain:
    def __init__(self, providers: list[OCRProvider] | None = None) -> None:
        self.providers = providers or [PaddleOCRProvider(), TesseractOCRProvider()]

    def run(self, file_path: Path) -> OCRResult:
        attempts: list[dict[str, object]] = []
        best_result: OCRResult | None = None

        for provider in self.providers:
            if not provider.is_available():
                attempts.append({"provider": provider.provider_name, "status": "unavailable"})
                continue
            try:
                result = provider.run(file_path)
            except Exception as exc:  # pragma: no cover
                attempts.append({"provider": provider.provider_name, "status": "error", "error": str(exc)})
                continue
            attempts.append(
                {
                    "provider": provider.provider_name,
                    "succeeded": result.succeeded,
                    "confidence": str(result.confidence) if result.confidence is not None else None,
                }
            )
            if result.succeeded and (best_result is None or (result.confidence or Decimal("0")) > (best_result.confidence or Decimal("0"))):
                best_result = result

        if best_result is None:
            return OCRResult(provider_name="none", succeeded=False, metadata={"attempts": attempts})

        best_result.metadata = dict(best_result.metadata or {})
        best_result.metadata["attempts"] = attempts
        return best_result
