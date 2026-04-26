from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from procurement_core.llm.base import BaseLLMProvider
from procurement_core.models.enums import FileType, ProviderKind
from procurement_core.models.orm import ProcessDocument
from procurement_core.schemas.process import ProcessDetail


@dataclass
class Stage1Action:
    action_type: str
    document_id: str
    value: Any
    reason: str
    source: str = "rules"

    def as_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type,
            "document_id": self.document_id,
            "value": self.value,
            "reason": self.reason,
            "source": self.source,
        }


class Stage1DecisionService:
    def __init__(self, llm_provider: BaseLLMProvider | None = None) -> None:
        self.llm_provider = llm_provider

    def plan_actions(
        self,
        detail: ProcessDetail,
        *,
        use_ai: bool,
        memory_cases: list[dict[str, Any]] | None = None,
    ) -> tuple[list[Stage1Action], dict[str, Any]]:
        actions = self._rule_actions(detail)
        meta: dict[str, Any] = {"used_llm": False}
        if use_ai and self._llm_available():
            llm_actions, llm_meta = self._llm_actions(detail, memory_cases=memory_cases or [])
            if llm_actions:
                actions = self._merge_actions(actions, llm_actions)
            meta = llm_meta
        return actions, meta

    def _rule_actions(self, detail: ProcessDetail) -> list[Stage1Action]:
        actions: list[Stage1Action] = []
        raw_by_document: dict[str, list] = {}
        for raw_item in detail.raw_items:
            raw_by_document.setdefault(raw_item.document_id, []).append(raw_item)

        excel_documents = [document for document in detail.documents if document.file_name.lower().endswith((".xlsx", ".xlsm", ".xls"))]
        pdf_documents = [document for document in detail.documents if document.file_name.lower().endswith(".pdf")]

        for document in excel_documents:
            doc_raw = raw_by_document.get(document.id, [])
            incomplete_rows = len([row for row in doc_raw if not (row.raw_unit_price and row.raw_total)])
            if len(doc_raw) == 0 or incomplete_rows >= len(doc_raw):
                actions.append(
                    Stage1Action(
                        action_type="set_document_extraction_mode",
                        document_id=document.id,
                        value="flexible",
                        reason="El Excel no produjo filas financieras completas con el modo estándar.",
                    )
                )
            actions.append(
                Stage1Action(
                    action_type="set_document_priority",
                    document_id=document.id,
                    value=900,
                    reason="El Excel es la mejor fuente candidata para etapa 1 por su estructura tabular.",
                )
            )

        if excel_documents:
            for document in pdf_documents:
                doc_raw = raw_by_document.get(document.id, [])
                if len(doc_raw) <= 1:
                    actions.append(
                        Stage1Action(
                            action_type="set_document_support_only",
                            document_id=document.id,
                            value=True,
                            reason="El PDF aporta poco a la extracción base y debe quedar como soporte mientras el Excel lidera la etapa 1.",
                        )
                    )
                    actions.append(
                        Stage1Action(
                            action_type="set_document_route",
                            document_id=document.id,
                            value="pdf_scanned",
                            reason="Se fuerza una ruta OCR local porque el PDF nativo no está entregando filas útiles.",
                        )
                    )
        return actions

    def _llm_available(self) -> bool:
        if self.llm_provider is None:
            return False
        return getattr(self.llm_provider, "provider_kind", ProviderKind.DISABLED) != ProviderKind.DISABLED

    def _llm_actions(
        self,
        detail: ProcessDetail,
        *,
        memory_cases: list[dict[str, Any]],
    ) -> tuple[list[Stage1Action], dict[str, Any]]:
        allowed_actions = []
        for document in detail.documents:
            allowed_actions.append(
                {
                    "document_id": document.id,
                    "file_name": document.file_name,
                    "allowed_actions": [
                        "set_document_priority",
                        "set_document_support_only",
                        "set_document_extraction_mode",
                        "set_document_route",
                    ],
                    "allowed_values": {
                        "set_document_priority": [900, 0, -300],
                        "set_document_support_only": [True, False],
                        "set_document_extraction_mode": ["standard", "flexible"],
                        "set_document_route": ["pdf_native", "pdf_scanned", "excel"],
                    },
                }
            )
        payload = {
            "process_name": detail.process.name,
            "stage_1_metrics": detail.stage_summaries[0].metrics if detail.stage_summaries else {},
            "documents": [
                {
                    "document_id": document.id,
                    "file_name": document.file_name,
                    "document_kind": document.document_kind,
                    "metadata_json": document.metadata_json or {},
                }
                for document in detail.documents
            ],
            "raw_items": [
                {
                    "document_id": item.document_id,
                    "item_number": item.item_number,
                    "description": item.raw_description,
                    "unit_price": item.raw_unit_price,
                    "total": item.raw_total,
                }
                for item in detail.raw_items[:40]
            ],
            "allowed_actions": allowed_actions,
            "historical_memory": memory_cases[:5],
        }
        system_prompt = (
            "Eres un tomador de decisiones para la etapa 1 de extracción documental. "
            "No inventes datos del proceso. Solo puedes decidir acciones seguras sobre documentos ya cargados. "
            "Aprende de la memoria histórica resumida cuando sea relevante, pero no la copies ciegamente si no aplica. "
            'Devuelve JSON con la clave "actions", una lista de objetos con: action_type, document_id, value, reason.'
        )
        user_prompt = (
            "Evalúa si la extracción local actual es confiable. "
            "Si no lo es, elige acciones concretas de la lista permitida para mejorar la etapa 1.\n\n"
            f"Contexto:\n{payload}"
        )
        result = self.llm_provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        actions = self._sanitize_llm_actions(result.payload, fallback_content=result.content, detail=detail)
        return actions, {
            "used_llm": result.succeeded and len(actions) > 0,
            "llm_provider": result.provider.value,
            "llm_model": result.model,
            "llm_payload": result.payload,
        }

    def _sanitize_llm_actions(
        self,
        payload: dict | None,
        *,
        fallback_content: str | None,
        detail: ProcessDetail,
    ) -> list[Stage1Action]:
        data = payload or {}
        if not data.get("actions") and fallback_content:
            try:
                parsed = json.loads(fallback_content)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                data = parsed
        valid_document_ids = {document.id for document in detail.documents}
        sanitized: list[Stage1Action] = []
        for entry in data.get("actions", []):
            if not isinstance(entry, dict):
                continue
            action_type = str(entry.get("action_type") or "").strip()
            document_id = str(entry.get("document_id") or "").strip()
            value = entry.get("value")
            reason = str(entry.get("reason") or "").strip() or "Acción sugerida por IA."
            if document_id not in valid_document_ids:
                continue
            if action_type not in {
                "set_document_priority",
                "set_document_support_only",
                "set_document_extraction_mode",
                "set_document_route",
            }:
                continue
            sanitized.append(
                Stage1Action(
                    action_type=action_type,
                    document_id=document_id,
                    value=value,
                    reason=reason,
                    source="llm",
                )
            )
        return sanitized

    def _merge_actions(self, base_actions: list[Stage1Action], llm_actions: list[Stage1Action]) -> list[Stage1Action]:
        merged: dict[tuple[str, str], Stage1Action] = {}
        for action in base_actions + llm_actions:
            merged[(action.document_id, action.action_type)] = action
        return list(merged.values())

    @staticmethod
    def apply_actions(documents: list[ProcessDocument], actions: list[Stage1Action]) -> None:
        document_map = {document.id: document for document in documents}
        for action in actions:
            document = document_map.get(action.document_id)
            if document is None:
                continue
            metadata = dict(document.metadata_json or {})
            if action.action_type == "set_document_priority":
                metadata["stage1_priority_override"] = int(action.value)
            elif action.action_type == "set_document_support_only":
                metadata["stage1_support_only"] = bool(action.value)
            elif action.action_type == "set_document_extraction_mode":
                metadata["extraction_mode"] = str(action.value)
            elif action.action_type == "set_document_route":
                metadata["extraction_route_override"] = str(action.value)
            history = list(metadata.get("stage1_actions_history") or [])
            history.append(action.as_dict())
            metadata["stage1_actions_history"] = history[-20:]
            document.metadata_json = metadata
