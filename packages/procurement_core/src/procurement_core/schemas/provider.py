from __future__ import annotations

from pydantic import Field

from procurement_core.models.enums import ProviderKind
from procurement_core.schemas.common import JsonDict, ProcurementBaseModel, TimestampedRead


class ProviderConfigUpsert(ProcurementBaseModel):
    provider_name: ProviderKind = ProviderKind.DISABLED
    base_url: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    enabled: bool = True
    timeout_seconds: int = 30
    max_task_budget_usd: float = 2.5
    max_process_budget_usd: float = 20.0
    estimated_input_token_price: float = 0.0000005
    estimated_output_token_price: float = 0.0000015
    extra_headers: JsonDict = Field(default_factory=dict)


class ProviderConfigRead(TimestampedRead):
    provider_name: ProviderKind
    base_url: str | None
    model_name: str | None
    enabled: bool
    has_api_key: bool
    api_key_masked: str | None
    config_json: JsonDict = Field(default_factory=dict)


class LLMConnectionTestRequest(ProcurementBaseModel):
    config: ProviderConfigUpsert
    prompt: str = "Responde un JSON valido con {\"status\": \"ok\"}."


class LLMConnectionTestResult(ProcurementBaseModel):
    provider_name: ProviderKind
    model_name: str
    succeeded: bool
    estimated_cost_usd: float = 0.0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    content_preview: str | None = None
    error_message: str | None = None

