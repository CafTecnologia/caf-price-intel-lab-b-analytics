from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import shutil

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from procurement_core.benchmark.service import BenchmarkService
from procurement_core.config import get_settings
from procurement_core.llm.providers import LLMRuntimeConfig, get_llm_provider
from procurement_core.models.enums import ProcessStatus, ReviewStatus
from procurement_core.models.orm import (
    AuditLog,
    BenchmarkItem,
    BenchmarkSource,
    DocumentPage,
    ExtractedItemRaw,
    ExtractedItemNormalized,
    FinancialAssessment,
    LLMTaskLog,
    ProcessDocument,
    ProcessReport,
    ProviderConfig,
    ProcurementProcess,
    ReviewDecision,
    ValidationIssue,
)
from procurement_core.models.enums import ProviderKind
from procurement_core.pipelines.analysis import ProcessAnalysisPipeline
from procurement_core.schemas.ai import (
    AIChatResponse,
    DeleteProcessResponse,
    Stage1AutoFixResponse,
    Stage1RunResponse,
)
from procurement_core.schemas.process import DashboardSummary, ProcessCreate
from procurement_core.schemas.provider import (
    LLMConnectionTestResult,
    ProviderConfigRead,
    ProviderConfigUpsert,
)
from procurement_core.services.stage1_actions import Stage1DecisionService
from procurement_core.services.stage1_orchestrator import Stage1OrchestratorService, Stage1RedundantVerdictService
from procurement_core.storage.files import LocalFileStorage
from procurement_api.presenters import build_process_detail


def create_process(session: Session, payload: ProcessCreate) -> ProcurementProcess:
    process = ProcurementProcess(**payload.model_dump(), metadata_json={})
    session.add(process)
    session.flush()
    return process


def register_document(session: Session, process_id: str, file_name: str, content: bytes) -> ProcessDocument:
    storage = LocalFileStorage()
    ingested = storage.save_process_file(process_id, file_name, content)
    document = ProcessDocument(
        process_id=process_id,
        file_name=ingested.file_name,
        file_hash=ingested.file_hash,
        mime_type=ingested.mime_type,
        file_type=ingested.file_type,
        storage_path=str(ingested.storage_path),
        metadata_json=ingested.metadata,
    )
    session.add(document)
    process = session.get(ProcurementProcess, process_id)
    if process:
        process.status = ProcessStatus.INGESTED
    session.flush()
    return document


def build_pipeline(session: Session, force_ai: bool = False) -> ProcessAnalysisPipeline:
    seed_path = Path(__file__).resolve().parents[4] / "demo" / "sample_process" / "benchmark_seed.json"
    return ProcessAnalysisPipeline(session, benchmark_service=BenchmarkService(seed_path=seed_path), force_ai=force_ai)


def analyze_process(session: Session, process_id: str, force_ai: bool = False) -> dict[str, int | str]:
    return build_pipeline(session, force_ai=force_ai).analyze_process(process_id)


def reanalyze_process(session: Session, process_id: str, force_ai: bool = False) -> dict[str, int | str]:
    return build_pipeline(session, force_ai=force_ai).analyze_process(process_id)


def run_stage_1(session: Session, process_id: str, force_ai: bool = False) -> dict[str, int | str]:
    return build_pipeline(session, force_ai=force_ai).run_stage_1(process_id)


def run_stage_1_with_summary(session: Session, process_id: str, force_ai: bool = False) -> Stage1RunResponse:
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")
    run_stage_1(session, process_id, force_ai=force_ai)
    session.flush()
    detail = _load_process_detail(session, process_id)
    stage_1 = next(
        (stage for stage in detail.stage_summaries if stage.stage_code == "stage_1_extraction_normalization"),
        None,
    )
    if stage_1 is None:
        raise ValueError("Stage 1 summary not available")
    return Stage1RunResponse(
        process_id=process_id,
        status=stage_1.status,
        consistency_score=stage_1.consistency_score,
        automation_ready=stage_1.automation_ready,
        summary=stage_1.recommended_action,
        blocking_reasons=stage_1.blocking_reasons,
        metrics=stage_1.metrics,
    )


def _load_process_detail(session: Session, process_id: str):
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")
    documents = session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id)).scalars().all()
    issues = session.execute(select(ValidationIssue).where(ValidationIssue.process_id == process_id)).scalars().all()
    return build_process_detail(process, documents, issues)


