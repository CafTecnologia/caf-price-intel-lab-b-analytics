from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw


IssuePayload = dict[str, object]


@dataclass(slots=True)
class ValidationContext:
    siblings: list[tuple[ExtractedItemRaw, ExtractedItemNormalized]] = field(default_factory=list)


class ValidationRule(ABC):
    rule_name: str

    @abstractmethod
    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[IssuePayload]:
        raise NotImplementedError
