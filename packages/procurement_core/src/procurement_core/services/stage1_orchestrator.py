from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from procurement_core.llm.base import BaseLLMProvider
from procurement_core.models.enums import ProviderKind
from procurement_core.schemas.process import ProcessDetail
from procurement_core.services.stage1_actions import Stage1Action, Stage1DecisionService


def _stage_1_summary(detail: ProcessDetail) -> Any | None:
    for stage in detail.stage_summaries:
        if stage.stage_code == "stage_1_extraction_normalization":
            return stage
    return detail.stage_summaries[0] if detail.stage_summaries else None


def _stage_1_metrics(detail: ProcessDetail) -> dict[str, Any]:
    stage = _stage_1_summary(detail)
    return dict(stage.metrics) if stage is not None else {}


def _stage_1_score(detail: ProcessDetail) -> int:
    stage = _stage_1_summary(detail)
    return int(stage.consistency_score) if stage is not None else 0


def _stage_1_status(detail: ProcessDetail) -> str:
    stage = _stage_1_summary(detail)
    return str(stage.status) if stage is not None else "review_required"


def _stage_1_blockers(detail: ProcessDetail) -> list[str]:
    stage = _stage_1_summary(detail)
    return list(stage.blocking_reasons) if stage is not None else ["La etapa 1 no tiene resumen disponible."]


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _parse_llm_payload(payload: dict | None, fallback_content: str | None = None) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        return payload
    if not fallback_content:
        return None
    try:
        parsed = json.loads(fallback_content)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