def delete_process(session: Session, process_id: str, actor: str | None = None) -> DeleteProcessResponse:
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")
    before_json = {
        "id": process.id,
        "name": process.name,
        "status": process.status.value,
        "documents": len(process.documents),
        "raw_items": len(process.raw_items),
    }
    storage_root = get_settings().storage_root / process_id
    if storage_root.exists():
        shutil.rmtree(storage_root, ignore_errors=True)
    document_ids = session.execute(
        select(ProcessDocument.id).where(ProcessDocument.process_id == process_id)
    ).scalars().all()
    raw_item_ids = session.execute(
        select(ExtractedItemRaw.id).where(ExtractedItemRaw.process_id == process_id)
    ).scalars().all()
    normalized_item_ids = session.execute(
        select(ExtractedItemNormalized.id).where(ExtractedItemNormalized.raw_item_id.in_(raw_item_ids))
    ).scalars().all() if raw_item_ids else []
    source_ids = session.execute(
        select(BenchmarkItem.source_id).where(BenchmarkItem.normalized_item_id.in_(normalized_item_ids))
    ).scalars().all() if normalized_item_ids else []
    issue_ids = session.execute(
        select(ValidationIssue.id).where(ValidationIssue.process_id == process_id)
    ).scalars().all()

    if issue_ids:
        session.execute(delete(ReviewDecision).where(ReviewDecision.issue_id.in_(issue_ids)))
    session.execute(delete(ValidationIssue).where(ValidationIssue.process_id == process_id))
    session.execute(delete(ProcessReport).where(ProcessReport.process_id == process_id))
    session.execute(delete(LLMTaskLog).where(LLMTaskLog.process_id == process_id))
    if normalized_item_ids:
        session.execute(delete(FinancialAssessment).where(FinancialAssessment.normalized_item_id.in_(normalized_item_ids)))
        session.execute(delete(BenchmarkItem).where(BenchmarkItem.normalized_item_id.in_(normalized_item_ids)))
        session.execute(delete(ExtractedItemNormalized).where(ExtractedItemNormalized.id.in_(normalized_item_ids)))
    if raw_item_ids:
        session.execute(delete(ExtractedItemRaw).where(ExtractedItemRaw.id.in_(raw_item_ids)))
    if document_ids:
        session.execute(delete(DocumentPage).where(DocumentPage.document_id.in_(document_ids)))
        session.execute(delete(ProcessDocument).where(ProcessDocument.id.in_(document_ids)))
    if source_ids:
        orphan_source_ids = session.execute(
            select(BenchmarkSource.id).where(
                BenchmarkSource.id.in_(source_ids),
                ~BenchmarkSource.id.in_(select(BenchmarkItem.source_id)),
            )
        ).scalars().all()
        if orphan_source_ids:
            session.execute(delete(BenchmarkSource).where(BenchmarkSource.id.in_(orphan_source_ids)))
    session.add(
        AuditLog(
            entity_type="procurement_process",
            entity_id=process.id,
            action="delete_process",
            actor=actor,
            before_json=before_json,
            after_json={"deleted": True},
            reason="User requested cleanup of the process.",
        )
    )
    session.execute(delete(ProcurementProcess).where(ProcurementProcess.id == process_id))
    session.flush()
    return DeleteProcessResponse(deleted_process_id=process_id, deleted=True)


def _runtime_config_from_session(session: Session) -> LLMRuntimeConfig:
    stored = session.scalar(select(ProviderConfig).limit(1))
    if stored is not None:
        payload = ProviderConfigUpsert(
            provider_name=stored.provider_name,
            base_url=stored.base_url,
            model_name=stored.model_name,
            api_key=str(stored.config_json.get("api_key") or ""),
            enabled=stored.enabled,
            timeout_seconds=int(stored.config_json.get("timeout_seconds") or get_settings().llm_timeout_seconds),
            max_task_budget_usd=float(
                stored.config_json.get("max_task_budget_usd") or get_settings().llm_max_task_budget_usd
            ),
            max_process_budget_usd=float(
                stored.config_json.get("max_process_budget_usd") or get_settings().llm_max_process_budget_usd
            ),
            estimated_input_token_price=float(
                stored.config_json.get("estimated_input_token_price") or get_settings().llm_estimated_input_token_price
            ),
            estimated_output_token_price=float(
                stored.config_json.get("estimated_output_token_price") or get_settings().llm_estimated_output_token_price
            ),
            extra_headers={
                str(k): str(v)
                for k, v in (stored.config_json.get("extra_headers") or {}).items()
            },
        )
    else:
        payload = _default_provider_config()
    return _runtime_config_from_payload(payload)


def _build_ai_provider(session: Session):
    runtime_config = _runtime_config_from_session(session)
    provider = get_llm_provider(runtime_config)
    if runtime_config.provider_name == ProviderKind.DISABLED or not runtime_config.api_key:
        raise ValueError("La IA no esta configurada o no tiene API key activa.")
    return provider, runtime_config


def _optional_ai_provider(session: Session):
    runtime_config = _runtime_config_from_session(session)
    provider = get_llm_provider(runtime_config)
    if runtime_config.provider_name == ProviderKind.DISABLED or not runtime_config.api_key:
        return None, None
    return provider, runtime_config


def _log_ai_task(
    session: Session,
    *,
    process_id: str,
    task_name: str,
    runtime_config: LLMRuntimeConfig,
    prompt_json: dict,
    result,
) -> None:
    session.add(
        LLMTaskLog(
            process_id=process_id,
            provider_name=runtime_config.provider_name,
            task_name=task_name,
            model_name=runtime_config.model_name,
            prompt_json=prompt_json,
            response_json=result.payload,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            estimated_cost_usd=result.estimated_cost_usd,
            succeeded=result.succeeded,
            error_message=result.error_message,
        )
    )
    session.flush()


