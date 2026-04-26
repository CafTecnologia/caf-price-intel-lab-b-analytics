from __future__ import annotations

import re
import unicodedata


def normalize_token(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = unicodedata.normalize("NFKD", str(value).strip().lower()).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    return normalized or None


def normalize_item_number(value: str | None) -> str | None:
    token = normalize_token(value)
    if token is None:
        return None
    compact = token.replace("numero", "").replace("item", "").replace("no", "").strip()
    compact = re.sub(r"\s+", "", compact)
    return compact or None


def normalize_lot(value: str | None) -> str | None:
    token = normalize_token(value)
    if token is None:
        return None
    return token.replace("lote", "").strip() or None


def canonicalize_description(description: str | None) -> str | None:
    return normalize_token(description)


def build_canonical_item_key(
    *,
    raw_description: str | None,
    raw_item_number: str | None,
    lot: str | None,
) -> str | None:
    item_number = normalize_item_number(raw_item_number)
    lot_number = normalize_lot(lot)
    description = canonicalize_description(raw_description)

    if item_number:
        return f"item:{item_number}|lot:{lot_number or '-'}"
    if lot_number and description:
        return f"lot:{lot_number}|desc:{description}"
    if description:
        return f"desc:{description}"
    return None


def raw_item_number_from_evidence(evidence: dict | None) -> str | None:
    if not evidence:
        return None
    value = evidence.get("item_number")
    if value is None:
        return None
    return str(value).strip() or None
