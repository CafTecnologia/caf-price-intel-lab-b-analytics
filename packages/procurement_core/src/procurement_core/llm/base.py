from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel

from procurement_core.models.enums import ProviderKind


class LLMResult(BaseModel):
    provider: ProviderKind
    model: str
    content: str | None = None
    payload: dict | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    estimated_cost_usd: float = 0.0
    succeeded: bool = True
    error_message: str | None = None


class BaseLLMProvider(ABC):
    provider_kind: ProviderKind

    @abstractmethod
    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResult:
        raise NotImplementedError