def _normalize_ai_payload(payload: dict | None, fallback_content: str | None) -> dict:
    normalized = dict(payload or {})
    if fallback_content:
        fallback_text = fallback_content.strip()
        if fallback_text.startswith("{") and fallback_text.endswith("}"):
            try:
                parsed_fallback = json.loads(fallback_text)
            except json.JSONDecodeError:
                parsed_fallback = None
            if isinstance(parsed_fallback, dict):
                normalized = {**normalized, **parsed_fallback}
    response_value = normalized.get("response")
    if isinstance(response_value, str):
        text = response_value.strip()
        if text.startswith("{") and text.endswith("}"):
            try:
                nested = json.loads(text)
            except json.JSONDecodeError:
                nested = None
            if isinstance(nested, dict):
                normalized = {**nested, **{k: v for k, v in normalized.items() if k not in nested}}
    if not normalized.get("response") and fallback_content:
        normalized["response"] = fallback_content
    return normalized


def _coerce_str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _coerce_bool(value, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "si", "sí", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return default


def _available_actions_for_chat(scope: str) -> list[str]:
    shared = [
        "explicar lo que el sistema hizo con base en la traza registrada",
        "señalar inconsistencias visibles sin alterar el dato fuente",
        "proponer el siguiente paso más seguro dentro del flujo actual",
        "decir explícitamente cuando la petición excede las capacidades actuales del sistema",
    ]
    if scope == "item":
        return shared + [
            "revisar si el artículo tiene evidencia suficiente para benchmark o assessment",
            "proponer búsquedas o documentos de apoyo para ese artículo puntual",
        ]
    return shared + [
        "analizar la etapa 1 con el contexto controlado del proceso",
        "indicar qué documento parece más confiable y por qué",
        "sugerir si conviene ejecutar reanálisis o autocorrección de etapa 1",
    ]


def _system_limits_for_chat(
    *,
    prompt: str,
    scope: str,
    llm_available: bool,
    detail,
    item_has_assessment: bool = False,
) -> tuple[bool, list[str], str | None]:
    lower_prompt = prompt.lower()
    requested_execution = any(
        token in lower_prompt
        for token in (
            "corrige",
            "corrij",
            "edita",
            "modifica",
            "cambia",
            "elimina",
            "borra",
            "sube",
            "carga",
            "reanali",
            "ejecuta",
            "procesa",
            "completa",
            "llena",
            "actualiza",
        )
    )
    limits: list[str] = []
    next_step: str | None = None

    if not llm_available:
        limits.append("La API de IA no está activa; esta respuesta se generó con reglas locales y contexto ya cargado.")
        next_step = "Configura o reactiva el proveedor LLM si quieres una revisión semántica más profunda desde el chat."

    limits.append("Este chat no sube archivos ni abre carpetas por sí solo; solo puede razonar sobre el proceso ya cargado en el sistema.")
    limits.append("Este chat no edita la capa RAW ni ejecuta botones del backend automáticamente; puede orientar qué acción tomar.")

    stage_1 = next(
        (stage for stage in detail.stage_summaries if stage.stage_code == "stage_1_extraction_normalization"),
        None,
    )
    if stage_1 and stage_1.status != "ready":
        limits.append(
            "La etapa 1 aún no está completamente confiable; cualquier recomendación debe validarse contra la evidencia antes de seguir."
        )
        if next_step is None:
            next_step = "Revisa la etapa 1 y, si hace falta, ejecuta reanálisis o autocorrección antes de seguir con etapas posteriores."

    if scope == "item" and not item_has_assessment:
        limits.append("Este artículo todavía no tiene assessment financiero; el chat solo puede orientar con la evidencia actual del resumen.")
        if next_step is None:
            next_step = "Consolida primero la extracción del artículo y luego vuelve a pedir evaluación detallada."

    can_execute = not requested_execution
    if requested_execution:
        limits.append("La instrucción parece pedir una acción operativa. En esta versión, el chat describe y recomienda, pero no ejecuta cambios por sí solo.")
        if next_step is None:
            next_step = "Usa el botón o flujo correspondiente de la etapa y luego vuelve al chat para validar el resultado."

    return can_execute, limits, next_step


def _build_local_chat_fallback(
    *,
    prompt: str,
    scope: str,
    detail,
    llm_available: bool,
    item_number: str | None = None,
    item_has_assessment: bool = False,
    error_message: str | None = None,
) -> AIChatResponse:
    can_execute, limits, next_step = _system_limits_for_chat(
        prompt=prompt,
        scope=scope,
        llm_available=llm_available,
        detail=detail,
        item_has_assessment=item_has_assessment,
    )
    label = f"el artículo {item_number}" if scope == "item" and item_number else "el proceso"
    warnings = list(limits)
    if error_message:
        warnings.append(f"La llamada al proveedor IA falló: {error_message}")
    response = (
        f"Puedo orientarte sobre {label} con el contexto ya cargado, pero en este momento no puedo ejecutar directamente "
        "la acción pedida desde el chat. El sistema conserva la evidencia actual y te indico el límite real para que decidas el siguiente paso."
        if not can_execute
        else f"Te respondo con el contexto controlado disponible para {label}. Si hace falta una acción fuera del alcance del chat, te la indicaré explícitamente."
    )
    evidence = [
        f"Documentos disponibles: {len(detail.documents)}",
        f"Ítems consolidados visibles: {len(detail.consolidated_items)}",
        f"Issues abiertos: {len(detail.issues)}",
    ]
    if scope == "item":
        evidence.append(f"Assessment disponible: {'sí' if item_has_assessment else 'no'}")
    return AIChatResponse(
        response=response,
        used_llm=False,
        provider_name=None,
        model_name=None,
        execution_mode="local_fallback",
        can_execute_requested_action=can_execute,
        recommended_actions=[
            "Formula la solicitud como revisión, diagnóstico o validación si quieres aprovechar mejor este chat.",
            "Ejecuta la acción operativa desde el botón o flujo correspondiente y luego vuelve al chat para contrastar el resultado.",
        ],
        used_evidence=evidence,
        warnings=warnings,
        system_limits=limits,
        available_actions=_available_actions_for_chat(scope),
        next_step=next_step,
    )


def ask_process_ai(session: Session, process_id: str, prompt: str) -> AIChatResponse:
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")
    documents = session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id)).scalars().all()
    issues = session.execute(select(ValidationIssue).where(ValidationIssue.process_id == process_id)).scalars().all()
    detail = build_process_detail(process, documents, issues)
    provider, runtime_config = _optional_ai_provider(session)
    context = {
        "process": {
            "id": detail.process.id,
            "name": detail.process.name,
            "status": detail.process.status,
            "description": detail.process.description,
        },
        "documents": [
            {
                "file_name": document.file_name,
                "document_kind": document.document_kind,
                "page_count": document.page_count,
            }
            for document in detail.documents[:12]
        ],
        "consolidated_items": [
            {
                "item_number": item.item_number,
                "description": item.raw_description,
                "quantity": item.raw_quantity,
                "unit": item.raw_unit,
                "unit_price": item.raw_unit_price,
                "total": item.raw_total,
                "origin": item.origin,
            }
            for item in detail.consolidated_items[:60]
        ],
        "issues": [
            {
                "severity": issue.severity,
                "title": issue.title,
                "message": issue.message,
            }
            for issue in detail.issues[:20]
        ],
        "analysis_trace": [
            {
                "order": entry.order,
                "stage": entry.stage_code,
                "used_llm": entry.used_llm,
                "summary": entry.logic_summary,
            }
            for entry in detail.analysis_trace
        ],
    }
    if provider is None or runtime_config is None:
        return _build_local_chat_fallback(
            prompt=prompt,
            scope="process",
            detail=detail,
            llm_available=False,
        )
    can_execute, limits, next_step = _system_limits_for_chat(
        prompt=prompt,
        scope="process",
        llm_available=True,
        detail=detail,
    )
    system_prompt = (
        "Eres un asistente de procurement analytics. Responde solo con base en el contexto suministrado. "
        "No inventes cifras, no alteres descripciones fuente y si falta evidencia dilo con claridad. "
        "Debes distinguir entre lo que el sistema puede hacer ahora y lo que no puede ejecutar desde este chat. "
        "Si el usuario pide una accion operativa que este chat no puede ejecutar, indicalo con claridad y ofrece el siguiente paso seguro. "
        "No prometas acciones automáticas inexistentes. "
        "Devuelve JSON con las claves: response, recommended_actions, used_evidence, warnings, "
        "can_execute_requested_action, system_limits, available_actions, next_step."
    )
    user_prompt = (
        f"Consulta del usuario:\n{prompt.strip()}\n\n"
        f"Capacidades disponibles del chat:\n{_available_actions_for_chat('process')}\n\n"
        f"Limites operativos que debes respetar:\n{limits}\n\n"
        f"El indicador inicial can_execute_requested_action debe partir de: {can_execute}\n"
        f"Siguiente paso sugerido preliminar: {next_step}\n\n"
        f"Contexto controlado del proceso:\n{context}"
    )
    try:
        result = provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
    except Exception as exc:
        return _build_local_chat_fallback(
            prompt=prompt,
            scope="process",
            detail=detail,
            llm_available=True,
            error_message=str(exc),
        )
    _log_ai_task(
        session,
        process_id=process_id,
        task_name="process_chat",
        runtime_config=runtime_config,
        prompt_json={"prompt": prompt, "context_scope": "process"},
        result=result,
    )
    payload = _normalize_ai_payload(result.payload, result.content)
    response_text = str(payload.get("response") or result.content or "").strip()
    if not response_text:
        response_text = "La IA no devolvio una respuesta util para esta consulta."
    return AIChatResponse(
        response=response_text,
        used_llm=result.succeeded,
        provider_name=runtime_config.provider_name.value,
        model_name=runtime_config.model_name,
        execution_mode="llm",
        can_execute_requested_action=_coerce_bool(payload.get("can_execute_requested_action"), can_execute),
        recommended_actions=[str(item) for item in payload.get("recommended_actions", []) if str(item).strip()],
        used_evidence=[str(item) for item in payload.get("used_evidence", []) if str(item).strip()],
        warnings=[str(item) for item in payload.get("warnings", []) if str(item).strip()],
        system_limits=_coerce_str_list(payload.get("system_limits")) or limits,
        available_actions=_coerce_str_list(payload.get("available_actions")) or _available_actions_for_chat("process"),
        next_step=str(payload.get("next_step")).strip() if payload.get("next_step") else next_step,
    )


