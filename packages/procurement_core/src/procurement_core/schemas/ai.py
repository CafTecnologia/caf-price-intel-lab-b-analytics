from __future__ import annotations

from pydantic import Field

from procurement_core.schemas.common import ProcurementBaseModel


class AIChatRequest(ProcurementBaseModel):
    prompt: str


class AIChatResponse(ProcurementBaseModel):
    response: str
    used_llm: bool = True
    provider_name: str | None = None
    model_name: str | None = None
    execution_mode: str = "llm"
    can_execute_requested_action: bool = True
    recommended_actions: list[str] = Field(default_factory=list)
    used_evidence: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    system_limits: list[str] = Field(default_factory=list)
    available_actions: list[str] = Field(default_factory=list)
    next_step: str | None = None


class DeleteProcessResponse(ProcurementBaseModel):
    deleted_process_id: str
    deleted: bool = True


class Stage1AutoFixRequest(ProcurementBaseModel):
    use_ai: bool = True


class Stage1AutoFixResponse(ProcurementBaseModel):
    process_id: str
    actions_applied: list[dict] = Field(default_factory=list)
    used_llm: bool = False
    provider_name: str | None = None
    model_name: str | None = None
    summary: str
    before_score: int | None = None
    after_score: int | None = None
    stage_status_after: str | None = None
    blockers_after: list[str] = Field(default_factory=list)
    iterations: list[dict] = Field(default_factory=list)
    stop_reason: str | None = None
    redundant_verdict: dict = Field(default_factory=dict)


class Stage1RunResponse(ProcurementBaseModel):
    process_id: str
    stage_code: str = "stage_1_extraction_normalization"
    status: str
    consistency_score: int
    automation_ready: bool = False
    summary: str
    blocking_reasons: list[str] = Field(default_factory=list)
    metrics: dict = Field(default_factory=dict)
