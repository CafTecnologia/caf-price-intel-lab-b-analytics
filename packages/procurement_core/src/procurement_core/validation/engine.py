from __future__ import annotations

from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw
from procurement_core.validation.base import ValidationContext, ValidationRule
from procurement_core.validation.rules import build_default_rules


class ValidationEngine:
    def __init__(self, rules: list[ValidationRule] | None = None) -> None:
        self.rules = rules or build_default_rules()

    def evaluate_process(
        self,
        items: list[tuple[ExtractedItemRaw, ExtractedItemNormalized]],
    ) -> dict[str, list[dict[str, object]]]:
        by_key: dict[str, list[tuple[ExtractedItemRaw, ExtractedItemNormalized]]] = {}
        for raw_item, normalized_item in items:
            key = normalized_item.canonical_item_key or f"raw:{raw_item.id}"
            by_key.setdefault(key, []).append((raw_item, normalized_item))

        issues_by_raw_id: dict[str, list[dict[str, object]]] = {}
        for key, siblings in by_key.items():
            context = ValidationContext(siblings=siblings)
            for raw_item, normalized_item in siblings:
                issues = issues_by_raw_id.setdefault(raw_item.id, [])
                for rule in self.rules:
                    issues.extend(rule.evaluate(raw_item, normalized_item, context))
        return issues_by_raw_id