@dataclass
class Stage1RedundantVerdictService:
    llm_provider: BaseLLMProvider | None = None

    def evaluate(
        self,
        detail: ProcessDetail,
        *,
        iteration_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        rule_gate = self._rule_gate(detail)
        llm_gate = self._llm_gate(detail, rule_gate=rule_gate, iteration_history=iteration_history or [])
        final_decision = "proceed" if rule_gate["decision"] == "proceed" else "review_required"
        if llm_gate.get("used_llm") and llm_gate.get("decision") != "proceed":
            final_decision = "review_required"

        combined_reasons = list(rule_gate["reasons"])
        if llm_gate.get("reason"):
            combined_reasons.append(str(llm_gate["reason"]))

        return {
            "final_decision": final_decision,
            "proceed_allowed": final_decision == "proceed",
            "rule_decision": rule_gate["decision"],
            "rule_confidence": rule_gate["confidence"],
            "rule_reasons": rule_gate["reasons"],
            "llm_used": bool(llm_gate.get("used_llm")),
            "llm_decision": llm_gate.get("decision"),
            "llm_reason": llm_gate.get("reason"),
            "llm_provider": llm_gate.get("provider"),
            "llm_model": llm_gate.get("model"),
            "reasons": combined_reasons,
        }

    def _rule_gate(self, detail: ProcessDetail) -> dict[str, Any]:
        stage = _stage_1_summary(detail)
        metrics = _stage_1_metrics(detail)
        score = _stage_1_score(detail)
        raw_items = _safe_int(metrics.get("raw_items"))
        missing_financial = _safe_int(metrics.get("missing_financial_fields"))
        missing_item_number = _safe_int(metrics.get("missing_item_number"))
        excel_primary = _safe_int(metrics.get("excel_primary_rows"))

        reasons = list(_stage_1_blockers(detail))
        decision = "review_required"
        confidence = "high"

        ready_by_rules = (
            stage is not None
            and stage.status == "ready"
            and score >= 75
            and raw_items > 0
            and missing_financial <= max(2, raw_items // 10)
            and missing_item_number <= max(1, raw_items // 20)
        )
        if ready_by_rules:
            decision = "proceed"
            reasons = ["La etapa 1 superó la compuerta de integridad con reglas duras y cobertura suficiente."]
        elif score >= 60 and excel_primary > 0:
            confidence = "medium"
            reasons.append("Hay señales parciales de estructura válida, pero no las suficientes para aprobar la etapa 1 automáticamente.")

        return {
            "decision": decision,
            "confidence": confidence,
            "reasons": reasons,
        }

    def _llm_gate(
        self,
        detail: ProcessDetail,
        *,
        rule_gate: dict[str, Any],
        iteration_history: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if self.llm_provider is None:
            return {"used_llm": False}
        if getattr(self.llm_provider, "provider_kind", ProviderKind.DISABLED) == ProviderKind.DISABLED:
            return {"used_llm": False}

        score = _stage_1_score(detail)
        if rule_gate["decision"] == "proceed" and score >= 88:
            return {"used_llm": False}

        stage = _stage_1_summary(detail)
        payload = {
            "task": "stage1_redundant_gate",
            "process_name": detail.process.name,
            "rule_gate": rule_gate,
            "stage_1": {
                "status": _stage_1_status(detail),
                "score": score,
                "blocking_reasons": _stage_1_blockers(detail),
                "metrics": _stage_1_metrics(detail),
            },
            "documents": [
                {
                    "file_name": document.file_name,
                    "file_type": str(document.file_type),
                    "document_kind": str(document.document_kind),
                    "metadata_json": document.metadata_json or {},
                }
                for document in detail.documents[:12]
            ],
            "iteration_history": iteration_history[-3:],
            "expected_output": {
                "decision": "proceed|review_required",
                "reason": "string",
            },
        }
        system_prompt = (
            "Eres un auditor redundante de etapa 1 para un sistema local-first de contratación pública. "
            "No inventes datos ni sustituyas las reglas duras. Solo actúas como una segunda compuerta conservadora. "
            "Si dudas, responde review_required. Devuelve JSON válido."
        )
        result = self.llm_provider.complete_json(system_prompt=system_prompt, user_prompt=json.dumps(payload, ensure_ascii=False))
        parsed = _parse_llm_payload(result.payload, result.content)
        if not result.succeeded or not parsed:
            return {
                "used_llm": False,
                "error_message": result.error_message,
            }

        decision = str(parsed.get("decision") or "").strip().lower()
        if decision not in {"proceed", "review_required"}:
            decision = "review_required"
        return {
            "used_llm": True,
            "decision": decision,
            "reason": str(parsed.get("reason") or "La auditoría redundante IA prefirió no aprobar la etapa automáticamente.").strip(),
            "provider": result.provider.value,
            "model": result.model,
        }


class Stage1OrchestratorService:
    def __init__(
        self,
        *,
        decision_service: Stage1DecisionService,
        verdict_service: Stage1RedundantVerdictService,
        max_iterations: int = 3,
    ) -> None:
        self.decision_service = decision_service
        self.verdict_service = verdict_service
        self.max_iterations = max_iterations

    def run(
        self,
        initial_detail: ProcessDetail,
        *,
        use_ai: bool,
        memory_cases: list[dict[str, Any]] | None,
        apply_actions: Callable[[list[Stage1Action]], list[Stage1Action]],
        rerun_detail: Callable[[], ProcessDetail],
    ) -> dict[str, Any]:
        current_detail = initial_detail
        iteration_history: list[dict[str, Any]] = []
        all_actions: list[dict[str, Any]] = []
        any_llm_used = False
        stop_reason = "not_started"
        plan_meta: dict[str, Any] = {"used_llm": False}

        initial_verdict = self.verdict_service.evaluate(current_detail, iteration_history=iteration_history)
        if initial_verdict["proceed_allowed"]:
            return {
                "detail_before": initial_detail,
                "detail_after": current_detail,
                "iterations": [],
                "actions_applied": [],
                "used_llm": False,
                "stop_reason": "already_passed_gate",
                "final_verdict": initial_verdict,
                "plan_meta": initial_verdict,
            }

        for iteration_number in range(1, self.max_iterations + 1):
            actions, plan_meta = self.decision_service.plan_actions(
                current_detail,
                use_ai=use_ai,
                memory_cases=memory_cases or [],
            )
            any_llm_used = any_llm_used or bool(plan_meta.get("used_llm"))
            effective_actions = apply_actions(actions)
            before_score = _stage_1_score(current_detail)
            before_status = _stage_1_status(current_detail)
            before_metrics = _stage_1_metrics(current_detail)

            if not effective_actions:
                stop_reason = "no_effective_actions"
                final_verdict = self.verdict_service.evaluate(current_detail, iteration_history=iteration_history)
                return {
                    "detail_before": initial_detail,
                    "detail_after": current_detail,
                    "iterations": iteration_history,
                    "actions_applied": all_actions,
                    "used_llm": any_llm_used,
                    "stop_reason": stop_reason,
                    "final_verdict": final_verdict,
                    "plan_meta": plan_meta,
                }

            current_detail = rerun_detail()
            after_score = _stage_1_score(current_detail)
            after_status = _stage_1_status(current_detail)
            material_improvement = self._is_material_improvement(
                detail_before_metrics=before_metrics,
                detail_after_metrics=_stage_1_metrics(current_detail),
                current_before_score=before_score,
                current_after_score=after_score,
                iteration_before_status=before_status,
                iteration_after_status=after_status,
            )
            iteration_record = {
                "iteration": iteration_number,
                "actions_applied": [action.as_dict() for action in effective_actions],
                "used_llm": bool(plan_meta.get("used_llm")),
                "before_score": before_score,
                "after_score": after_score,
                "before_status": before_status,
                "after_status": after_status,
                "material_improvement": material_improvement,
            }
            iteration_history.append(iteration_record)
            all_actions.extend(iteration_record["actions_applied"])

            final_verdict = self.verdict_service.evaluate(current_detail, iteration_history=iteration_history)
            if final_verdict["proceed_allowed"]:
                stop_reason = "passed_redundant_gate"
                return {
                    "detail_before": initial_detail,
                    "detail_after": current_detail,
                    "iterations": iteration_history,
                    "actions_applied": all_actions,
                    "used_llm": any_llm_used,
                    "stop_reason": stop_reason,
                    "final_verdict": final_verdict,
                    "plan_meta": plan_meta,
                }
            if not material_improvement:
                stop_reason = "no_material_improvement"
                return {
                    "detail_before": initial_detail,
                    "detail_after": current_detail,
                    "iterations": iteration_history,
                    "actions_applied": all_actions,
                    "used_llm": any_llm_used,
                    "stop_reason": stop_reason,
                    "final_verdict": final_verdict,
                    "plan_meta": plan_meta,
                }

        stop_reason = "max_iterations_reached"
        final_verdict = self.verdict_service.evaluate(current_detail, iteration_history=iteration_history)
        return {
            "detail_before": initial_detail,
            "detail_after": current_detail,
            "iterations": iteration_history,
            "actions_applied": all_actions,
            "used_llm": any_llm_used,
            "stop_reason": stop_reason,
            "final_verdict": final_verdict,
            "plan_meta": plan_meta,
        }

    def _is_material_improvement(
        self,
        *,
        detail_before_metrics: dict[str, Any],
        detail_after_metrics: dict[str, Any],
        current_before_score: int,
        current_after_score: int,
        iteration_before_status: str,
        iteration_after_status: str,
    ) -> bool:
        if iteration_before_status != "ready" and iteration_after_status == "ready":
            return True
        if current_after_score >= current_before_score + 8:
            return True

        if _safe_int(detail_after_metrics.get("missing_financial_fields")) < _safe_int(detail_before_metrics.get("missing_financial_fields")):
            return True
        if _safe_int(detail_after_metrics.get("missing_item_number")) < _safe_int(detail_before_metrics.get("missing_item_number")):
            return True
        if _safe_int(detail_after_metrics.get("suspected_noise_rows")) < _safe_int(detail_before_metrics.get("suspected_noise_rows")):
            return True
        return False

    @staticmethod
    def filter_effective_actions(detail: ProcessDetail, actions: list[Stage1Action]) -> list[Stage1Action]:
        document_map = {document.id: document for document in detail.documents}
        filtered: list[Stage1Action] = []
        for action in actions:
            document = document_map.get(action.document_id)
            if document is None:
                continue
            metadata = dict(document.metadata_json or {})
            current_value = None
            if action.action_type == "set_document_priority":
                current_value = metadata.get("stage1_priority_override")
            elif action.action_type == "set_document_support_only":
                current_value = metadata.get("stage1_support_only")
            elif action.action_type == "set_document_extraction_mode":
                current_value = metadata.get("extraction_mode")
            elif action.action_type == "set_document_route":
                current_value = metadata.get("extraction_route_override")
            if current_value == action.value:
                continue
            filtered.append(action)
        return filtered