def ask_item_ai(session: Session, process_id: str, normalized_item_id: str, prompt: str) -> AIChatResponse:
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")
    documents = session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id)).scalars().all()
    issues = session.execute(select(ValidationIssue).where(ValidationIssue.process_id == process_id)).scalars().all()
    detail = build_process_detail(process, documents, issues)
    assessment = next((item for item in detail.assessments if item.normalized_item_id == normalized_item_id), None)
    consolidated = next((item for item in detail.consolidated_items if item.normalized_item_id == normalized_item_id), None)
    if assessment is None and consolidated is None:
        raise ValueError("Item not found")
    provider, runtime_config = _optional_ai_provider(session)
    context = {
        "process_name": detail.process.name,
        "item": {
            "normalized_item_id": normalized_item_id,
            "item_number": assessment.item_number if assessment else consolidated.item_number if consolidated else None,
            "description": assessment.raw_description if assessment else consolidated.raw_description if consolidated else None,
            "quantity": assessment.raw_quantity if assessment else consolidated.raw_quantity if consolidated else None,
            "unit": assessment.raw_unit if assessment else consolidated.raw_unit if consolidated else None,
            "reference_unit_price": assessment.price_ref_entity_unit if assessment else consolidated.raw_unit_price if consolidated else None,
            "reference_total": assessment.price_ref_entity_total if assessment else consolidated.raw_total if consolidated else None,
            "origin": assessment.origin if assessment else consolidated.origin if consolidated else None,
            "classification": assessment.classification if assessment else None,
            "explanation": assessment.explanation if assessment else None,
            "benchmark_sources": [
                {
                    "source_name": source.source_name,
                    "country": source.country,
                    "currency": source.currency,
                    "normalized_price_cop": source.normalized_price_cop,
                    "comparability": source.comparability,
                    "presentation": source.commercial_presentation,
                    "url": source.source_url,
                }
                for source in (assessment.benchmark_sources if assessment else [])[:12]
            ],
        },
    }
    if provider is None or runtime_config is None:
        return _build_local_chat_fallback(
            prompt=prompt,
            scope="item",
            detail=detail,
            llm_available=False,
            item_number=assessment.item_number if assessment else consolidated.item_number if consolidated else None,
            item_has_assessment=assessment is not None,
        )
    can_execute, limits, next_step = _system_limits_for_chat(
        prompt=prompt,
        scope="item",
        llm_available=True,
        detail=detail,
        item_has_assessment=assessment is not None,
    )
    system_prompt = (
        "Eres un analista IA para un articulo puntual de un proceso de compra publica. "
        "No inventes datos. Si la evidencia es insuficiente, dilo. "
        "No prometas que el sistema ejecutó una accion si solo puedes recomendarla desde este chat. "
        "Devuelve JSON con las claves: response, recommended_actions, used_evidence, warnings, "
        "can_execute_requested_action, system_limits, available_actions, next_step."
    )
    user_prompt = (
        f"Consulta del usuario para este articulo:\n{prompt.strip()}\n\n"
        f"Capacidades disponibles del chat:\n{_available_actions_for_chat('item')}\n\n"
        f"Limites operativos que debes respetar:\n{limits}\n\n"
        f"El indicador inicial can_execute_requested_action debe partir de: {can_execute}\n"
        f"Siguiente paso sugerido preliminar: {next_step}\n\n"
        f"Contexto controlado:\n{context}"
    )
    try:
        result = provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
    except Exception as exc:
        return _build_local_chat_fallback(
            prompt=prompt,
            scope="item",
            detail=detail,
            llm_available=True,
            item_number=assessment.item_number if assessment else consolidated.item_number if consolidated else None,
            item_has_assessment=assessment is not None,
            error_message=str(exc),
        )
    _log_ai_task(
        session,
        process_id=process_id,
        task_name="item_chat",
        runtime_config=runtime_config,
        prompt_json={"prompt": prompt, "context_scope": "item", "normalized_item_id": normalized_item_id},
        result=result,
    )
    payload = _normalize_ai_payload(result.payload, result.content)
    response_text = str(payload.get("response") or result.content or "").strip()
    if not response_text:
        response_text = "La IA no devolvio una respuesta util para este articulo."
    return AIChatResponse(
        response=response_text,
        used_llm=result.succeeded,
        provider_name=runtime_config.provider_name.value,
        model_name=runtime_config.model_name,
        execution_mode="llm",
        can_execute_requested_action=_coerce_bool(payload.get("can_execute_requested_action"), can_execute),
        recommended_actions=[str(item) for item in payload.get("recommended_actions", []) if str(item).strip()],
        used_evidence=[str(item) for item in payload.get("used_evidence", []) if str(item).strip()],
        warnings=[str(item) for item in payload.get("warnings", []) if str(item).strip()],
        system_limits=_coerce_str_list(payload.get("system_limits")) or limits,
        available_actions=_coerce_str_list(payload.get("available_actions")) or _available_actions_for_chat("item"),
        next_step=str(payload.get("next_step")).strip() if payload.get("next_step") else next_step,
    )


