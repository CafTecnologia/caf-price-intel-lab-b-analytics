from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from procurement_api.auth import AuthUser, get_current_user, require_roles
from procurement_api.db import get_db, init_db
from procurement_api.presenters import build_process_detail
from procurement_api.services import (
    analyze_process,
    auto_correct_stage_1,
    ask_item_ai,
    ask_process_ai,
    create_process,
    dashboard_summary,
    delete_process,
    get_provider_config,
    reanalyze_process,
    register_document,
    run_provider_connection_test,
    run_stage_1_with_summary,
    save_provider_config,
)
from procurement_api.worker import analyze_process_task
from procurement_core.config import get_settings
from procurement_core.models.orm import (
    ProcessDocument,
    ProcurementProcess,
    ValidationIssue,
)
from procurement_core.schemas.process import (
    DocumentRead,
    ProcessDetail,
    ProcessCreate,
    ProcessRead,
)
from procurement_core.schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    DeleteProcessResponse,
    Stage1AutoFixRequest,
    Stage1AutoFixResponse,
    Stage1RunResponse,
)
from procurement_core.schemas.provider import (
    LLMConnectionTestRequest,
    LLMConnectionTestResult,
    ProviderConfigRead,
    ProviderConfigUpsert,
)


settings = get_settings()
app = FastAPI(title="Procurement Analytics API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/dashboard")
def get_dashboard(
    _: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    return dashboard_summary(session)


@app.get("/api/v1/llm/config", response_model=ProviderConfigRead)
def get_llm_config(
    _: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    return get_provider_config(session)


@app.put("/api/v1/llm/config", response_model=ProviderConfigRead)
def put_llm_config(
    payload: ProviderConfigUpsert,
    _: AuthUser = Depends(require_roles("administrator", "manager", "analyst")),
    session: Session = Depends(get_db),
):
    config = save_provider_config(session, payload)
    session.commit()
    return config


@app.post("/api/v1/llm/test", response_model=LLMConnectionTestResult)
def post_llm_test(
    payload: LLMConnectionTestRequest,
    _: AuthUser = Depends(require_roles("administrator", "manager", "analyst")),
    session: Session = Depends(get_db),
):
    result = run_provider_connection_test(session, payload.config)
    session.commit()
    return result


@app.post("/api/v1/processes", response_model=ProcessRead)
def post_process(
    payload: ProcessCreate,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    process = create_process(session, payload)
    session.commit()
    session.refresh(process)
    return process


@app.get("/api/v1/processes", response_model=list[ProcessRead])
def list_processes(
    _: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    return session.execute(select(ProcurementProcess).order_by(ProcurementProcess.created_at.desc())).scalars().all()


@app.get("/api/v1/processes/{process_id}", response_model=ProcessDetail)
def get_process(
    process_id: str,
    _: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    process = session.get(ProcurementProcess, process_id)
    if not process:
        raise HTTPException(status_code=404, detail="Process not found")
    documents = session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id)).scalars().all()
    issues = session.execute(select(ValidationIssue).where(ValidationIssue.process_id == process_id)).scalars().all()
    return build_process_detail(process, documents, issues)


@app.delete("/api/v1/processes/{process_id}", response_model=DeleteProcessResponse)
def remove_process(
    process_id: str,
    user: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    result = delete_process(session, process_id, actor=user.username)
    session.commit()
    return result


@app.post("/api/v1/processes/{process_id}/documents", response_model=DocumentRead)
async def upload_document(
    process_id: str,
    upload: UploadFile = File(...),
    _: AuthUser = Depends(require_roles("administrator", "analyst", "reviewer")),
    session: Session = Depends(get_db),
):
    process = session.get(ProcurementProcess, process_id)
    if not process:
        raise HTTPException(status_code=404, detail="Process not found")
    content = await upload.read()
    document = register_document(session, process_id, upload.filename, content)
    session.commit()
    session.refresh(document)
    return document


@app.post("/api/v1/processes/{process_id}/analyze")
def trigger_analysis(
    process_id: str,
    async_mode: bool = True,
    force_ai: bool = False,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    if async_mode and not settings.celery_task_always_eager:
        task = analyze_process_task.delay(process_id)
        return {"status": "queued", "task_id": task.id, "force_ai": force_ai}
    result = analyze_process(session, process_id, force_ai=force_ai)
    session.commit()
    return {"status": "completed", "result": result}


@app.post("/api/v1/processes/{process_id}/reanalyze")
def trigger_reanalysis(
    process_id: str,
    async_mode: bool = True,
    force_ai: bool = False,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    if async_mode and not settings.celery_task_always_eager:
        task = analyze_process_task.delay(process_id)
        return {"status": "queued", "task_id": task.id, "mode": "reanalyze", "force_ai": force_ai}
    result = reanalyze_process(session, process_id, force_ai=force_ai)
    session.commit()
    return {"status": "completed", "mode": "reanalyze", "result": result}


@app.post("/api/v1/processes/{process_id}/stage-1/run", response_model=Stage1RunResponse)
def trigger_stage_1_run(
    process_id: str,
    force_ai: bool = False,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    try:
        result = run_stage_1_with_summary(session, process_id, force_ai=force_ai)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return result


@app.post("/api/v1/processes/{process_id}/stage-1/auto-correct", response_model=Stage1AutoFixResponse)
def trigger_stage_1_auto_correct(
    process_id: str,
    payload: Stage1AutoFixRequest,
    user: AuthUser = Depends(require_roles("administrator", "analyst", "manager")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    try:
        result = auto_correct_stage_1(
            session,
            process_id,
            use_ai=payload.use_ai,
            actor=user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return result


@app.post("/api/v1/processes/{process_id}/ai/chat", response_model=AIChatResponse)
def process_ai_chat(
    process_id: str,
    payload: AIChatRequest,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager", "reviewer")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    try:
        response = ask_process_ai(session, process_id, payload.prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return response


@app.post("/api/v1/processes/{process_id}/items/{normalized_item_id}/ai/chat", response_model=AIChatResponse)
def item_ai_chat(
    process_id: str,
    normalized_item_id: str,
    payload: AIChatRequest,
    _: AuthUser = Depends(require_roles("administrator", "analyst", "manager", "reviewer")),
    session: Session = Depends(get_db),
):
    if not session.get(ProcurementProcess, process_id):
        raise HTTPException(status_code=404, detail="Process not found")
    try:
        response = ask_item_ai(session, process_id, normalized_item_id, payload.prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return response
