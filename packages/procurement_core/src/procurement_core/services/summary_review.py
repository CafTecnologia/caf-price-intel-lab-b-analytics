from __future__ import annotations

import json
from dataclasses import dataclass

from procurement_core.llm.base import BaseLLMProvider, LLMResult
from procurement_core.models.enums import FileType, ProviderKind
from procurement_core.models.orm import ExtractedItemNormalized
from procurement_core.services.item_identity import canonicalize_description


def _tokenize(value: str | None) -> set[str]:
    normalized = canonicalize_description(value)
    if not normalized:
        return set()
    return {token for token in normalized.split() if token}


def _jaccard_similarity(left: str | None, right: str | None) -> float:
    left_tokens = _tokenize(left)
    right_tokens = _tokenize(right)
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    if union == 0:
        return 0.0
    return intersection / union


def _field_repeats_description(description: str | None, candidate: str | None) -> bool:
    if not description or not candidate:
        return False
    normalized_description = canonicalize_description(description)
    normalized_candidate = canonicalize_description(candidate)
    if not normalized_description or not normalized_candidate:
        return False
    if normalized_description == normalized_candidate:
        return True
    if len(normalized_candidate) >= 30 and normalized_candidate in normalized_description:
        return True
    return _jaccard_similarity(normalized_description, normalized_candidate) >= 0.85


def _is_priced_catalog_row(item: ExtractedItemNormalized) -> bool:
    raw_item = item.raw_item
    metadata = item.metadata_json or {}
    item_number = metadata.get("item_number_normalized") or metadata.get("item_number")
    return bool(
        item_number
        and raw_item.raw_description
        and item.unit_price_cop is not None
        and not raw_item.raw_total
        and (
            raw_item.raw_quantity
            or item.quantity_num is not None
        )
    )


def _build_match_label(item: ExtractedItemNormalized) -> dict[str, object]:
    metadata = item.metadata_json or {}
    return {
        "normalized_item_id": item.id,
        "item_number": metadata.get("item_number_normalized") or metadata.get("item_number"),
        "description": item.raw_item.raw_description,
        "unit": item.raw_item.raw_unit,
        "quantity": item.raw_item.raw_quantity,
        "unit_price": item.raw_item.raw_unit_price,
        "total": item.raw_item.raw_total,
        "origin": item.raw_item.file_name,
    }


def _parse_llm_payload(result: LLMResult) -> dict:
    if not result.content:
        return {}
    content = result.content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(content[start : end + 1])
            except json.JSONDecodeError:
                return {}
    return {}


@dataclass(slots=True)
class SummaryReviewDecision:
    normalized_item_id: str
    include_in_summary: bool
    reason: str
    flags: list[str]
    probable_matches: list[dict[str, object]]
    used_llm: bool = False
    llm_decision: str | None = None
    llm_matched_item_number: str | None = None