def auto_correct_stage_1(
    session: Session,
    process_id: str,
    *,
    use_ai: bool = True,
    actor: str | None = None,
) -> Stage1AutoFixResponse:
    process = session.get(ProcurementProcess, process_id)
    if process is None:
        raise ValueError("Process not found")

    detail_before = _load_process_detail(session, process_id)

    provider = None
    runtime_config = None
    if use_ai:
        provider, runtime_config = _optional_ai_provider(session)

    memory_reports = (
        session.execute(
            select(ProcessReport)
            .where(ProcessReport.report_type == "stage1_action_memory")
            .order_by(ProcessReport.created_at.desc())
            .limit(5)
        )
        .scalars()
        .all()
    )
    memory_cases = [report.payload_json for report in memory_reports if isinstance(report.payload_json, dict)]

    decision_service = Stage1DecisionService(llm_provider=provider)
    verdict_service = Stage1RedundantVerdictService(llm_provider=provider if use_ai else None)
    orchestrator = Stage1OrchestratorService(
        decision_service=decision_service,
        verdict_service=verdict_service,
        max_iterations=3,
    )

    def apply_actions(actions):
        effective_actions = Stage1OrchestratorService.filter_effective_actions(detail_before if not _apply_state["detail_after"] else _apply_state["detail_after"], actions)
        if not effective_actions:
            return []
        documents = session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id)).scalars().all()
        document_snapshots_before = {
            document.id: dict(document.metadata_json or {})
            for document in documents
        }
        Stage1DecisionService.apply_actions(documents, effective_actions)
        session.flush()
        for action in effective_actions:
            document = next((item for item in documents if item.id == action.document_id), None)
            if document is None:
                continue
            session.add(
                AuditLog(
                    entity_type="process_document",
                    entity_id=document.id,
                    action="stage1_auto_correct",
                    actor=actor,
                    before_json=document_snapshots_before.get(document.id),
                    after_json=dict(document.metadata_json or {}),
                    reason=action.reason,
                )
            )
        return effective_actions

    def rerun_detail():
        run_stage_1(session, process_id, force_ai=use_ai)
        session.flush()
        detail = _load_process_detail(session, process_id)
        _apply_state["detail_after"] = detail
        return detail

    _apply_state = {"detail_after": None}
    orchestration = orchestrator.run(
        detail_before,
        use_ai=use_ai and provider is not None,
        memory_cases=memory_cases,
        apply_actions=apply_actions,
        rerun_detail=rerun_detail,
    )
    detail_after = orchestration["detail_after"]
    meta = orchestration.get("plan_meta", {}) or {}
    used_llm = bool(orchestration.get("used_llm")) or bool(meta.get("used_llm"))
    if runtime_config is not None:
        session.add(
            LLMTaskLog(
                process_id=process_id,
                provider_name=runtime_config.provider_name,
                task_name="stage1_action_planning",
                model_name=runtime_config.model_name,
                prompt_json={
                    "use_ai_requested": use_ai,
                    "documents": len(detail_before.documents),
                    "raw_items": len(detail_before.raw_items),
                    "historical_memory_cases": len(memory_cases),
                    "iterations_requested": 3,
                },
                response_json={
                    "iterations": orchestration.get("iterations", []),
                    "actions": orchestration.get("actions_applied", []),
                    "meta": meta,
                    "final_verdict": orchestration.get("final_verdict", {}),
                    "stop_reason": orchestration.get("stop_reason"),
                },
                estimated_cost_usd=0,
                succeeded=used_llm,
                error_message=None if used_llm else "LLM not used or no actions suggested by LLM.",
            )
        )

    before_metrics = detail_before.stage_summaries[0].metrics if detail_before.stage_summaries else {}
    after_metrics = detail_after.stage_summaries[0].metrics if detail_after.stage_summaries else {}
    before_score = detail_before.stage_summaries[0].consistency_score if detail_before.stage_summaries else None
    after_score = detail_after.stage_summaries[0].consistency_score if detail_after.stage_summaries else None
    stage_status_after = detail_after.stage_summaries[0].status if detail_after.stage_summaries else None
    blockers_after = detail_after.stage_summaries[0].blocking_reasons if detail_after.stage_summaries else []
    iterations = orchestration.get("iterations", [])
    actions_applied = orchestration.get("actions_applied", [])
    final_verdict = orchestration.get("final_verdict", {})
    memory_payload = {
        "process_id": process_id,
        "process_name": process.name,
        "created_at": datetime.now(UTC).isoformat(),
        "use_ai_requested": use_ai,
        "used_llm": used_llm,
        "actions_applied": actions_applied,
        "iterations": iterations,
        "stop_reason": orchestration.get("stop_reason"),
        "final_verdict": final_verdict,
        "before_metrics": before_metrics,
        "after_metrics": after_metrics,
        "before_score": before_score,
        "after_score": after_score,
        "stage_status_after": stage_status_after,
        "blockers_after": blockers_after,
        "lesson": _build_stage1_lesson(actions_applied, detail_before, detail_after),
    }
    session.add(
        ProcessReport(
            process_id=process_id,
            report_type="stage1_action_memory",
            title="Memoria resumida de autocorreccion de etapa 1",
            payload_json=memory_payload,
        )
    )

    summary = _build_stage1_summary(
        actions_applied,
        detail_before,
        detail_after,
        used_llm=used_llm,
        iterations=iterations,
        final_verdict=final_verdict,
    )
    refreshed_process = session.get(ProcurementProcess, process_id) or process
    process_metadata = dict(refreshed_process.metadata_json or {})
    process_metadata["stage1_last_auto_fix"] = {
        "summary": summary,
        "used_llm": used_llm,
        "provider_name": runtime_config.provider_name.value if runtime_config and used_llm else None,
        "model_name": runtime_config.model_name if runtime_config and used_llm else None,
        "actions_applied": actions_applied,
        "before_metrics": before_metrics,
        "after_metrics": after_metrics,
        "before_score": before_score,
        "after_score": after_score,
        "stage_status_after": stage_status_after,
        "blockers_after": blockers_after,
        "iterations": iterations,
        "stop_reason": orchestration.get("stop_reason"),
        "redundant_verdict": final_verdict,
    }
    process_metadata["stage1_redundant_verdict"] = {
        **final_verdict,
        "iterations_run": len(iterations),
        "stop_reason": orchestration.get("stop_reason"),
    }
    refreshed_process.metadata_json = process_metadata
    session.flush()

    return Stage1AutoFixResponse(
        process_id=process_id,
        actions_applied=actions_applied,
        used_llm=used_llm,
        provider_name=runtime_config.provider_name.value if runtime_config and used_llm else None,
        model_name=runtime_config.model_name if runtime_config and used_llm else None,
        summary=summary,
        before_score=before_score,
        after_score=after_score,
        stage_status_after=stage_status_after,
        blockers_after=blockers_after,
        iterations=iterations,
        stop_reason=orchestration.get("stop_reason"),
        redundant_verdict=final_verdict,
    )


