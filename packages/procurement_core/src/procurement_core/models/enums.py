from enum import StrEnum


class ProcessStatus(StrEnum):
    DRAFT = "draft"
    INGESTED = "ingested"
    ANALYZED = "analyzed"
    REVIEW = "review"
    COMPLETED = "completed"
    ERROR = "error"


class DocumentKind(StrEnum):
    UNKNOWN = "unknown"
    INVITATION = "invitation"
    PRIOR_STUDY = "prior_study"
    MARKET_STUDY = "market_study"
    OFFICIAL_BUDGET = "official_budget"
    TECHNICAL_ANNEX = "technical_annex"
    PRICE_LIST = "price_list"
    ECONOMIC_ANNEX = "economic_annex"


class FileType(StrEnum):
    PDF = "pdf"
    WORD = "word"
    EXCEL = "excel"
    IMAGE = "image"
    OTHER = "other"


class ExtractionMethod(StrEnum):
    PDF_TEXT = "pdf_text"
    PDF_TABLE = "pdf_table"
    EXCEL_TABLE = "excel_table"
    WORD_TABLE = "word_table"
    OCR_TESSERACT = "ocr_tesseract"
    RULE_ASSISTED = "rule_assisted"
    MANUAL = "manual"


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IssueType(StrEnum):
    ARITHMETIC_MISMATCH = "arithmetic_mismatch"
    LOW_CONFIDENCE = "low_confidence"
    DUPLICATE = "duplicate"
    AMBIGUOUS_UNIT = "ambiguous_unit"
    COLUMN_SHIFT = "column_shift"
    PRICE_FORMAT = "price_format"
    CONTRADICTION = "contradiction"
    MISSING_REQUIRED = "missing_required"
    OCR_DISAGREEMENT = "ocr_disagreement"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    CORRECTED = "corrected"
    DISCARDED = "discarded"


class AssessmentClassification(StrEnum):
    UNKNOWN = "unknown"
    VIABLE = "viable"
    TIGHT = "tight"
    RISKY = "risky"
    UNVIABLE = "unviable"


class BenchmarkComparability(StrEnum):
    EXACT = "exact"
    STRONG_EQUIVALENT = "strong_equivalent"
    MEDIUM_EQUIVALENT = "medium_equivalent"
    ORIENTATIVE = "orientative"


class ProviderKind(StrEnum):
    OPENAI = "openai"
    OPENAI_COMPATIBLE = "openai_compatible"
    DISABLED = "disabled"


class UserRole(StrEnum):
    ANALYST = "analyst"
    REVIEWER = "reviewer"
    MANAGER = "manager"
    ADMINISTRATOR = "administrator"