class SummaryReviewService:
    LLM_BATCH_SIZE = 8
    LLM_MAX_ANCHORS = 12

    def __init__(self, llm_provider: BaseLLMProvider | None = None) -> None:
        self.llm_provider = llm_provider

    def review(self, normalized_items: list[ExtractedItemNormalized]) -> tuple[list[SummaryReviewDecision], dict[str, object]]:
        anchors = [item for item in normalized_items if self._is_anchor(item)]
        strong_anchor_set = len(anchors) >= 5
        draft_decisions: list[SummaryReviewDecision] = []
        llm_candidates: list[dict[str, object]] = []

        for item in normalized_items:
            flags, probable_matches = self._collect_flags(item, anchors, strong_anchor_set)
            hard_exclude = self._is_hard_exclusion(flags)
            suspicious = hard_exclude or len(flags) >= 2
            if not suspicious:
                draft_decisions.append(
                    SummaryReviewDecision(
                        normalized_item_id=item.id,
                        include_in_summary=True,
                        reason="Sin señales relevantes de ruido documental en la consolidación.",
                        flags=[],
                        probable_matches=[],
                    )
                )
                continue

            initial_reason = (
                "Se excluye del resumen por reglas duras de integridad documental."
                if hard_exclude
                else "Fila sospechosa enviada a revisión semántica antes de consolidar."
            )
            decision = SummaryReviewDecision(
                normalized_item_id=item.id,
                include_in_summary=not hard_exclude,
                reason=initial_reason,
                flags=flags,
                probable_matches=probable_matches,
            )
            draft_decisions.append(decision)
            llm_candidates.append(self._serialize_candidate(item, flags, probable_matches, hard_exclude))

        llm_used = False
        llm_result_payload: dict[str, object] = {}
        if llm_candidates and self._llm_available():
            llm_used, llm_result_payload = self._apply_llm_review(draft_decisions, anchors, llm_candidates)

        summary = {
            "anchors_detected": len(anchors),
            "strong_anchor_set": strong_anchor_set,
            "reviewed_items": len(draft_decisions),
            "suspicious_items": len([decision for decision in draft_decisions if decision.flags]),
            "excluded_items": len([decision for decision in draft_decisions if not decision.include_in_summary]),
            "llm_reviewed_items": len(llm_candidates) if llm_used else 0,
            "used_llm": llm_used,
        }
        if llm_result_payload:
            summary["llm_payload"] = llm_result_payload
        return draft_decisions, summary

    def _is_anchor(self, item: ExtractedItemNormalized) -> bool:
        metadata = item.metadata_json or {}
        item_number = metadata.get("item_number_normalized") or metadata.get("item_number")
        raw_item = item.raw_item
        return bool(
            item_number
            and item.quantity_num is not None
            and item.unit_price_cop is not None
            and item.total_cop is not None
            and raw_item.document.file_type == FileType.EXCEL
        )

    def _collect_flags(
        self,
        item: ExtractedItemNormalized,
        anchors: list[ExtractedItemNormalized],
        strong_anchor_set: bool,
    ) -> tuple[list[str], list[dict[str, object]]]:
        raw_item = item.raw_item
        metadata = item.metadata_json or {}
        item_number = metadata.get("item_number_normalized") or metadata.get("item_number")
        flags: list[str] = []

        if strong_anchor_set and not item_number and raw_item.document.file_type != FileType.EXCEL:
            flags.append("missing_item_number_with_anchor_set")
        priced_catalog_row = _is_priced_catalog_row(item)
        if item.quantity_num is None and not priced_catalog_row:
            flags.append("missing_quantity")
        if item.unit_price_cop is None:
            flags.append("missing_unit_price")
        if item.total_cop is None and not priced_catalog_row:
            flags.append("missing_total")
        if _field_repeats_description(raw_item.raw_description, raw_item.raw_unit):
            flags.append("unit_repeats_description")
        if _field_repeats_description(raw_item.raw_description, raw_item.raw_unit_price):
            flags.append("unit_price_repeats_description")
        if _field_repeats_description(raw_item.raw_description, raw_item.raw_total):
            flags.append("total_repeats_description")
        if raw_item.document.file_type != FileType.EXCEL and raw_item.status == "primary" and not item_number:
            flags.append("non_structured_primary_row")

        description_tokens = _tokenize(raw_item.raw_description)
        if len(description_tokens) >= 20 and not item_number and item.quantity_num is None:
            flags.append("narrative_fragment_without_structure")

        probable_matches: list[tuple[float, ExtractedItemNormalized]] = []
        if not item_number:
            for anchor in anchors:
                score = _jaccard_similarity(raw_item.raw_description, anchor.raw_item.raw_description)
                if score >= 0.35:
                    probable_matches.append((score, anchor))
        probable_matches.sort(key=lambda entry: entry[0], reverse=True)
        top_matches = [
            {
                **_build_match_label(anchor),
                "similarity": round(score, 4),
            }
            for score, anchor in probable_matches[:3]
        ]
        if top_matches:
            flags.append("possible_duplicate_of_numbered_item")
        return sorted(set(flags)), top_matches

    def _is_hard_exclusion(self, flags: list[str]) -> bool:
        hard_flags = {
            "unit_repeats_description",
            "unit_price_repeats_description",
            "total_repeats_description",
        }
        if hard_flags & set(flags):
            return True
        return all(flag in flags for flag in ["missing_item_number_with_anchor_set", "missing_quantity", "possible_duplicate_of_numbered_item"])

    def _serialize_candidate(
        self,
        item: ExtractedItemNormalized,
        flags: list[str],
        probable_matches: list[dict[str, object]],
        hard_exclude: bool,
    ) -> dict[str, object]:
        metadata = item.metadata_json or {}
        raw_item = item.raw_item
        return {
            "normalized_item_id": item.id,
            "raw_item_id": raw_item.id,
            "file_name": raw_item.file_name,
            "document_kind": raw_item.document.document_kind.value,
            "file_type": raw_item.document.file_type.value,
            "source_role": metadata.get("source_role"),
            "item_number": metadata.get("item_number_normalized") or metadata.get("item_number"),
            "raw_description": raw_item.raw_description,
            "raw_quantity": raw_item.raw_quantity,
            "raw_unit": raw_item.raw_unit,
            "raw_unit_price": raw_item.raw_unit_price,
            "raw_total": raw_item.raw_total,
            "flags": flags,
            "hard_exclude": hard_exclude,
            "probable_matches": probable_matches,
        }

    def _llm_available(self) -> bool:
        if self.llm_provider is None:
            return False
        return getattr(self.llm_provider, "provider_kind", ProviderKind.DISABLED) != ProviderKind.DISABLED

    def _apply_llm_review(
        self,
        decisions: list[SummaryReviewDecision],
        anchors: list[ExtractedItemNormalized],
        llm_candidates: list[dict[str, object]],
    ) -> tuple[bool, dict[str, object]]:
        decision_map = {decision.normalized_item_id: decision for decision in decisions}
        anchor_payload = [_build_match_label(anchor) for anchor in anchors[: self.LLM_MAX_ANCHORS]]
        system_prompt = (
            "Eres un revisor de calidad documental para licitaciones. "
            "Debes decidir si filas sospechosas deben aparecer en el resumen consolidado para usuario. "
            "Nunca inventes datos ni corrijas valores. Solo clasifica cada fila como keep, exclude o review. "
            "Excluye fragmentos narrativos, filas con columnas corridas, duplicados semánticos de items numerados, "
            "o filas sin estructura financiera suficiente. Responde JSON valido."
        )
        candidate_batches = [
            llm_candidates[index:index + self.LLM_BATCH_SIZE]
            for index in range(0, len(llm_candidates), self.LLM_BATCH_SIZE)
        ]
        batch_results: list[dict[str, object]] = []
        any_success = False

        for batch_index, candidate_batch in enumerate(candidate_batches, start=1):
            user_prompt = json.dumps(
                {
                    "task": "summary_quality_review",
                    "batch_number": batch_index,
                    "batch_count": len(candidate_batches),
                    "rules": [
                        "No inventar ni completar cifras.",
                        "Si una fila parece el mismo item de una fuente numerada mas confiable, excluirla del resumen.",
                        "Si raw_unit, raw_unit_price o raw_total repiten la descripcion, tratarla como fila defectuosa.",
                        "Si no estas seguro, usa review en vez de keep.",
                    ],
                    "anchor_items": anchor_payload,
                    "candidate_rows": candidate_batch,
                    "expected_output": {
                        "decisions": [
                            {
                                "normalized_item_id": "string",
                                "decision": "keep|exclude|review",
                                "reason": "string",
                                "matched_item_number": "string|null",
                            }
                        ]
                    },
                },
                ensure_ascii=False,
            )
            result = self.llm_provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
            payload = _parse_llm_payload(result)
            if not result.succeeded or not payload:
                batch_results.append(
                    {
                        "batch_number": batch_index,
                        "candidate_count": len(candidate_batch),
                        "succeeded": False,
                        "error_message": result.error_message,
                    }
                )
                break

            batch_results.append(
                {
                    "batch_number": batch_index,
                    "candidate_count": len(candidate_batch),
                    "succeeded": True,
                    "decisions_received": len(payload.get("decisions", [])),
                }
            )
            any_success = True

            for entry in payload.get("decisions", []):
                normalized_item_id = str(entry.get("normalized_item_id") or "").strip()
                if not normalized_item_id or normalized_item_id not in decision_map:
                    continue
                decision = decision_map[normalized_item_id]
                llm_decision = str(entry.get("decision") or "").strip().lower()
                llm_reason = str(entry.get("reason") or "").strip() or "Revisión IA sin explicación adicional."
                matched_item_number = entry.get("matched_item_number")
                decision.used_llm = True
                decision.llm_decision = llm_decision or None
                decision.llm_matched_item_number = str(matched_item_number).strip() if matched_item_number else None
                if not self._is_hard_exclusion(decision.flags):
                    decision.include_in_summary = llm_decision == "keep"
                decision.reason = llm_reason

        return any_success, {
            "succeeded": any_success,
            "batch_size": self.LLM_BATCH_SIZE,
            "batch_count": len(candidate_batches),
            "batches": batch_results,
        }