def _build_stage1_summary(
    actions,
    detail_before,
    detail_after,
    *,
    used_llm: bool,
    iterations=None,
    final_verdict: dict | None = None,
) -> str:
    before_metrics = detail_before.stage_summaries[0].metrics if detail_before.stage_summaries else {}
    after_metrics = detail_after.stage_summaries[0].metrics if detail_after.stage_summaries else {}
    before_rows = int(before_metrics.get("raw_items", 0) or 0)
    after_rows = int(after_metrics.get("raw_items", 0) or 0)
    before_noise = int(before_metrics.get("suspected_noise_rows", 0) or 0)
    after_noise = int(after_metrics.get("suspected_noise_rows", 0) or 0)
    channel = "con apoyo IA" if used_llm else "solo con reglas"
    iteration_count = len(iterations or [])
    verdict = final_verdict or {}
    if not actions:
        return (
            f"El motor de decisiones reviso la etapa 1 {channel}, pero no encontro una accion segura para aplicar. "
            f"Se conservo la configuracion actual y la compuerta final quedo en {verdict.get('final_decision', 'review_required')}."
        )
    return (
        f"Se aplicaron {len(actions)} accion(es) de etapa 1 {channel} en {iteration_count or 1} iteracion(es). "
        f"Las filas RAW pasaron de {before_rows} a {after_rows}, las filas sospechosas de ruido pasaron de {before_noise} a {after_noise} "
        f"y la compuerta final quedo en {verdict.get('final_decision', 'review_required')}."
    )


