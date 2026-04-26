from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from procurement_core.config import get_settings
from procurement_core.llm.base import BaseLLMProvider, LLMResult
from procurement_core.models.enums import ProviderKind


@dataclass
class LLMRuntimeConfig:
    provider_name: ProviderKind
    base_url: str
    api_key: str
    model_name: str
    timeout_seconds: int
    max_task_budget_usd: float
    estimated_input_token_price: float
    estimated_output_token_price: float
    extra_headers: dict[str, str] = field(default_factory=dict)


def build_runtime_config_from_settings() -> LLMRuntimeConfig:
    settings = get_settings()
    return LLMRuntimeConfig(
        provider_name=ProviderKind(settings.llm_provider.lower()),
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model_name=settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
        max_task_budget_usd=settings.llm_max_task_budget_usd,
        estimated_input_token_price=settings.llm_estimated_input_token_price,
        estimated_output_token_price=settings.llm_estimated_output_token_price,
    )


class DisabledLLMProvider(BaseLLMProvider):
    provider_kind = ProviderKind.DISABLED

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResult:
        return LLMResult(
            provider=self.provider_kind,
            model="disabled",
            succeeded=False,
            error_message="LLM provider disabled",
        )


class OpenAICompatibleProvider(BaseLLMProvider):
    def __init__(self, runtime_config: LLMRuntimeConfig) -> None:
        self.runtime_config = runtime_config
        self.provider_kind = runtime_config.provider_name

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResult:
        headers = {
            "Authorization": f"Bearer {self.runtime_config.api_key}",
            "Content-Type": "application/json",
        }
        headers.update(self.runtime_config.extra_headers)
        payload = {
            "model": self.runtime_config.model_name,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        estimated_input_tokens = int((len(system_prompt) + len(user_prompt)) / 4)
        estimated_cost = (
            estimated_input_tokens * self.runtime_config.estimated_input_token_price
            + 600 * self.runtime_config.estimated_output_token_price
        )
        if estimated_cost > self.runtime_config.max_task_budget_usd:
            return LLMResult(
                provider=self.provider_kind,
                model=self.runtime_config.model_name,
                succeeded=False,
                estimated_cost_usd=estimated_cost,
                error_message="Task budget exceeded before execution",
            )
        try:
            response = httpx.post(
                f"{self.runtime_config.base_url.rstrip('/')}/chat/completions",
                json=payload,
                headers=headers,
                timeout=self.runtime_config.timeout_seconds,
            )
            response.raise_for_status()
            data = response.json()
            usage = data.get("usage", {})
            return LLMResult(
                provider=self.provider_kind,
                model=self.runtime_config.model_name,
                content=data["choices"][0]["message"]["content"],
                payload=data,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                estimated_cost_usd=estimated_cost,
            )
        except Exception as exc:
            return LLMResult(
                provider=self.provider_kind,
                model=self.runtime_config.model_name,
                succeeded=False,
                estimated_cost_usd=estimated_cost,
                error_message=str(exc),
            )


def get_llm_provider(runtime_config: LLMRuntimeConfig | None = None) -> BaseLLMProvider:
    config = runtime_config or build_runtime_config_from_settings()
    if config.provider_name == ProviderKind.OPENAI:
        return OpenAICompatibleProvider(config)
    if config.provider_name == ProviderKind.OPENAI_COMPATIBLE:
        return OpenAICompatibleProvider(config)
    return DisabledLLMProvider()