def _build_stage1_lesson(actions, detail_before, detail_after) -> str:
    before_metrics = detail_before.stage_summaries[0].metrics if detail_before.stage_summaries else {}
    after_metrics = detail_after.stage_summaries[0].metrics if detail_after.stage_summaries else {}
    action_labels = ", ".join(
        sorted(
            {
                action.get("action_type") if isinstance(action, dict) else getattr(action, "action_type", None)
                for action in actions
            }
            - {None}
        )
    ) or "sin cambios"
    return (
        "Caso de etapa 1. "
        f"Antes: {before_metrics}. "
        f"Despues: {after_metrics}. "
        f"Acciones utiles: {action_labels}."
    )


def _mask_api_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def _default_provider_config() -> ProviderConfigUpsert:
    settings = get_settings()
    provider_name = settings.llm_provider.lower()
    return ProviderConfigUpsert(
        provider_name=provider_name,
        base_url=settings.llm_base_url,
        model_name=settings.llm_model,
        api_key=settings.llm_api_key or None,
        enabled=provider_name != "disabled",
        timeout_seconds=settings.llm_timeout_seconds,
        max_task_budget_usd=settings.llm_max_task_budget_usd,
        max_process_budget_usd=settings.llm_max_process_budget_usd,
        estimated_input_token_price=settings.llm_estimated_input_token_price,
        estimated_output_token_price=settings.llm_estimated_output_token_price,
        extra_headers={},
    )


def get_provider_config(session: Session) -> ProviderConfigRead:
    stored = session.scalar(select(ProviderConfig).limit(1))
    if stored is None:
        default_config = _default_provider_config()
        return ProviderConfigRead(
            id="default",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            provider_name=default_config.provider_name,
            base_url=default_config.base_url,
            model_name=default_config.model_name,
            enabled=default_config.enabled,
            has_api_key=bool(default_config.api_key),
            api_key_masked=_mask_api_key(default_config.api_key),
            config_json=default_config.model_dump(exclude={"provider_name", "base_url", "model_name", "enabled", "api_key"}),
        )
    api_key = stored.config_json.get("api_key")
    return ProviderConfigRead(
        id=stored.id,
        created_at=stored.created_at,
        updated_at=stored.updated_at,
        provider_name=stored.provider_name,
        base_url=stored.base_url,
        model_name=stored.model_name,
        enabled=stored.enabled,
        has_api_key=bool(api_key),
        api_key_masked=_mask_api_key(api_key),
        config_json={k: v for k, v in stored.config_json.items() if k != "api_key"},
    )


def save_provider_config(session: Session, payload: ProviderConfigUpsert) -> ProviderConfigRead:
    stored = session.scalar(select(ProviderConfig).limit(1))
    config_json = {
        "api_key": payload.api_key or "",
        "timeout_seconds": payload.timeout_seconds,
        "max_task_budget_usd": payload.max_task_budget_usd,
        "max_process_budget_usd": payload.max_process_budget_usd,
        "estimated_input_token_price": payload.estimated_input_token_price,
        "estimated_output_token_price": payload.estimated_output_token_price,
        "extra_headers": payload.extra_headers,
    }
    if stored is None:
        stored = ProviderConfig(
            provider_name=payload.provider_name,
            base_url=payload.base_url,
            model_name=payload.model_name,
            enabled=payload.enabled,
            config_json=config_json,
        )
        session.add(stored)
    else:
        stored.provider_name = payload.provider_name
        stored.base_url = payload.base_url
        stored.model_name = payload.model_name
        stored.enabled = payload.enabled
        stored.config_json = config_json
    session.flush()
    return get_provider_config(session)


def _runtime_config_from_payload(payload: ProviderConfigUpsert) -> LLMRuntimeConfig:
    return LLMRuntimeConfig(
        provider_name=payload.provider_name,
        base_url=payload.base_url or "",
        api_key=payload.api_key or "",
        model_name=payload.model_name or "",
        timeout_seconds=payload.timeout_seconds,
        max_task_budget_usd=payload.max_task_budget_usd,
        estimated_input_token_price=payload.estimated_input_token_price,
        estimated_output_token_price=payload.estimated_output_token_price,
        extra_headers={str(k): str(v) for k, v in payload.extra_headers.items()},
    )


def run_provider_connection_test(session: Session, payload: ProviderConfigUpsert) -> LLMConnectionTestResult:
    runtime_config = _runtime_config_from_payload(payload)
    provider = get_llm_provider(runtime_config)
    result = provider.complete_json(
        system_prompt="Eres un verificador de conectividad. Siempre respondes JSON valido.",
        user_prompt='Devuelve {"status":"ok","provider":"reachable"}',
    )
    session.add(
        LLMTaskLog(
            provider_name=payload.provider_name,
            task_name="connection_test",
            model_name=payload.model_name or "unknown",
            prompt_json={"type": "connection_test"},
            response_json=result.payload,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            estimated_cost_usd=result.estimated_cost_usd,
            succeeded=result.succeeded,
            error_message=result.error_message,
        )
    )
    session.flush()
    return LLMConnectionTestResult(
        provider_name=payload.provider_name,
        model_name=payload.model_name or "unknown",
        succeeded=result.succeeded,
        estimated_cost_usd=result.estimated_cost_usd,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        content_preview=(result.content[:180] if result.content else None),
        error_message=result.error_message,
    )


def dashboard_summary(session: Session) -> DashboardSummary:
    total_processes = session.scalar(select(func.count(ProcurementProcess.id))) or 0
    analyzed_processes = session.scalar(
        select(func.count(ProcurementProcess.id)).where(ProcurementProcess.status == ProcessStatus.ANALYZED)
    ) or 0
    total_items = session.scalar(select(func.count(ExtractedItemRaw.id))) or 0
    open_issues = session.scalar(
        select(func.count(ValidationIssue.id)).where(ValidationIssue.status == ReviewStatus.PENDING)
    ) or 0
    counts = {
        row[0].value: row[1]
        for row in session.execute(
            select(FinancialAssessment.classification, func.count(FinancialAssessment.id)).group_by(FinancialAssessment.classification)
        ).all()
    }
    return DashboardSummary(
        total_processes=total_processes,
        analyzed_processes=analyzed_processes,
        total_items=total_items,
        open_issues=open_issues,
        classification_counts=counts,
    )
