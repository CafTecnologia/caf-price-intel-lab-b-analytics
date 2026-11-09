"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, CircleHelp,
  Clock3, Database, ExternalLink, FileSearch, FileSpreadsheet, Files, FolderOpen, FolderSearch, GitBranch,
  History, House, Info, LoaderCircle, MessageSquareText, Play, RefreshCw, Search, Settings2, ShieldCheck,
  Trash2, Upload, X, XCircle
} from "lucide-react";
import type { ReactNode } from "react";
import { DOCUMENT_INTAKE_PROFILES } from "@/lib/document-intake-contract";
import type { AgentItem, AgentRun, AgentStep, Confidence, Decision, HumanCorrection, ItemAssistantExchange, LearningContext, ProviderId, StageId } from "@/lib/types";

type ProviderHealth = {
  ok: boolean;
  status: string;
  error?: string;
  checkedAt?: string;
  diagnostic?: {
    code: string;
    title: string;
    detail: string;
    userAction: string;
    recoverable: boolean;
  };
  provider: { id: ProviderId; label: string; description: string; capabilities: string[] };
  worker?: { engine?: string; status?: string; activeJobId?: string | null };
};

type OdooDriveFile = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const SUPPORTED_DRIVE_EXTENSIONS = [
  ".xlsx", ".xls", ".csv", ".json",
  ".pdf", ".docx", ".doc", ".pptx", ".ppt",
  ".png", ".jpg", ".jpeg", ".tif", ".tiff",
  ".odt", ".ods", ".odp", ".txt", ".md", ".html", ".htm"
];
const DOCUMENT_UPLOAD_ACCEPT = SUPPORTED_DRIVE_EXTENSIONS.join(",");

function isSupportedDriveFile(file: OdooDriveFile) {
  const name = file.name.toLowerCase();
  return SUPPORTED_DRIVE_EXTENSIONS.some((extension) => name.endsWith(extension))
    || [
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.presentation"
    ].includes(file.mimeType);
}

function responseFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

type OdooLaunch = {
  externalApp?: string;
  analysisRecordId?: string;
  name?: string;
  sourceTitle?: string;
  odooProjectId?: string;
  odooCallbackUrl?: string;
  odooReturnUrl?: string;
  odooDb?: string;
  project?: {
    id: string;
    name: string;
    processNumber?: string;
    entity?: string;
    driveFolderUrl?: string;
  };
  drive?: {
    status: "ready" | "missing_project" | "missing_folder" | "not_configured" | "error";
    message: string;
    files: OdooDriveFile[];
  };
};

type OdooBridgeState = {
  launchToken: string;
  odooBaseUrl: string;
  odooDb: string;
  launch: OdooLaunch | null;
  loading: boolean;
  error: string;
};

const DOCUMENT_STAGE: { id: StageId; short: string; title: string; purpose: string } =
  { id: "source", short: "0", title: "Documentos", purpose: "Seleccionar evidencia y preparar los ítems" };
const PIPELINE_STAGES: Array<{ id: StageId; short: string; title: string; purpose: string }> = [
  { id: "extraction", short: "1", title: "Extracción", purpose: "Normalizar sin reinterpretar" },
  { id: "technical", short: "2", title: "Técnico", purpose: "Separar requisitos y dudas" },
  { id: "market", short: "3", title: "Mercado", purpose: "Buscar candidatos comerciales" },
  { id: "supervision", short: "4", title: "Supervisión", purpose: "Contrastar precio y soporte" }
];
const STAGES = [DOCUMENT_STAGE, ...PIPELINE_STAGES];
type ItemFilter = "all" | "candidate" | "decision" | "no_candidate" | "unprocessed" | "ready" | "reviewed" | "excluded";
type UiItemState = "ready" | "decision" | "no_candidate" | "unprocessed" | "excluded";

const APP_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
function appPath(pathname: string) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${APP_BASE_PATH}${path}`;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function runProjectCode(run: AgentRun) {
  const source = cleanText(run.origin?.odooProjectName || run.name);
  return source.match(/^\[([^\]]+)\]/)?.[1]
    || source.match(/\b([A-Z]{2,}(?:-[A-Z0-9Ñ]+){2,})\b/)?.[1]
    || "";
}

function sentenceCaseIfUpper(value: string) {
  const letters = value.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || [];
  const uppercase = value.match(/[A-ZÁÉÍÓÚÜÑ]/g) || [];
  if (!letters.length || uppercase.length / letters.length < 0.78) return value;
  const lowered = value.toLocaleLowerCase("es-CO");
  return lowered.charAt(0).toLocaleUpperCase("es-CO") + lowered.slice(1);
}

function compactProjectTitle(value: string) {
  const original = cleanText(value);
  const code = original.match(/^\[([^\]]+)\]/)?.[1]
    || original.match(/\b([A-Z]{2,}(?:-[A-Z0-9Ñ]+){2,})\b/)?.[1]
    || "";
  let remainder = original
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+[·]\s+[^·]+\.(?:xlsx?|csv|json)$/i, "");
  if (code) remainder = remainder.replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-·:]?\\s*`, "i"), "");
  const parts = remainder.split(/\s+-\s+/).map(cleanText).filter(Boolean);
  const subject = sentenceCaseIfUpper(parts.at(-1) || remainder || original);
  const concise = code && !subject.toLocaleLowerCase("es-CO").startsWith(code.toLocaleLowerCase("es-CO"))
    ? `${code} · ${subject}`
    : subject;
  return concise.length > 92 ? `${concise.slice(0, 89).trimEnd()}...` : concise;
}

function humanRunTitle(run: AgentRun) {
  return compactProjectTitle(run.origin?.odooProjectName || run.name || run.inventory.fileName);
}

function itemHasCandidate(item: AgentItem) {
  return Boolean(item.market?.supplier?.trim())
    && item.market?.price !== null
    && item.market?.price !== undefined
    && Number.isFinite(Number(item.market.price));
}

function uiItemState(item: AgentItem): UiItemState {
  if (item.status === "excluded") return "excluded";
  if (itemHasCandidate(item)) {
    return ["accept", "accept_with_note"].includes(effectiveDecision(item)) ? "ready" : "decision";
  }
  if (!item.normalized || !item.technical) return "unprocessed";
  return "no_candidate";
}

function runUiSummary(run: AgentRun) {
  const active = run.items.filter((item) => item.status !== "excluded");
  const count = (state: UiItemState) => active.filter((item) => uiItemState(item) === state).length;
  const ready = count("ready");
  const decision = count("decision");
  const noCandidate = count("no_candidate");
  const unprocessed = count("unprocessed");
  const candidates = ready + decision;
  const reviewed = active.filter((item) => item.reviews.length > 0).length;
  const documents = run.documentIntake?.documents || [];
  const selectedDocuments = documents.filter((document) => document.selected);
  const directlyContributingDocuments = selectedDocuments.filter((document) => document.candidateItems > 0);
  const legacyDocumentCoverage = (run.documentIntake?.coverage.extractedItems || run.inventory.detectedRows || 0) > 0
    && directlyContributingDocuments.length === 0;

  return {
    total: active.length,
    ready,
    decision,
    noCandidate,
    unprocessed,
    unresolved: decision + noCandidate + unprocessed,
    candidates,
    reviewed,
    excluded: run.items.length - active.length,
    documents: {
      total: documents.length,
      selected: selectedDocuments.length,
      contributing: legacyDocumentCoverage ? selectedDocuments.length : directlyContributingDocuments.length,
      attention: legacyDocumentCoverage ? 0 : selectedDocuments.filter((document) => document.candidateItems === 0).length,
      deferred: documents.filter((document) => document.processingMode === "deferred").length
    }
  };
}

function incompleteAtActiveStage(run: AgentRun) {
  const active = run.items.filter((item) => item.status !== "excluded");
  if (run.activeStage === "extraction") return active.filter((item) => !item.normalized).length;
  if (run.activeStage === "technical") return active.filter((item) => !item.technical).length;
  if (run.activeStage === "market") return active.filter((item) => !itemHasCandidate(item)).length;
  if (run.activeStage === "supervision") return active.filter((item) => !item.supervisedAt).length;
  return 0;
}

function runProgress(run: AgentRun, forceRunning = false) {
  const summary = runUiSummary(run);
  const stageIncomplete = incompleteAtActiveStage(run);
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === run.activeStage));
  const currentStage = STAGES[currentIndex] || STAGES[0];
  const currentSteps = run.steps.filter((step) => step.stage === run.activeStage);
  const latestStep = currentSteps.at(-1);
  const isRunning = run.status === "running" || forceRunning;
  const isFinished = run.status === "completed" || run.status === "needs_review";
  const percent = isFinished
    ? 100
    : run.status === "draft" && !forceRunning
      ? 0
      : Math.min(99, Math.round(((currentIndex + (isRunning ? 0.5 : 0)) / STAGES.length) * 100));
  const label = run.status === "completed"
    ? "Ejecución terminada"
    : run.status === "needs_review"
      ? "Ejecución terminada"
      : run.status === "failed"
        ? `${currentStage.title} interrumpida`
        : isRunning
          ? `${currentStage.title} en curso`
          : "Listo para iniciar";
  const detail = run.status === "completed" || run.status === "needs_review"
    ? `${summary.candidates} de ${summary.total} ítems tienen candidato comercial; ${summary.decision} requieren decisión y ${summary.noCandidate} no tienen candidato.`
      : run.status === "failed"
        ? `La ejecución se detuvo en ${currentStage.title}. ${stageIncomplete} ${stageIncomplete === 1 ? "ítem quedó" : "ítems quedaron"} sin completar esta parte.`
        : isRunning
          ? `El agente está trabajando en ${currentStage.title.toLocaleLowerCase("es-CO")}.`
          : "El análisis aún no ha comenzado.";
  return {
    percent,
    label,
    detail,
    activity: latestStep?.title.replace(/\s*·\s*/g, " · ") || "",
    display: isFinished ? `${STAGES.length}/${STAGES.length}` : `${currentIndex + 1}/${STAGES.length}`
  };
}

export default function Home() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [stageFilter, setStageFilter] = useState<StageId | "all">("all");
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [recoveringProvider, setRecoveringProvider] = useState<ProviderId | null>(null);
  const [odooBridge, setOdooBridge] = useState<OdooBridgeState | null>(null);
  const [viewMode, setViewMode] = useState<"work" | "advanced">("work");

  const selected = useMemo(() => runs.find((run) => run.id === selectedId) || null, [runs, selectedId]);
  const selectedItem = selected?.items.find((item) => item.id === selectedItemId) || null;
  const selectedQueue = selected ? visibleItems(selected, itemFilter, query, viewMode === "work") : [];
  const selectedQueueIndex = selectedQueue.findIndex((item) => item.id === selectedItemId);
  const selectedPreviousItem = selectedQueueIndex > 0 ? selectedQueue[selectedQueueIndex - 1] : undefined;
  const selectedNextItem = selectedQueueIndex >= 0 ? selectedQueue[selectedQueueIndex + 1] : selectedQueue[0];

  useEffect(() => {
    setShowTrace(false);
    setSelectedItemId("");
    setItemFilter("all");
    setQuery("");
  }, [selectedId]);

  useEffect(() => {
    const saved = window.localStorage.getItem("caf-procurement-view");
    if (saved === "advanced" || saved === "work") setViewMode(saved);
  }, []);

  function changeViewMode(mode: "work" | "advanced") {
    setViewMode(mode);
    window.localStorage.setItem("caf-procurement-view", mode);
    setShowTrace(false);
    setStageFilter("all");
  }

  const refresh = useCallback(async () => {
    const [runResponse, providerResponse] = await Promise.all([fetch(appPath("/api/runs"), { cache: "no-store" }), fetch(appPath("/api/providers"), { cache: "no-store" })]);
    const runData = await runResponse.json();
    const providerData = await providerResponse.json();
    setRuns(runData.runs || []);
    setProviders(providerData.providers || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const launchToken = params.get("launchToken")?.trim();
    const odooBaseUrl = params.get("odooBaseUrl")?.trim().replace(/\/+$/, "");
    const odooDb = params.get("odooDb")?.trim() || "";
    if (!launchToken || !odooBaseUrl) return;

    const bridge: OdooBridgeState = {
      launchToken,
      odooBaseUrl,
      odooDb,
      launch: null,
      loading: true,
      error: ""
    };
    setOdooBridge(bridge);
    const query = new URLSearchParams({
      baseUrl: odooBaseUrl,
      db: odooDb,
      token: launchToken
    });
    void fetch(appPath(`/api/odoo/launch?${query.toString()}`), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.launch) throw new Error(payload.error || "Odoo no devolvió el contexto del proyecto.");
        setOdooBridge({ ...bridge, launch: payload.launch, loading: false });
      })
      .catch((cause) => setOdooBridge({ ...bridge, loading: false, error: cause instanceof Error ? cause.message : String(cause) }));
  }, []);

  const refreshProviders = useCallback(async () => {
    const response = await fetch(appPath("/api/providers"), { cache: "no-store" });
    const data = await response.json();
    if (data.providers) setProviders(data.providers);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refreshProviders(), 15000);
    return () => clearInterval(timer);
  }, [refreshProviders]);

  useEffect(() => {
    if (!executing || !selectedId) return;
    const timer = setInterval(async () => {
      const response = await fetch(appPath(`/api/runs/${selectedId}`), { cache: "no-store" });
      const data = await response.json();
      if (data.run) {
        setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
        if (data.run.status !== "running") setExecuting(false);
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [executing, selectedId]);

  async function createDemo(providerId: ProviderId = "mock") {
    setCreating(true); setError("");
    try {
      const response = await fetch(appPath("/api/runs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixture: "licitacion-papeleria-12.json", providerId, batchSize: 6, name: "Papelería · caso de control" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRuns((current) => [data.run, ...current]);
      setSelectedId(data.run.id);
      setShowNew(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCreating(false); }
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true); setError("");
    try {
      const response = await fetch(appPath("/api/runs"), { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRuns((current) => [body.run, ...current]);
      setSelectedId(body.run.id);
      setShowNew(false);
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCreating(false); }
  }

  async function execute(providerId: ProviderId) {
    if (!selected) return;
    setExecuting(true); setError("");
    void fetch(appPath(`/api/runs/${selected.id}/execute`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setExecuting(false));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await refresh();
  }

  async function rewind(stage: StageId) {
    if (!selected) return;
    const response = await fetch(appPath(`/api/runs/${selected.id}/rewind`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) });
    const data = await response.json();
    if (data.run) setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
  }

  async function recover(id: ProviderId) {
    setRecoveringProvider(id);
    setError("");
    try {
      const response = await fetch(appPath(`/api/providers/${id}/recover`), { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.recovery?.error || data.diagnostic?.detail || data.error || "No fue posible recuperar el proveedor.");
      await refreshProviders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refreshProviders();
    } finally {
      setRecoveringProvider(null);
    }
  }

  if (loading) return <div className="boot"><LoaderCircle className="spin" /> Preparando laboratorio…</div>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-home" onClick={() => { setSelectedId(""); setSelectedItemId(""); }} aria-label="Ir al inicio">
          <span className="brand-mark"><Bot size={22} /></span>
          <span className="brand-copy"><strong>Laboratorio agéntico de compras</strong><small>Extracción, criterio técnico y mercado con historia verificable</small></span>
        </button>
        <div className="top-actions">
          <a className="button ghost" href={appPath(`/profiles${typeof window !== "undefined" ? window.location.search : ""}`)}><Bot size={16} /> Perfiles IA</a>
          {selected && <button className={`view-mode-button ${viewMode}`} onClick={() => changeViewMode(viewMode === "work" ? "advanced" : "work")}>
            {viewMode === "work" ? <Settings2 size={16} /> : <House size={16} />}
            {viewMode === "work" ? "Vista avanzada" : "Volver a trabajo"}
          </button>}
          {selected && <button className="button ghost" onClick={() => { setSelectedId(""); setSelectedItemId(""); }}><House size={16} /> Inicio</button>}
          {selected && <button className="button secondary" onClick={() => setShowNew(true)}><Upload size={16} /> Cargar archivo</button>}
        </div>
      </header>

      {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span><button aria-label="Cerrar" onClick={() => setError("")}><X size={16} /></button></div>}

      {showNew && <NewProcessDialog providers={providers} busy={creating} onClose={() => setShowNew(false)} onUpload={uploadFile} onDemo={createDemo} />}

      {!selected ? <StartHome
        runs={runs}
        busy={creating}
        onNew={() => setShowNew(true)}
        onDemo={() => void createDemo()}
        onSelect={(runId) => { setSelectedId(runId); setSelectedItemId(""); }}
        projectBridge={odooBridge ? <OdooProjectBridge
          bridge={odooBridge}
          providers={providers}
          busy={creating}
          onImported={(run) => {
            setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
            setSelectedId(run.id);
          }}
          onBusy={setCreating}
          onError={setError}
        /> : null}
      /> : <div className="workspace">
        <aside className="run-rail">
          <div className="rail-heading"><span>Análisis</span><span>{runs.length}</span></div>
          {runs.length === 0 ? (
            <div className="empty-rail"><FileSpreadsheet size={30} /><p>Aún no hay análisis.</p><button className="button primary" onClick={() => void createDemo()}>Abrir caso de control</button></div>
          ) : runs.map((run) => (
            <button key={run.id} className={`run-link ${run.id === selected?.id ? "active" : ""}`} onClick={() => { setSelectedId(run.id); setSelectedItemId(""); }}>
              <span className={`status-dot ${run.status}`} />
              <span><strong title={run.name}>{humanRunTitle(run)}</strong><small>{runUiSummary(run).candidates}/{runUiSummary(run).total} con candidato · {runProgress(run).label}</small></span>
            </button>
          ))}
          {viewMode === "advanced" && <ProviderMiniList providers={providers} recovering={recoveringProvider} onRecover={recover} />}
        </aside>

        <section className="main-pane">
          {viewMode === "advanced" ? <>
            <RunHeader
              run={selected}
              providers={providers}
              recovering={recoveringProvider}
              executing={executing || selected.status === "running"}
              onExecute={execute}
              onRecover={recover}
              onReview={() => {
                const summary = runUiSummary(selected);
                const nextFilter: ItemFilter = summary.decision > 0 ? "decision" : summary.noCandidate > 0 ? "no_candidate" : summary.unprocessed > 0 ? "unprocessed" : "ready";
                setItemFilter(nextFilter);
                setQuery("");
                const first = visibleItems(selected, nextFilter, "", true)[0];
                if (first) {
                  setSelectedItemId(first.id);
                  setShowTrace(true);
                }
              }}
            />
            <DocumentIntakeStage
              run={selected}
              inspecting={stageFilter === "source"}
              onInspect={() => {
                const next = stageFilter === "source" ? "all" : "source";
                setStageFilter(next);
                setShowTrace(next === "source");
              }}
            />
            <StageMap run={selected} activeFilter={stageFilter} onFilter={(value) => { setStageFilter(value); setShowTrace(value !== "all"); }} onRewind={rewind} />
            <div className={`content-grid ${!selectedItem && !showTrace ? "single" : ""}`}>
              <section className="data-section">
                <ItemToolbar run={selected} filter={itemFilter} onFilter={setItemFilter} query={query} onQuery={setQuery} onOpenTrace={() => setShowTrace(true)} />
                <ItemTableV2 run={selected} filter={itemFilter} query={query} onSelect={(itemId) => { setSelectedItemId(itemId); setShowTrace(true); }} selectedId={selectedItemId} />
              </section>
              {(selectedItem || showTrace) && <aside className="trace-pane">
                {selectedItem ? <ItemInspectorV2 key={selectedItem.id} run={selected} item={selectedItem} queuePosition={selectedQueueIndex + 1} queueTotal={selectedQueue.length} onPrevious={selectedPreviousItem ? () => setSelectedItemId(selectedPreviousItem.id) : undefined} onNext={selectedNextItem ? () => setSelectedItemId(selectedNextItem.id) : undefined} onClose={() => { setSelectedItemId(""); setShowTrace(false); }} onUpdated={(run) => setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)])} /> : <RunTrace run={selected} stageFilter={stageFilter} onClose={() => { setShowTrace(false); setStageFilter("all"); }} />}
              </aside>}
            </div>
          </> : <WorkView
            run={selected}
            providers={providers}
            recovering={recoveringProvider}
            executing={executing || selected.status === "running"}
            filter={itemFilter}
            query={query}
            selectedItem={selectedItem}
            selectedItemId={selectedItemId}
            stageFilter={stageFilter}
            showTrace={showTrace}
            onExecute={execute}
            onRecover={recover}
            onRewind={rewind}
            onFilter={setItemFilter}
            onQuery={setQuery}
            onSelectItem={(itemId) => { setSelectedItemId(itemId); setShowTrace(true); }}
            onCloseDetail={() => { setSelectedItemId(""); setShowTrace(false); }}
            onStageFilter={(value) => { setStageFilter(value); setShowTrace(value !== "all"); }}
            onUpdated={(run) => setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)])}
          />}
        </section>
      </div>}
    </main>
  );
}

function WorkView({
  run,
  providers,
  recovering,
  executing,
  filter,
  query,
  selectedItem,
  selectedItemId,
  stageFilter,
  showTrace,
  onExecute,
  onRecover,
  onRewind,
  onFilter,
  onQuery,
  onSelectItem,
  onCloseDetail,
  onStageFilter,
  onUpdated
}: {
  run: AgentRun;
  providers: ProviderHealth[];
  recovering: ProviderId | null;
  executing: boolean;
  filter: ItemFilter;
  query: string;
  selectedItem: AgentItem | null;
  selectedItemId: string;
  stageFilter: StageId | "all";
  showTrace: boolean;
  onExecute: (providerId: ProviderId) => void;
  onRecover: (providerId: ProviderId) => void;
  onRewind: (stage: StageId) => void;
  onFilter: (value: ItemFilter) => void;
  onQuery: (value: string) => void;
  onSelectItem: (itemId: string) => void;
  onCloseDetail: () => void;
  onStageFilter: (value: StageId | "all") => void;
  onUpdated: (run: AgentRun) => void;
}) {
  const queue = visibleItems(run, filter, query, true);
  const currentIndex = queue.findIndex((item) => item.id === selectedItemId);
  const previousItem = currentIndex > 0 ? queue[currentIndex - 1] : undefined;
  const nextItem = currentIndex >= 0 ? queue[currentIndex + 1] : queue[0];
  const summary = runUiSummary(run);

  function focusFilter(value: ItemFilter) {
    onFilter(value);
    onQuery("");
    const candidates = visibleItems(run, value, "", true);
    if (value !== "all" && candidates[0]) onSelectItem(candidates[0].id);
    window.setTimeout(() => document.querySelector(".work-queue")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return <>
    <WorkSummary
      run={run}
      providers={providers}
      executing={executing}
      onReady={() => focusFilter("ready")}
      onDecision={() => focusFilter("decision")}
      onNoCandidate={() => focusFilter("no_candidate")}
      onUnprocessed={() => focusFilter("unprocessed")}
      onExecute={onExecute}
    />

    <details className="work-diagnostics">
      <summary><Settings2 size={15} /><span>Detalles técnicos</span><small>Etapas, proveedor, documentos y traza</small></summary>
      <div className="work-diagnostics-body">
        <RunHeader run={run} providers={providers} recovering={recovering} executing={executing} onExecute={onExecute} onRecover={onRecover} onReview={() => focusFilter(summary.decision > 0 ? "decision" : summary.noCandidate > 0 ? "no_candidate" : "ready")} />
        <DocumentIntakeStage
          run={run}
          inspecting={stageFilter === "source"}
          onInspect={() => onStageFilter(stageFilter === "source" ? "all" : "source")}
        />
        <StageMap run={run} activeFilter={stageFilter} onFilter={onStageFilter} onRewind={onRewind} />
      </div>
    </details>

    <div className={`content-grid work-content ${!selectedItem && !showTrace ? "single" : ""}`}>
      <section className="data-section work-queue">
        <ItemToolbar run={run} filter={filter} onFilter={onFilter} query={query} onQuery={onQuery} onOpenTrace={() => onStageFilter("all")} />
        <ItemTableV2 run={run} filter={filter} query={query} onSelect={onSelectItem} selectedId={selectedItemId} prioritize />
      </section>
      {(selectedItem || showTrace) && <aside className="trace-pane">
        {selectedItem
          ? <ItemInspectorV2
              key={selectedItem.id}
              run={run}
              item={selectedItem}
              queuePosition={currentIndex + 1}
              queueTotal={queue.length}
              onClose={onCloseDetail}
              onPrevious={previousItem ? () => onSelectItem(previousItem.id) : undefined}
              onNext={nextItem ? () => onSelectItem(nextItem.id) : undefined}
              onUpdated={onUpdated}
            />
          : <RunTrace run={run} stageFilter={stageFilter} onClose={onCloseDetail} />}
      </aside>}
    </div>
  </>;
}

function WorkSummary({
  run,
  providers,
  executing,
  onReady,
  onDecision,
  onNoCandidate,
  onUnprocessed,
  onExecute
}: {
  run: AgentRun;
  providers: ProviderHealth[];
  executing: boolean;
  onReady: () => void;
  onDecision: () => void;
  onNoCandidate: () => void;
  onUnprocessed: () => void;
  onExecute: (providerId: ProviderId) => void;
}) {
  const summary = runUiSummary(run);
  const stageIncomplete = incompleteAtActiveStage(run);
  const title = humanRunTitle(run);
  const isRunning = executing || run.status === "running";
  const [providerId, setProviderId] = useState<ProviderId>(run.providerId);
  useEffect(() => setProviderId(run.providerId), [run.id, run.providerId]);
  const provider = providers.find((entry) => entry.provider.id === providerId);
  const providerReady = provider?.ok ?? providerId === "mock";
  const needsExecution = run.status === "draft" || run.status === "failed" || summary.noCandidate > 0 || summary.unprocessed > 0;
  const state = isRunning
    ? "En curso"
    : run.status === "failed"
      ? "Interrumpido"
      : summary.decision > 0 || summary.noCandidate > 0 || summary.unprocessed > 0
        ? "Listo para revisión"
        : run.status === "draft"
          ? "Sin iniciar"
          : "Terminado";
  const statusTone = isRunning ? "running" : run.status === "failed" ? "failed" : summary.unresolved > 0 ? "warning" : run.status === "draft" ? "draft" : "completed";
  const primaryLabel = isRunning
    ? "Analizando..."
    : run.status === "draft"
      ? "Iniciar análisis"
      : run.status === "failed"
        ? "Reanudar análisis"
        : summary.decision > 0
          ? `Decidir ${summary.decision} ${summary.decision === 1 ? "resultado" : "resultados"}`
          : summary.noCandidate > 0
            ? `Buscar ${summary.noCandidate} sin candidato`
            : summary.unprocessed > 0
              ? `Completar ${summary.unprocessed} sin procesar`
          : "Revisar resultados";
  const primaryAction = run.status === "draft" || run.status === "failed"
    ? () => onExecute(providerId)
    : summary.decision > 0
      ? onDecision
      : summary.noCandidate > 0
        ? () => onExecute(providerId)
        : summary.unprocessed > 0
          ? onUnprocessed
          : onReady;
  const primaryExecutes = run.status === "draft" || run.status === "failed" || (summary.decision === 0 && summary.noCandidate > 0);
  const description = isRunning
    ? `El agente está trabajando en ${STAGES.find((stage) => stage.id === run.activeStage)?.title || "el análisis"}.`
    : run.status === "failed"
      ? `${stageIncomplete} ${stageIncomplete === 1 ? "ítem no terminó" : "ítems no terminaron"} la etapa interrumpida. Puedes reanudar sin perder lo ya obtenido.`
      : summary.decision > 0
        ? `${summary.candidates} ítems tienen candidato comercial; ${summary.decision} esperan una decisión.`
        : summary.noCandidate > 0
          ? `${summary.ready} resultados están listos y ${summary.noCandidate} ítems necesitan otra búsqueda.`
          : summary.unprocessed > 0
            ? `${summary.unprocessed} ítems todavía no han sido procesados.`
            : "La ejecución terminó y no quedan decisiones pendientes.";

  return <section className="work-summary">
    <div className="work-summary-main">
      <span className={`work-state ${statusTone}`}>{isRunning && <LoaderCircle className="spin" size={14} />}{state}</span>
      <h2 title={run.origin?.odooProjectName || run.name}>{title}</h2>
      <p>{description}</p>
    </div>
    <div className="work-result-filters" aria-label="Resumen de resultados">
      <button onClick={onDecision} className={summary.decision > 0 ? "attention" : ""}><strong>{summary.decision}</strong><span>Por decidir</span></button>
      <button onClick={onReady}><strong>{summary.ready}</strong><span>Listos</span></button>
      {summary.noCandidate > 0 && <button onClick={onNoCandidate}><strong>{summary.noCandidate}</strong><span>Sin candidato</span></button>}
      {summary.unprocessed > 0 && <button onClick={onUnprocessed}><strong>{summary.unprocessed}</strong><span>Sin procesar</span></button>}
      {summary.documents.attention > 0 && <span title="Fuentes seleccionadas que no aportaron ítems"><strong>{summary.documents.attention}</strong><small>Fuente documental por revisar</small></span>}
    </div>
    <div className="work-summary-action">
      {needsExecution && !isRunning && <select aria-label="Proveedor para continuar" value={providerId} onChange={(event) => setProviderId(event.target.value as ProviderId)}>
        {providers.map((entry) => <option key={entry.provider.id} value={entry.provider.id}>{entry.provider.label}{entry.ok ? "" : " · sin conexión"}</option>)}
      </select>}
      <button className="button primary work-primary" disabled={isRunning || (primaryExecutes && !providerReady)} onClick={primaryAction}>
        {isRunning ? <LoaderCircle className="spin" size={17} /> : summary.decision > 0 && run.status !== "failed" ? <ArrowRight size={17} /> : summary.unresolved === 0 ? <Check size={17} /> : <RefreshCw size={17} />}
        {primaryLabel}
      </button>
      {!isRunning && summary.decision > 0 && summary.noCandidate > 0 && <button className="button secondary" disabled={!providerReady} onClick={() => onExecute(providerId)}><Search size={16} /> Buscar {summary.noCandidate} sin candidato</button>}
    </div>
  </section>;
}

function NewProcessDialog({ providers, busy, onClose, onUpload, onDemo }: { providers: ProviderHealth[]; busy: boolean; onClose: () => void; onUpload: (event: React.FormEvent<HTMLFormElement>) => void; onDemo: (id: ProviderId) => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title">
    <header><div><h2 id="new-title">Crear análisis desde archivo</h2><p>Selecciona el documento que contiene los productos o servicios por analizar.</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></header>
    <form onSubmit={onUpload}>
      <label className="field"><span>Nombre del análisis</span><input name="name" placeholder="Ej. Suministros regionales" /></label>
      <label className="field"><span>Enfoque del análisis</span><select name="profileId" defaultValue="procurement_items_v1">{DOCUMENT_INTAKE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
      <div className="form-row">
        <label className="field"><span>Proveedor</span><select name="providerId" defaultValue="mock">{providers.map((entry) => <option key={entry.provider.id} value={entry.provider.id}>{entry.provider.label}{entry.ok ? " · disponible" : " · sin conexión"}</option>)}</select></label>
        <label className="field"><span>Items por lote</span><select name="batchSize" defaultValue="10"><option>5</option><option>10</option><option>20</option><option>30</option></select></label>
      </div>
      <label className="drop-field"><Files size={28} /><span>Selecciona uno o varios archivos</span><small>Excel, CSV, JSON, PDF, Word, PowerPoint o imagen</small><input required multiple type="file" name="files" accept={DOCUMENT_UPLOAD_ACCEPT} /></label>
      <footer><button type="button" className="button ghost" disabled={busy} onClick={() => onDemo("mock")}><FileSearch size={16} /> Caso sintético</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <FileSearch size={16} />} Analizar documentos</button></footer>
    </form>
  </section></div>;
}

function ProviderMiniList({ providers, recovering, onRecover }: { providers: ProviderHealth[]; recovering: ProviderId | null; onRecover: (id: ProviderId) => void }) {
  return <div className="provider-mini"><div className="rail-heading"><span>Proveedores</span><RefreshCw size={13} /></div>{providers.map((entry) => <div className={`provider-item ${entry.ok ? "ready" : "offline"}`} key={entry.provider.id}>
    <div className="provider-row"><span className={`status-dot ${entry.ok ? "completed" : "failed"}`} /><span>{entry.provider.label}</span><small>{entry.ok ? entry.worker?.status === "processing" ? "Ocupado" : "Listo" : "Sin conexión"}</small></div>
    {!entry.ok && <div className="provider-diagnostic"><strong>{entry.diagnostic?.title || "Proveedor no disponible"}</strong><span>{entry.diagnostic?.userAction || entry.error}</span>{entry.diagnostic?.recoverable && <button className="icon-button provider-recover" title={entry.diagnostic.userAction} aria-label={`Reconectar ${entry.provider.label}`} disabled={recovering === entry.provider.id} onClick={() => onRecover(entry.provider.id)}>{recovering === entry.provider.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button>}</div>}
  </div>)}</div>;
}

function StartHome({ runs, busy, onNew, onDemo, onSelect, projectBridge }: {
  runs: AgentRun[];
  busy: boolean;
  onNew: () => void;
  onDemo: () => void;
  onSelect: (runId: string) => void;
  projectBridge: ReactNode;
}) {
  return <section className="start-home">
    <header className="start-intro">
      <div className="start-symbol"><FileSearch size={27} /></div>
      <div className="eyebrow">Análisis documental y de mercado</div>
      <h2>Empieza un análisis</h2>
      <p>{projectBridge
        ? "Usa el archivo asociado al proyecto de Odoo o carga otro listado desde este equipo."
        : "Carga el listado de productos o servicios que quieres analizar."}</p>
    </header>

    {projectBridge && <div className="start-project">{projectBridge}</div>}

    <div className="start-actions">
      <button className="start-action primary" onClick={onNew}>
        <span className="start-action-icon"><Upload size={23} /></span>
        <span><strong>Analizar documentos</strong><small>Excel, PDF, Word, CSV, JSON o imágenes</small></span>
        <ArrowRight size={20} />
      </button>
      {runs.length > 0 && <details className="recent-runs">
        <summary>
          <span className="start-action-icon"><History size={22} /></span>
          <span><strong>Continuar un análisis</strong><small>{runs.length} análisis guardado(s)</small></span>
          <ArrowRight size={20} />
        </summary>
        <div className="recent-run-list">
          {runs.slice(0, 8).map((run) => <button key={run.id} onClick={() => onSelect(run.id)}>
            <span className={`status-dot ${run.status}`} />
            <span><strong title={run.name}>{humanRunTitle(run)}</strong><small>{runUiSummary(run).candidates}/{runUiSummary(run).total} con candidato · {runProgress(run).label}</small></span>
            <ArrowRight size={15} />
          </button>)}
        </div>
      </details>}
    </div>

    <details className="testing-options">
      <summary>Opciones de prueba</summary>
      <div><p>Genera un caso controlado para conocer el flujo sin cargar documentos reales.</p><button className="button secondary" disabled={busy} onClick={onDemo}><FileSearch size={16} /> Abrir caso sintético</button></div>
    </details>
  </section>;
}

function RunHeader({ run, providers, recovering, executing, onExecute, onRecover, onReview }: { run: AgentRun; providers: ProviderHealth[]; recovering: ProviderId | null; executing: boolean; onExecute: (providerId: ProviderId) => void; onRecover: (providerId: ProviderId) => void; onReview: () => void }) {
  const summary = runUiSummary(run);
  const progress = runProgress(run, executing);
  const projectCode = runProjectCode(run);
  const fullProjectName = run.origin?.odooProjectName || run.name;
  const [executionProvider, setExecutionProvider] = useState<ProviderId>(run.providerId);
  useEffect(() => setExecutionProvider(run.providerId), [run.id, run.providerId]);
  const selectedProvider = providers.find((entry) => entry.provider.id === executionProvider);
  const providerReady = selectedProvider?.ok ?? executionProvider === "mock";
  const canSearch = run.status === "draft" || run.status === "failed" || summary.noCandidate > 0 || summary.unprocessed > 0;
  const reviewAction = summary.decision > 0 && run.status !== "failed" && run.status !== "draft";
  const executeAction = !reviewAction && canSearch;
  const actionLabel = executing
    ? "Agente trabajando"
    : run.status === "draft"
      ? "Ejecutar agente"
      : run.status === "failed"
        ? "Reanudar proceso"
        : summary.decision > 0
          ? `Revisar ${summary.decision} ${summary.decision === 1 ? "resultado" : "resultados"}`
          : summary.noCandidate > 0
            ? `Buscar ${summary.noCandidate} sin candidato`
            : summary.unprocessed > 0
              ? `Completar ${summary.unprocessed} sin procesar`
              : "Ejecución terminada";
  return <section className="run-header">
    <div className="run-title">
      <div className={`donut ${executing && run.status === "draft" ? "running" : run.status}`} style={{ "--progress": `${progress.percent}%` } as React.CSSProperties} aria-label={`${progress.display} etapas; ${progress.percent}% del flujo completado`}>
        <span><strong>{progress.display}</strong><small>etapas</small></span>
      </div>
      <div className="run-identity">
        <div className="run-current-stage"><span className={`status-dot ${run.status}`} />{progress.label}</div>
        <h2 title={fullProjectName}>{humanRunTitle(run)}</h2>
        <div className="run-context">
          {run.origin?.kind !== "upload" && <span title={projectCode || run.origin?.odooProjectId}><Database size={13} /> Proyecto Odoo vinculado</span>}
          <span><FolderOpen size={13} /> {run.inventory.fileName}</span>
          <span>{run.inventory.detectedRows} ítems</span>
        </div>
        {run.status === "needs_review"
          ? <InfoNote label={`${summary.unresolved} ${summary.unresolved === 1 ? "asunto pendiente" : "asuntos pendientes"}`}>{progress.detail}</InfoNote>
          : <p className={`run-progress-detail ${run.status}`}>{progress.detail}</p>}
        {progress.activity && run.status === "running" && <p className="run-current-activity">{progress.activity}</p>}
        <details className="run-identity-details">
          <summary>Identificación técnica</summary>
          <dl>
            {run.origin?.kind !== "upload" && <><dt>Proyecto Odoo</dt><dd>{fullProjectName}</dd></>}
            <dt>ID interno</dt><dd>{run.id}</dd>
            <dt>Rama</dt><dd>{run.branch}</dd>
            <dt>Archivo</dt><dd>{run.inventory.fileName}</dd>
            <dt>Lote</dt><dd>{run.batchSize} ítems</dd>
            <dt>Llamadas al proveedor</dt><dd>{run.metrics.providerCalls}</dd>
          </dl>
        </details>
      </div>
    </div>
    <div className="run-metrics">
      <Metric value={summary.candidates} label="Con candidato" tone="good" />
      <Metric value={summary.decision} label="Por decidir" tone="warn" />
      <Metric value={summary.noCandidate} label="Sin candidato" tone={summary.noCandidate > 0 ? "warn" : undefined} />
      <Metric value={formatDuration(run.metrics.durationMs)} label="Tiempo" />
    </div>
    <div className="run-action">
      {canSearch && <label><span>Proveedor para continuar</span><select aria-label="Proveedor para continuar" value={executionProvider} disabled={executing} onChange={(event) => setExecutionProvider(event.target.value as ProviderId)}>{providers.map((entry) => <option key={entry.provider.id} value={entry.provider.id}>{entry.provider.label}{entry.ok ? "" : " · sin conexión"}</option>)}</select></label>}
      <button className="button primary run-cta" disabled={executing || (!canSearch && summary.decision === 0) || (executeAction && !providerReady)} onClick={reviewAction ? onReview : () => onExecute(executionProvider)}>
        {executing ? <LoaderCircle className="spin" size={17} /> : reviewAction ? <ArrowRight size={17} /> : summary.unresolved === 0 ? <Check size={17} /> : run.status === "draft" ? <Play size={17} /> : <RefreshCw size={17} />}
        {actionLabel}
      </button>
      {reviewAction && summary.noCandidate > 0 && <button className="button secondary run-secondary-cta" disabled={executing || !providerReady} onClick={() => onExecute(executionProvider)}><Search size={16} /> Buscar {summary.noCandidate} sin candidato</button>}
      {!providerReady && canSearch && <div className="provider-action-warning"><span><strong>{selectedProvider?.diagnostic?.title || "Proveedor no disponible"}.</strong> {selectedProvider?.diagnostic?.userAction || "Selecciona otro proveedor disponible."}</span>{selectedProvider?.diagnostic?.recoverable && <button className="button compact secondary" disabled={recovering === executionProvider} onClick={() => onRecover(executionProvider)}>{recovering === executionProvider ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />} Reconectar</button>}</div>}
    </div>
  </section>;
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone?: string }) { return <div className={`metric ${tone || ""}`}><strong>{value}</strong><span>{label}</span></div>; }

function InfoNote({ label, children }: { label: string; children: ReactNode }) {
  return <details className="info-note">
    <summary title="Ver información"><span className="info-note-icon"><Info size={12} /></span>{label}</summary>
    <div className="info-note-panel">{children}</div>
  </details>;
}

function OdooProjectBridge({
  bridge,
  providers,
  busy,
  onImported,
  onBusy,
  onError
}: {
  bridge: OdooBridgeState;
  providers: ProviderHealth[];
  busy: boolean;
  onImported: (run: AgentRun) => void;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
}) {
  const [fileId, setFileId] = useState("");
  const [sourceMode, setSourceMode] = useState<"file" | "folder">("file");
  const [profileId, setProfileId] = useState("procurement_items_v1");
  const [providerId, setProviderId] = useState<ProviderId>("mock");
  const [batchSize, setBatchSize] = useState("10");
  const providerInitialized = useRef(false);
  const launch = bridge.launch;
  const files = useMemo(
    () => (launch?.drive?.files || []).filter(isSupportedDriveFile),
    [launch]
  );

  useEffect(() => {
    if (!fileId && files[0]) setFileId(files[0].id);
  }, [fileId, files]);

  useEffect(() => {
    if (providerInitialized.current) return;
    const preferred = providers.find((entry) => entry.ok && entry.provider.id !== "mock") || providers.find((entry) => entry.ok);
    if (preferred) {
      setProviderId(preferred.provider.id);
      providerInitialized.current = true;
    }
  }, [providers]);

  async function importSource() {
    if (!launch) return;
    const selectedFiles = sourceMode === "folder"
      ? files
      : files.filter((entry) => entry.id === fileId);
    if (!selectedFiles.length) return;
    onBusy(true);
    onError("");
    try {
      const downloaded: File[] = [];
      for (let offset = 0; offset < selectedFiles.length; offset += 4) {
        const group = selectedFiles.slice(offset, offset + 4);
        const groupFiles = await Promise.all(group.map(async (driveFile) => {
          const driveQuery = new URLSearchParams({
            baseUrl: bridge.odooBaseUrl,
            db: bridge.odooDb,
            token: bridge.launchToken,
            fileId: driveFile.id
          });
          const response = await fetch(appPath(`/api/odoo/drive?${driveQuery.toString()}`), { cache: "no-store" });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `No se pudo descargar ${driveFile.name}.`);
          }
          const blob = await response.blob();
          const downloadedName = responseFileName(response, driveFile.name);
          return new File([blob], downloadedName, { type: blob.type || driveFile.mimeType });
        }));
        downloaded.push(...groupFiles);
      }
      const form = new FormData();
      downloaded.forEach((file) => form.append("files", file));
      form.set("name", compactProjectTitle(launch.project?.name || launch.sourceTitle || downloaded[0].name));
      form.set("providerId", providerId);
      form.set("batchSize", batchSize);
      form.set("profileId", profileId);
      form.set("origin", JSON.stringify({
        kind: sourceMode === "folder" ? "odoo_project_folder" : "odoo_project_drive",
        odooProjectId: launch.odooProjectId || launch.project?.id,
        odooProjectName: launch.project?.name,
        odooAnalysisRecordId: launch.analysisRecordId,
        odooReturnUrl: launch.odooReturnUrl,
        driveFolderUrl: launch.project?.driveFolderUrl,
        driveFileId: sourceMode === "file" ? selectedFiles[0].id : undefined,
        driveFileName: sourceMode === "file" ? selectedFiles[0].name : undefined,
        driveFileUrl: sourceMode === "file" ? selectedFiles[0].webViewLink : undefined,
        driveFileIds: selectedFiles.map((entry) => entry.id),
        driveFileNames: selectedFiles.map((entry) => entry.name),
        documentProfileId: profileId
      }));
      const createResponse = await fetch(appPath("/api/runs"), { method: "POST", body: form });
      const created = await createResponse.json();
      if (!createResponse.ok || !created.run) throw new Error(created.error || "La app no pudo crear el análisis.");
      onImported(created.run);

      if (launch.odooCallbackUrl) {
        const callbackResponse = await fetch(appPath("/api/odoo/callback"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl: bridge.odooBaseUrl,
            db: bridge.odooDb,
            token: bridge.launchToken,
            payload: {
              runId: created.run.id,
              analysisId: created.run.id,
              sourceTitle: created.run.name,
              status: "pending",
              odooProjectId: launch.odooProjectId || launch.project?.id
            }
          })
        });
        if (!callbackResponse.ok) {
          onError("El análisis fue creado y puedes continuar. Odoo no confirmó el vínculo; vuelve al proyecto y abre de nuevo el análisis para reintentar la asociación.");
        }
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onBusy(false);
    }
  }

  return <section className="odoo-bridge" aria-label="Proyecto Odoo asociado">
    <div className="odoo-bridge-heading">
      <div className="brand-mark compact"><Database size={18} /></div>
      <div>
        <div className="eyebrow">Proyecto Odoo asociado</div>
        <h2>{launch?.project?.name || launch?.sourceTitle || "Cargando proyecto..."}</h2>
        {launch?.project?.processNumber && <p>{launch.project.processNumber}{launch.project.entity ? ` · ${launch.project.entity}` : ""}</p>}
      </div>
      {launch?.odooReturnUrl && <a className="button ghost compact" href={launch.odooReturnUrl}><ExternalLink size={14} /> Volver al proyecto</a>}
    </div>
    {bridge.loading ? <div className="bridge-status"><LoaderCircle className="spin" size={17} /> Consultando carpeta del proyecto...</div>
      : bridge.error ? <div className="bridge-status error"><AlertTriangle size={17} /> {bridge.error}</div>
      : launch?.drive?.status !== "ready" ? <div className="bridge-status warning"><AlertTriangle size={17} /><span><strong>Drive no está listo.</strong> {launch?.drive?.message}</span>{launch?.project?.driveFolderUrl && <a href={launch.project.driveFolderUrl} target="_blank" rel="noreferrer">Abrir carpeta</a>}</div>
      : files.length === 0 ? <div className="bridge-status warning"><AlertTriangle size={17} /><span><strong>No hay archivos compatibles.</strong> Admite Excel, CSV, JSON, PDF, Word, PowerPoint e imágenes.</span>{launch?.project?.driveFolderUrl && <a href={launch.project.driveFolderUrl} target="_blank" rel="noreferrer">Abrir carpeta</a>}</div>
      : <div className="bridge-source-panel">
        <div className="bridge-source-tabs" role="group" aria-label="Fuente documental">
          <button className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}><FileSpreadsheet size={16} /><span><strong>Elegir archivo</strong><small>Analiza un documento de Drive</small></span></button>
          <button className={sourceMode === "folder" ? "active" : ""} onClick={() => setSourceMode("folder")}><FolderSearch size={16} /><span><strong>Analizar carpeta</strong><small>{files.length} documento(s) compatibles</small></span></button>
        </div>
        <div className="bridge-import">
          {sourceMode === "file"
            ? <label className="field bridge-file"><span>Archivo del proyecto</span><select value={fileId} onChange={(event) => setFileId(event.target.value)}>{files.map((file) => <option key={file.id} value={file.id}>{file.path || file.name}</option>)}</select></label>
            : <div className="bridge-folder-summary"><FolderOpen size={18} /><span><strong>Carpeta completa</strong><small>La IA elegirá los documentos relevantes antes de extraer.</small></span></div>}
          <label className="field"><span>Enfoque</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{DOCUMENT_INTAKE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
          <label className="field"><span>Proveedor</span><select value={providerId} onChange={(event) => setProviderId(event.target.value as ProviderId)}>{providers.map((entry) => <option key={entry.provider.id} value={entry.provider.id}>{entry.provider.label}{entry.ok ? "" : " · sin conexión"}</option>)}</select></label>
          <label className="field bridge-batch"><span>Lote</span><select value={batchSize} onChange={(event) => setBatchSize(event.target.value)}><option>5</option><option>10</option><option>20</option><option>30</option></select></label>
          <button className="button primary" disabled={busy || !selectedFilesAvailable(sourceMode, fileId, files)} onClick={() => void importSource()}>{busy ? <LoaderCircle className="spin" size={16} /> : sourceMode === "folder" ? <FolderSearch size={16} /> : <FileSpreadsheet size={16} />} {sourceMode === "folder" ? "Analizar carpeta" : "Crear análisis"}</button>
        </div>
      </div>}
  </section>;
}

function selectedFilesAvailable(mode: "file" | "folder", fileId: string, files: OdooDriveFile[]) {
  return mode === "folder" ? files.length > 0 : files.some((entry) => entry.id === fileId);
}

function DocumentIntakeStage({ run, inspecting, onInspect }: {
  run: AgentRun;
  inspecting: boolean;
  onInspect: () => void;
}) {
  const summary = runUiSummary(run);
  const intake = run.documentIntake;
  const sourceSteps = run.steps.filter((step) => step.stage === "source");
  const state = stageState(sourceSteps, run.activeStage, "source", run.status);
  const documents = intake?.documents || [];
  const coverage = intake?.coverage;
  const foundDocuments = coverage?.documentsFound || documents.length || 1;
  const sourceFinished = state === "passed" || state === "warning";
  const selectedDocuments = coverage?.documentsSelected
    ?? (documents.length ? documents.filter((document) => document.selected).length : sourceFinished ? 1 : 0);
  const processedDocuments = coverage?.documentsProcessed
    ?? (documents.length ? documents.length : sourceFinished ? 1 : 0);
  const extractedItems = coverage?.extractedItems ?? run.inventory.detectedRows;
  const sourceLabel = documentSourceLabel(intake?.source.kind || run.origin?.kind || "upload");
  const statusLabel = intake
    ? intake.status === "ready" ? "Lista" : intake.status === "failed" ? "Falló" : "Revisar"
    : stageStateLabel(state);
  const documentWarnings = new Set(documents.flatMap((document) => document.warnings).map((warning) => cleanText(warning).toLocaleLowerCase("es-CO")));
  const aggregateWarnings = (intake?.warnings || []).filter((warning, index, values) => {
    const normalized = cleanText(warning).toLocaleLowerCase("es-CO");
    return !documentWarnings.has(normalized)
      && values.findIndex((entry) => cleanText(entry).toLocaleLowerCase("es-CO") === normalized) === index;
  });
  const sortedDocuments = documents.slice().sort((left, right) => Number(right.selected) - Number(left.selected) || right.candidateItems - left.candidateItems);
  const headline = state === "failed"
    ? "Preparación documental interrumpida"
    : summary.documents.attention > 0 || state === "warning"
      ? "Documentos preparados con observaciones"
      : "Documentos preparados";

  return <section className={`document-intake-stage ${state} ${inspecting ? "selected" : ""}`} aria-label="Preparación documental">
    <div className="document-stage-summary">
      <div className="document-stage-symbol">
        {state === "failed" ? <X size={18} /> : state === "running" ? <LoaderCircle className="spin" size={18} /> : <Files size={18} />}
      </div>
      <div className="document-stage-copy">
        <div className="document-stage-kicker">Preparación documental</div>
        <h3>{headline}</h3>
        <p>{intake?.selection.summary || "La fuente original fue inventariada antes de iniciar la extracción."}</p>
      </div>
      <div className="document-stage-facts" aria-label="Resumen documental">
        <span><strong>{processedDocuments}/{foundDocuments}</strong> inventariados</span>
        <span><strong>{selectedDocuments}</strong> seleccionados</span>
        <span><strong>{summary.documents.contributing}</strong> aportaron ítems</span>
        <span><strong>{extractedItems}</strong> ítems extraídos</span>
        {intake?.resolution && <span title={intake.resolution.reason}><strong>{intake.resolution.unitPriceItems}</strong> precios techo/ref.</span>}
      </div>
      <div className="document-stage-actions">
        <span className={`document-status ${intake?.status || state}`}>{statusLabel}</span>
        <button className="button compact secondary" aria-pressed={inspecting} onClick={onInspect}>
          <Info size={14} /> {inspecting ? "Ocultar traza" : "Ver traza"}
        </button>
      </div>
    </div>

    <details className="document-stage-detail">
      <summary>
        <span><FileSearch size={15} /> Revisar selección documental</span>
        <small>{sourceLabel} · {intake?.profile.label || "Listado de ítems"}</small>
      </summary>
      <div className="document-stage-detail-body">
        {documents.length > 0 ? <div className="document-list">
          {sortedDocuments.map((document) => <article className={`document-row ${document.selected ? "used" : "support"}`} key={document.id}>
            <span className="document-row-icon">{document.selected ? <Check size={14} /> : <Files size={14} />}</span>
            <div className="document-row-main">
              <strong title={document.name}>{document.name}</strong>
              <small>{document.reason || document.parser}</small>
              {document.totalPages ? <small>{document.processingMode === "focused"
                ? `${document.analyzedPages?.length || 0}/${document.totalPages} páginas analizadas a fondo`
                : `${document.totalPages} páginas · ${documentProcessingLabel(document.processingMode)}`}</small> : null}
            </div>
            <span className="document-role">{documentRoleLabel(document.role)}</span>
            <span className="document-candidates"><strong>{document.candidateItems}</strong><small>ítems</small></span>
            <span className={`document-use ${document.selected ? "used" : ""}`}>{document.selected ? "Usado" : "Soporte"}</span>
            {document.warnings.length > 0 && <details className="document-warning">
              <summary title="Ver novedades"><Info size={13} /></summary>
              <ul>{document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>}
          </article>)}
        </div> : <div className="document-empty">Esta corrida es anterior al inventario documental detallado. Conserva el archivo y los ítems detectados.</div>}

        {(intake?.conflicts.length || aggregateWarnings.length) ? <details className="document-notices">
          <summary><Info size={13} /> Novedades generales <span>{(intake?.conflicts.length || 0) + aggregateWarnings.length}</span></summary>
          <ul>
            {intake?.conflicts.map((conflict) => <li key={`${conflict.code}-${conflict.itemId || conflict.documentIds.join("-")}`}>{conflict.message}</li>)}
            {aggregateWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details> : null}
      </div>
    </details>
  </section>;
}

function documentSourceLabel(value: string) {
  return ({
    upload: "Carga local",
    odoo_drive_file: "Archivo de Drive",
    odoo_project_drive: "Archivo de Drive",
    odoo_drive_folder: "Carpeta de Drive",
    odoo_project_folder: "Carpeta de Drive"
  } as Record<string, string>)[value] || "Fuente documental";
}

function documentRoleLabel(value: string) {
  return ({
    item_list: "Listado",
    technical_specification: "Ficha técnica",
    budget_or_market_study: "Estudio de mercado",
    addendum: "Adenda",
    economic_form: "Formato económico",
    supporting: "Soporte",
    irrelevant: "No relevante",
    ambiguous: "Por revisar"
  } as Record<string, string>)[value] || "Documento";
}

function documentProcessingLabel(value?: string) {
  return ({
    direct: "lectura directa",
    focused: "lectura focalizada",
    deep: "lectura completa",
    deferred: "sondeo suficiente"
  } as Record<string, string>)[value || ""] || "inventariado";
}

function StageMap({ run, activeFilter, onFilter, onRewind }: { run: AgentRun; activeFilter: StageId | "all"; onFilter: (value: StageId | "all") => void; onRewind: (stage: StageId) => void }) {
  return <section className="agent-stages" aria-label="Flujo de análisis">
    <header><div><span>Flujo de análisis</span><small>La preparación documental alimenta estas cuatro etapas.</small></div></header>
    <div className="stage-strip">
    {PIPELINE_STAGES.map((stage) => {
      const steps = run.steps.filter((step) => step.stage === stage.id);
      const state = stageState(steps, run.activeStage, stage.id, run.status);
      return <div key={stage.id} className={`stage-node ${state} ${activeFilter === stage.id ? "selected" : ""}`}>
        <button aria-pressed={activeFilter === stage.id} onClick={() => onFilter(activeFilter === stage.id ? "all" : stage.id)}>
          <span className="stage-index">{state === "passed" ? <Check size={15} /> : state === "warning" ? <Info size={14} /> : state === "failed" ? <X size={15} /> : state === "running" ? <LoaderCircle className="spin" size={15} /> : stage.short}</span>
          <span className="stage-copy"><strong>{stage.title}</strong><small>{stage.purpose}</small><span className="stage-status">{stageStateLabel(state)}{activeFilter === stage.id ? " · viendo" : ""}</span></span>
        </button>
        {steps.length > 0 && stage.id !== "source" && <button className="rewind" aria-label={`Reprocesar desde ${stage.title}`} title={`Reprocesar desde ${stage.title}`} onClick={() => onRewind(stage.id)}><GitBranch size={13} /></button>}
      </div>;
    })}
    </div>
  </section>;
}

function ItemToolbar({ run, filter, onFilter, query, onQuery, onOpenTrace }: { run: AgentRun; filter: ItemFilter; onFilter: (value: ItemFilter) => void; query: string; onQuery: (value: string) => void; onOpenTrace: () => void }) {
  const summary = runUiSummary(run);
  const filters: Array<{ id: ItemFilter; label: string; count: number; show: boolean }> = [
    { id: "all", label: "Todos", count: summary.total, show: true },
    { id: "candidate", label: "Con candidato", count: summary.candidates, show: summary.candidates > 0 || filter === "candidate" },
    { id: "decision", label: "Por decidir", count: summary.decision, show: summary.decision > 0 || filter === "decision" },
    { id: "no_candidate", label: "Sin candidato", count: summary.noCandidate, show: summary.noCandidate > 0 || filter === "no_candidate" },
    { id: "unprocessed", label: "Sin procesar", count: summary.unprocessed, show: summary.unprocessed > 0 || filter === "unprocessed" },
    { id: "ready", label: "Listos", count: summary.ready, show: summary.ready > 0 || filter === "ready" },
    { id: "reviewed", label: "Revisados", count: summary.reviewed, show: summary.reviewed > 0 || filter === "reviewed" },
    { id: "excluded", label: "Excluidos", count: summary.excluded, show: summary.excluded > 0 || filter === "excluded" }
  ];
  return <header className="section-head"><div><h3>Estado de los ítems</h3><p>Separa lo encontrado, lo que requiere decisión y lo que aún necesita trabajo.</p></div><div className="table-tools"><div className="segmented">{filters.filter((entry) => entry.show).map((entry) => <button key={entry.id} className={filter === entry.id ? "active" : ""} onClick={() => onFilter(entry.id)}>{entry.label} {entry.count}</button>)}</div><label className="search-field"><Search size={15} /><input aria-label="Buscar items" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar" /></label><button className="icon-button info-trigger" aria-label="Ver detalles de ejecución" title="Ver detalles de ejecución" onClick={onOpenTrace}><Info size={16} /></button></div></header>;
}

function visibleItems(run: AgentRun, filter: ItemFilter, query: string, prioritize = false) {
  const items = run.items.filter((item) => {
    if (filter === "excluded") return item.status === "excluded";
    if (item.status === "excluded") return false;
    const state = uiItemState(item);
    if (filter === "candidate" && !itemHasCandidate(item)) return false;
    if (filter === "decision" && state !== "decision") return false;
    if (filter === "no_candidate" && state !== "no_candidate") return false;
    if (filter === "unprocessed" && state !== "unprocessed") return false;
    if (filter === "ready" && state !== "ready") return false;
    if (filter === "reviewed" && !item.reviews.length) return false;
    const haystack = `${item.id} ${item.original.lot || ""} ${item.original.name} ${item.market?.supplier || ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  if (!prioritize) return items;
  const priority = (item: AgentItem) => {
    const decision = effectiveDecision(item);
    const confidence = effectiveConfidence(item);
    const reviewedPenalty = item.reviews.length ? 10 : 0;
    if (decision === "human_review" && itemHasCandidate(item)) return reviewedPenalty;
    if (decision === "retry" || confidence === "low") return 1 + reviewedPenalty;
    if (decision === "no_result" || confidence === "no_data") return 2 + reviewedPenalty;
    if (decision === "accept_with_note" || confidence === "medium") return 3 + reviewedPenalty;
    return 4 + reviewedPenalty;
  };
  return items.slice().sort((left, right) => priority(left) - priority(right));
}

function confidenceReason(item: AgentItem) {
  return item.humanDecision?.reason
    || item.supervision?.reason
    || item.market?.notes
    || (effectiveConfidence(item) === "no_data" ? "Falta una fuente comercial sustentada." : "Revisa el detalle de la evidencia.");
}

function ItemTableV2({ run, filter, query, onSelect, selectedId, prioritize = false }: { run: AgentRun; filter: ItemFilter; query: string; onSelect: (id: string) => void; selectedId: string; prioritize?: boolean }) {
  const items = visibleItems(run, filter, query, prioritize);
  return <div className="table-wrap"><table className="items-table"><thead><tr><th>Ítem</th><th>Requerimiento</th><th>Unidad</th><th>Fuente candidata</th><th>Precio</th><th>Confianza</th><th>Decisión</th><th aria-label="Abrir" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={`${selectedId === item.id ? "selected" : ""} ${item.reviews.length ? "reviewed" : ""}`} onClick={() => onSelect(item.id)}><td className="item-id">{item.id}<small>{item.original.lot || ""}</small></td><td><strong>{item.normalized?.name || item.original.name}</strong><small>{item.technical?.searchBrief || item.original.description || "Sin ficha técnica"}</small></td><td>{item.normalized?.unit || item.original.unit || "—"}<small>{(item.normalized?.quantity ?? item.original.quantity) || "—"}</small></td><td>{item.market?.supplier || <span className="muted">Sin fuente</span>}<small>{item.market?.product || "Falta una referencia comercial"}</small></td><td>{item.market?.price === null || item.market?.price === undefined ? <span className="muted">Sin precio candidato</span> : formatMoney(item.market.price, item.market.currency)}<small>{item.normalized?.ceilingPriceCop === null || item.normalized?.ceilingPriceCop === undefined ? "Sin precio techo" : `Techo ${formatMoney(item.normalized.ceilingPriceCop, "COP")}`}</small></td><td><ConfidenceBadge value={effectiveConfidence(item)} />{prioritize && <small className="confidence-hint" title={confidenceReason(item)}><Info size={10} /> Motivo</small>}</td><td><EffectiveDecisionBadge item={item} />{item.reviews.length > 0 && <small className="reviewed-state"><Check size={10} /> Revisado</small>}</td><td><ArrowRight size={15} /></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-table">No hay ítems con este filtro.</div>}</div>;
}

function RunTrace({ run, stageFilter, onClose }: { run: AgentRun; stageFilter: StageId | "all"; onClose: () => void }) {
  const filtered = run.steps.filter((step) => stageFilter === "all" || step.stage === stageFilter).slice().reverse();
  const grouped = filtered.reduce<Array<{ step: AgentStep; count: number }>>((groups, step) => {
    const signature = [step.stage, step.title, step.status, step.observed, step.error || ""].join("|");
    const existing = groups.find((group) => [group.step.stage, group.step.title, group.step.status, group.step.observed, group.step.error || ""].join("|") === signature);
    if (existing) existing.count += 1;
    else groups.push({ step, count: 1 });
    return groups;
  }, []);
  return <div className="trace"><header><div><h3>Detalles de ejecución</h3><p>{stageFilter === "all" ? `${grouped.length} eventos de proceso resumidos` : STAGES.find((stage) => stage.id === stageFilter)?.title}</p></div><button className="icon-button trace-close" aria-label="Cerrar detalles de ejecución" title="Cerrar" onClick={onClose}><X size={16} /></button></header><div className="trace-list">{grouped.map(({ step, count }) => <StepEntry key={step.id} step={step} repeatCount={count} />)}</div><details className="events-detail"><summary>Bitácora completa sin resumir <span>{run.events.length} eventos</span></summary>{run.events.slice().reverse().map((entry) => <div className={`event ${entry.kind}`} key={entry.id}><span>{new Date(entry.at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span><div><strong>{entry.title}</strong><p>{entry.detail}</p></div></div>)}</details></div>;
}

function StepEntry({ step, repeatCount = 1 }: { step: AgentStep; repeatCount?: number }) {
  const duration = step.durationMs !== undefined ? formatDuration(step.durationMs) : "";
  return <article className={`step-entry ${step.status}`}><div className="step-icon">{step.status === "passed" ? <CheckCircle2 size={17} /> : step.status === "warning" ? <Info size={15} /> : step.status === "failed" ? <XCircle size={17} /> : step.status === "running" ? <LoaderCircle className="spin" size={17} /> : <Clock3 size={17} />}</div><div className="step-body"><div><strong>{step.title}{repeatCount > 1 && <span className="repeat-count">{repeatCount} intentos iguales</span>}</strong><span>{stepStatusLabel(step.status)}{duration ? ` · ${duration}` : ""}</span></div><dl><dt>Esperado</dt><dd>{step.expected}</dd><dt>Observado</dt><dd>{step.observed}</dd></dl>{(step.prompt || step.rawResponse || step.error) && <details><summary>Detalle técnico</summary>{step.error && <pre className="error-text">{step.error}</pre>}{step.prompt && <><h4>Prompt</h4><pre>{step.prompt}</pre></>}{step.rawResponse && <><h4>Respuesta cruda</h4><pre>{step.rawResponse}</pre></>}</details>}</div></article>;
}

type ItemRerunProgress = {
  status: "starting" | "running" | "completed" | "failed";
  percent: number;
  elapsedMs: number;
  activeStage: StageId;
  stages: StageId[];
  completedStages: StageId[];
  message: string;
};

type CorrectionIntent = "interpretation" | "new_source" | "reevaluate" | "exclude";

const CORRECTION_INTENTS: Array<{ id: CorrectionIntent; label: string; description: string; stage: StageId }> = [
  { id: "new_source", label: "Buscar otra referencia", description: "Vuelve a Mercado y después audita la nueva fuente.", stage: "market" },
  { id: "interpretation", label: "Corregir cómo se entendió", description: "Rehace el criterio técnico, la búsqueda y la supervisión.", stage: "technical" },
  { id: "reevaluate", label: "Revisar la evidencia actual", description: "Conserva la fuente y repite únicamente la supervisión.", stage: "supervision" },
  { id: "exclude", label: "No es un ítem", description: "Lo conserva en la traza, pero lo retira del inventario activo.", stage: "source" }
];

const ASSISTANT_QUESTION_OPTIONS = [
  "¿El precio corresponde a la unidad o presentación solicitada?",
  "¿La fuente y el producto sustentan razonablemente este precio?",
  "¿La diferencia técnica cambia de forma importante el precio de referencia?",
  "¿Qué debería corregirse sin volver a procesar todo el ítem?"
];

const CORRECTION_PIPELINE: StageId[] = ["extraction", "technical", "market", "supervision"];

function correctionStagesFrom(stage: StageId) {
  const startStage = stage === "source" ? "extraction" : stage;
  const startIndex = Math.max(0, CORRECTION_PIPELINE.indexOf(startStage));
  return CORRECTION_PIPELINE.slice(startIndex);
}

function correctionStageLabel(stage: StageId) {
  return ({
    source: "Fuente",
    extraction: "Extracción",
    technical: "Técnico",
    market: "Mercado",
    supervision: "Supervisión"
  } as Record<StageId, string>)[stage];
}

function correctionStageMessage(stage: StageId) {
  return ({
    source: "Preparando la evidencia original.",
    extraction: "Normalizando nuevamente el requerimiento.",
    technical: "Revisando requisitos, presentación y estrategia de compra.",
    market: "Buscando y contrastando una nueva fuente comercial.",
    supervision: "Auditando soporte, precio y coincidencia del resultado."
  } as Record<StageId, string>)[stage];
}

function correctionProgressFrom(run: AgentRun, itemId: string, startStage: StageId, baselineStepCount: number, startedAt: number): ItemRerunProgress {
  const stages = correctionStagesFrom(startStage);
  const newSteps = run.steps.slice(baselineStepCount).filter((step) => step.itemIds.includes(itemId) && stages.includes(step.stage));
  const runningStep = newSteps.slice().reverse().find((step) => step.status === "running");
  const latestStep = newSteps.at(-1);
  const candidateStage = runningStep?.stage || latestStep?.stage || (stages.includes(run.activeStage) ? run.activeStage : stages[0]);
  const activeStage = candidateStage || stages[0];
  const activeIndex = Math.max(0, stages.indexOf(activeStage));
  const completedStages = stages.filter((entry, index) =>
    index < activeIndex
    || (index === activeIndex
      && newSteps.some((step) => step.stage === entry && ["passed", "warning", "failed"].includes(step.status))
      && !runningStep)
  );
  const stageFraction = runningStep ? 0.45 : newSteps.length ? 0.72 : 0.12;
  const percent = Math.max(4, Math.min(94, Math.round(((activeIndex + stageFraction) / Math.max(1, stages.length)) * 100)));
  return {
    status: newSteps.length ? "running" : "starting",
    percent,
    elapsedMs: Date.now() - startedAt,
    activeStage,
    stages,
    completedStages,
    message: newSteps.length ? correctionStageMessage(activeStage) : "Enviando la corrección al agente."
  };
}

function ItemInspectorV2({
  run,
  item,
  queuePosition,
  queueTotal,
  onClose,
  onPrevious,
  onNext,
  onUpdated
}: {
  run: AgentRun;
  item: AgentItem;
  queuePosition: number;
  queueTotal: number;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onUpdated: (run: AgentRun) => void;
}) {
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<CorrectionIntent>("new_source");
  const [verdict, setVerdict] = useState<"correct" | "incorrect" | "unclear" | "">(() => defaultReviewVerdict(item));
  const [tags, setTags] = useState<string[]>([]);
  const [rememberForSimilar, setRememberForSimilar] = useState(false);
  const [correction, setCorrection] = useState<HumanCorrection>(() => ({
    supplier: item.market?.supplier || "",
    product: item.market?.product || "",
    price: item.market?.price ?? null,
    currency: item.market?.currency || "COP",
    url: item.market?.url || "",
    decision: effectiveDecision(item) as Decision,
    confidence: effectiveConfidence(item)
  }));
  const [dirtyCorrectionFields, setDirtyCorrectionFields] = useState<Partial<Record<keyof HumanCorrection, true>>>({});
  const [memories, setMemories] = useState<LearningContext[]>([]);
  const [reviewing, setReviewing] = useState<"record" | "apply" | "rerun" | "exclude" | "">("");
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [rerunProgress, setRerunProgress] = useState<ItemRerunProgress | null>(null);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantExchange, setAssistantExchange] = useState<ItemAssistantExchange | null>(() => item.assistantExchanges?.at(-1) || null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const assistantRequestRef = useRef<{ token: number; controller: AbortController } | null>(null);
  const assistantRequestTokenRef = useRef(0);
  const stage = CORRECTION_INTENTS.find((entry) => entry.id === intent)?.stage || "market";
  const selectedCorrectionIntent = CORRECTION_INTENTS.find((entry) => entry.id === intent) || CORRECTION_INTENTS[0];

  useEffect(() => {
    return () => {
      assistantRequestTokenRef.current += 1;
      assistantRequestRef.current?.controller.abort();
    };
  }, []);

  async function askAssistant() {
    const question = assistantQuestion.trim();
    if (!question) return;
    assistantRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const token = assistantRequestTokenRef.current + 1;
    assistantRequestTokenRef.current = token;
    assistantRequestRef.current = { token, controller };
    setAssistantLoading(true);
    setAssistantError("");
    try {
      const response = await fetch(appPath(`/api/runs/${run.id}/items/${item.id}/assistant`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, providerId: run.providerId }),
        signal: controller.signal
      });
      const data = await response.json();
      if (assistantRequestRef.current?.token !== token) return;
      if (!response.ok || !data.exchange) {
        setAssistantError(data.error || "El asistente no pudo analizar este punto.");
        return;
      }
      setAssistantExchange(data.exchange);
      if (data.run) onUpdated(data.run);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (assistantRequestRef.current?.token !== token) return;
      setAssistantError(error instanceof Error ? error.message : "El asistente no pudo responder.");
    } finally {
      if (assistantRequestRef.current?.token === token) {
        assistantRequestRef.current = null;
        setAssistantLoading(false);
      }
    }
  }

  function prepareAssistantProposal(exchange: ItemAssistantExchange) {
    const intentByStage: Record<StageId, CorrectionIntent> = {
      source: "exclude",
      extraction: "interpretation",
      technical: "interpretation",
      market: "new_source",
      supervision: "reevaluate"
    };
    setIntent(intentByStage[exchange.suggestedStage]);
    setVerdict(exchange.suggestedAction === "accept"
      ? "correct"
      : exchange.suggestedAction === "human_review"
        ? "unclear"
        : "incorrect");
    setComment(exchange.instruction);
    setTags((current) => [...new Set([...current, ...exchange.tags])]);
    if (exchange.proposedCorrection) {
      setCorrection((current) => ({ ...current, ...exchange.proposedCorrection }));
      setDirtyCorrectionFields((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(exchange.proposedCorrection || {}).map((key) => [key, true]))
      }));
    }
    setReviewNotice("La propuesta quedó preparada. Revisa la acción principal antes de ejecutarla.");
  }

  function updateCorrection<K extends keyof HumanCorrection>(key: K, value: HumanCorrection[K]) {
    setCorrection((current) => ({ ...current, [key]: value }));
    setDirtyCorrectionFields((current) => ({ ...current, [key]: true }));
  }

  useEffect(() => {
    let active = true;
    void fetch(appPath(`/api/runs/${run.id}/items/${item.id}/memories?stage=${stage}`), { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active) setMemories((data.suggestions || []).slice(0, 6));
      })
      .catch(() => {
        if (active) setMemories([]);
      });
    return () => { active = false; };
  }, [run.id, item.id, stage, item.reviews?.length]);

  async function review(action: "record" | "apply" | "rerun" | "exclude") {
    setReviewing(action);
    setReviewError("");
    setReviewNotice("");
    const startedAt = Date.now();
    const baselineStepCount = run.steps.length;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const changedCorrection = Object.fromEntries(
      Object.keys(dirtyCorrectionFields).map((key) => [key, correction[key as keyof HumanCorrection]])
    ) as HumanCorrection;
    if (action === "apply" && verdict === "correct") {
      changedCorrection.decision = "accept";
    } else if (action === "apply" && verdict === "incorrect" && Object.keys(dirtyCorrectionFields).length > 0) {
      changedCorrection.decision = "accept_with_note";
    }

    if (action === "rerun") {
      const stages = correctionStagesFrom(stage);
      setRerunProgress({
        status: "starting",
        percent: 4,
        elapsedMs: 0,
        activeStage: stages[0],
        stages,
        completedStages: [],
        message: "Enviando la corrección al agente."
      });
      const poll = async () => {
        try {
          const pollResponse = await fetch(appPath(`/api/runs/${run.id}?correction=${Date.now()}`), { cache: "no-store" });
          const pollData = await pollResponse.json();
          if (pollResponse.ok && pollData.run) {
            setRerunProgress(correctionProgressFrom(pollData.run, item.id, stage, baselineStepCount, startedAt));
          }
        } catch {
          setRerunProgress((current) => current ? { ...current, elapsedMs: Date.now() - startedAt } : current);
        }
      };
      void poll();
      pollTimer = setInterval(() => void poll(), 800);
    }

    try {
      const response = await fetch(appPath(`/api/runs/${run.id}/feedback`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          verdict,
          stage,
          comment,
          tags,
          rememberForSimilar,
          action,
          correction: ["record", "exclude"].includes(action) || !Object.keys(changedCorrection).length ? undefined : changedCorrection,
          providerId: run.providerId
        })
      });
      const data = await response.json();
      if (data.run) onUpdated(data.run);
      if (!response.ok) {
        const message = data.error || "No fue posible guardar la evaluación.";
        setReviewError(message);
        if (action === "rerun") {
          setRerunProgress((current) => current ? { ...current, status: "failed", elapsedMs: Date.now() - startedAt, message } : current);
        }
      } else {
        if (action === "rerun") {
          const stages = correctionStagesFrom(stage);
          setRerunProgress({
            status: "completed",
            percent: 100,
            elapsedMs: Date.now() - startedAt,
            activeStage: stages.at(-1) || "supervision",
            stages,
            completedStages: stages,
            message: "Corrección terminada. El resultado del ítem ya fue actualizado."
          });
          setReviewNotice("El ítem fue reprocesado sin modificar los demás.");
        } else {
          setReviewNotice(action === "record"
            ? "La evaluación quedó guardada. No se ejecutó IA."
            : action === "exclude"
              ? "La fila salió del inventario activo y quedó conservada en la traza."
              : "Los datos manuales quedaron aplicados. No se ejecutó IA.");
        }
        setComment("");
        setTags([]);
        setRememberForSimilar(false);
        if (action !== "rerun" && onNext) {
          window.setTimeout(onNext, 120);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible completar la acción.";
      setReviewError(message);
      if (action === "rerun") {
        setRerunProgress((current) => current ? { ...current, status: "failed", elapsedMs: Date.now() - startedAt, message } : current);
      }
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      setReviewing("");
    }
  }
  const plan = item.technical?.resolutionPlan;
  const deviations = run.events.filter((entry) => entry.itemId === item.id && entry.kind === "warning");
  const firstDeviation = deviations[0]?.detail;
  const ceilingPrice = item.normalized?.ceilingPriceCop;
  const candidatePrice = item.market?.price;
  const comparison = priceComparisonLabel(ceilingPrice, candidatePrice, item.market?.currency);
  const normalization = splitNormalizationLog(item.normalized?.transformations || []);
  const requirements = uniquePresentationValues([
    ...(item.technical?.hardRequirements || []),
    ...(plan?.components || []).map((component) => `${component.label} · ${component.quantity ?? "?"} ${component.unit || ""}`.trim())
  ]);
  const unresolved = uniquePresentationValues([
    ...(plan?.missingInformation || []),
    ...(plan?.humanQuestions || []),
    ...(plan?.stopReasons || []),
    ...(item.technical?.ambiguities || []),
    ...(item.market?.missingComponents || []),
    ...(item.market?.calculationWarnings || [])
  ]).filter((entry) => cleanText(entry).toLocaleLowerCase("es-CO") !== cleanText(firstDeviation || "").toLocaleLowerCase("es-CO"));
  const hasManualChanges = Object.keys(dirtyCorrectionFields).length > 0;
  const primaryAction: "record" | "apply" | "rerun" | "exclude" = verdict === "correct"
    ? "apply"
    : verdict === "unclear"
      ? "record"
      : intent === "exclude"
        ? "exclude"
        : hasManualChanges
          ? "apply"
          : "rerun";
  const primaryLabel = primaryAction === "rerun"
    ? "Reprocesar ahora"
    : primaryAction === "exclude"
      ? `Marcar como no ítem${onNext ? " y siguiente" : ""}`
      : primaryAction === "apply" && verdict === "incorrect"
        ? `Aplicar datos manuales${onNext ? " y siguiente" : ""}`
        : verdict === "correct"
          ? `Aceptar${onNext ? " y siguiente" : ""}`
          : `Guardar con nota${onNext ? " y siguiente" : ""}`;
  const primaryNeedsComment = primaryAction === "rerun";
  const primaryDescription = primaryAction === "rerun"
    ? stage === "supervision"
      ? "Usará tu nota y repetirá únicamente la Supervisión. Los demás ítems no cambian."
      : `Usará tu nota y repetirá desde ${correctionStageLabel(stage)} hasta Supervisión. Los demás ítems no cambian.`
    : primaryAction === "exclude"
      ? "No ejecutará IA ni borrará la evidencia original."
      : "Guardará tu criterio sin ejecutar IA.";

  return <div className="inspector decision-inspector">
    <header className="decision-header">
      <div className="decision-navigation">
        <span className="eyebrow">{queueTotal > 0 ? `Ítem ${Math.max(1, queuePosition)} de ${queueTotal}` : `Ítem ${item.id}`}</span>
        <div className="inspector-header-actions">
          <button className="icon-button" disabled={!onPrevious} onClick={onPrevious} aria-label="Ítem anterior" title="Ítem anterior"><ArrowLeft size={16} /></button>
          <button className="icon-button" disabled={!onNext} onClick={onNext} aria-label="Ítem siguiente" title="Ítem siguiente"><ArrowRight size={16} /></button>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar detalle" title="Cerrar"><X size={17} /></button>
        </div>
      </div>
      <h3 title={item.original.name}>{item.original.name}</h3>
      <div className="decision-summary">
        <div className="decision-summary-status">
          <ConfidenceBadge value={effectiveConfidence(item)} />
          <EffectiveDecisionBadge item={item} />
        </div>
        <p title={firstDeviation || confidenceReason(item)}>{compactDecisionReason(firstDeviation || confidenceReason(item))}</p>
      </div>
      <div className="price-comparison">
        <div><span>Precio techo</span><strong>{ceilingPrice === null || ceilingPrice === undefined ? "No disponible" : formatMoney(ceilingPrice, "COP")}</strong></div>
        <div><span>Precio candidato</span><strong>{candidatePrice === null || candidatePrice === undefined ? "Sin candidato" : formatMoney(candidatePrice, item.market?.currency)}</strong>{comparison && <small>{comparison}</small>}</div>
      </div>
      <div className="candidate-glance">
        <div><span>Fuente candidata</span><strong>{item.market?.supplier || "Sin fuente comercial"}</strong><small>{item.market?.product || "Todavía no hay un producto para contrastar."}</small></div>
        {item.market?.url && <a href={item.market.url} target="_blank" rel="noreferrer" aria-label="Abrir fuente candidata">Abrir <ExternalLink size={13} /></a>}
      </div>
    </header>
    <section className="human-review">
      <div className="review-heading"><div><h4><MessageSquareText size={14} /> Tu decisión</h4><p>{verdict ? "La acción principal se adapta a tu veredicto." : "¿Esta referencia sirve para tomar una decisión de precio?"}</p></div>{item.humanDecision && <span className="human-applied">Ya revisado</span>}</div>
      <div className="review-verdict" role="group" aria-label="Veredicto humano">
        <button className={verdict === "correct" ? "selected correct" : ""} onClick={() => setVerdict("correct")}><Check size={14} /><span>Sirve<small>Usar la referencia</small></span></button>
        <button className={verdict === "unclear" ? "selected unclear" : ""} onClick={() => setVerdict("unclear")}><CircleHelp size={14} /><span>Tengo dudas<small>Guardar una observación</small></span></button>
        <button className={verdict === "incorrect" ? "selected incorrect" : ""} onClick={() => setVerdict("incorrect")}><X size={14} /><span>No sirve<small>Corregir o buscar de nuevo</small></span></button>
      </div>
      <details className="item-assistant" key={`assistant-${item.id}`}>
        <summary><span><Bot size={14} /> Consultar al agente</span><small>Pregunta sobre este ítem sin modificarlo.</small></summary>
        <div className="item-assistant-body">
          <div className="assistant-context"><span>Conversación sobre</span><strong title={item.original.name}>{item.original.name}</strong></div>
          <div className="assistant-compose">
            <label className="assistant-question-picker">
              <span>Pregunta sugerida</span>
              <select value="" onChange={(event) => event.target.value && setAssistantQuestion(event.target.value)}>
                <option value="">Elegir una pregunta...</option>
                {ASSISTANT_QUESTION_OPTIONS.map((question) => <option key={question} value={question}>{question}</option>)}
              </select>
            </label>
            <label className="assistant-question-field">
              <span>Tu pregunta</span>
              <textarea value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder="Describe la duda concreta sobre este resultado..." />
            </label>
            <button className="button compact primary" disabled={assistantLoading || !assistantQuestion.trim()} onClick={() => void askAssistant()}>{assistantLoading ? <LoaderCircle className="spin" size={14} /> : <MessageSquareText size={14} />} {assistantLoading ? "Consultando..." : "Enviar pregunta"}</button>
          </div>
          {assistantError && <p className="review-error">{assistantError}</p>}
          {assistantExchange && <article className="assistant-answer">
            <div className="assistant-message user"><span>Tu pregunta</span><p>{assistantExchange.question}</p></div>
            <div className="assistant-message agent">
              <div className="assistant-answer-heading"><strong>Agente</strong><span>{correctionStageLabel(assistantExchange.suggestedStage)}</span></div>
              <p>{assistantExchange.reply}</p>
            </div>
            <div className="assistant-recommendation">
              <div><span>Recomendación</span><strong>{assistantActionLabel(assistantExchange.suggestedAction)}</strong></div>
              <button className="button compact primary" onClick={() => prepareAssistantProposal(assistantExchange)}><Check size={14} /> Usar recomendación</button>
            </div>
            <details className="assistant-reasoning">
              <summary>Ver análisis y cambios propuestos</summary>
              <p>{assistantExchange.diagnosis}</p>
              <AssistantCorrectionDiff item={item} correction={assistantExchange.proposedCorrection} />
            </details>
          </article>}
        </div>
      </details>
      {verdict && verdict !== "correct" && <>
        <label className={`correction-intent-select ${intent === "exclude" ? "exclude" : ""}`}>
          <span>Qué quieres que haga el sistema</span>
          <select value={intent} onChange={(event) => setIntent(event.target.value as CorrectionIntent)}>
            {CORRECTION_INTENTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <small>{selectedCorrectionIntent.description}</small>
        </label>
        {memories.length > 0 && <label className="memory-picker">
          <span>Usar un tip de un caso parecido</span>
          <select value="" onChange={(event) => {
            const memory = memories.find((entry) => entry.memoryId === event.target.value);
            if (!memory) return;
            setComment(memory.guidance);
            setTags((current) => [...new Set([...current, memory.title])]);
          }}>
            <option value="">Elegir un precedente...</option>
            {memories.map((entry) => <option key={entry.memoryId} value={entry.memoryId}>{entry.title}{entry.strength === "recurring" ? " · frecuente" : ""}</option>)}
          </select>
        </label>}
        <label className="field-label">Indicación para la corrección<textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Qué entendió mal, qué debe conservar o cómo debe resolverlo..." /></label>
        <QuickReviewTags selected={tags} onChange={setTags} />
        {verdict === "incorrect" && <details className="correction-fields">
          <summary>Ajustar datos concretos</summary>
          <div className="correction-grid">
            <label>Proveedor<input value={correction.supplier || ""} onChange={(event) => updateCorrection("supplier", event.target.value)} /></label>
            <label>Producto<input value={correction.product || ""} onChange={(event) => updateCorrection("product", event.target.value)} /></label>
            <label>Precio<input type="number" value={correction.price ?? ""} onChange={(event) => updateCorrection("price", event.target.value === "" ? null : Number(event.target.value))} /></label>
            <label>Moneda<input value={correction.currency || ""} onChange={(event) => updateCorrection("currency", event.target.value)} /></label>
            <label className="wide">URL<input value={correction.url || ""} onChange={(event) => updateCorrection("url", event.target.value)} /></label>
          </div>
        </details>}
        <label className="remember-case"><input type="checkbox" checked={rememberForSimilar} onChange={(event) => setRememberForSimilar(event.target.checked)} /><span><strong>Recordar para casos parecidos</strong><small>Se guarda como precedente; solo gana fuerza si la misma corrección se confirma varias veces.</small></span></label>
      </>}
      {rerunProgress && <div className={`item-rerun-progress ${rerunProgress.status}`} aria-live="polite">
        <div className="item-rerun-donut" style={{ "--progress": `${rerunProgress.percent}%` } as React.CSSProperties}><span>{rerunProgress.percent}%</span></div>
        <div className="item-rerun-copy">
          <div><strong>{rerunProgress.status === "completed" ? "Corrección completada" : rerunProgress.status === "failed" ? "La corrección se detuvo" : "Reprocesando solo este ítem"}</strong><span>{formatDuration(rerunProgress.elapsedMs)}</span></div>
          <p>{rerunProgress.message}</p>
          <div className="item-rerun-stages">{rerunProgress.stages.map((entry) => {
            const active = entry === rerunProgress.activeStage && !["completed", "failed"].includes(rerunProgress.status);
            const complete = rerunProgress.completedStages.includes(entry) || rerunProgress.status === "completed";
            return <span key={entry} className={complete ? "complete" : active ? "active" : ""}>{complete ? <Check size={11} /> : active ? <LoaderCircle className="spin" size={11} /> : null}{correctionStageLabel(entry)}</span>;
          })}</div>
        </div>
      </div>}
      {reviewError && <p className="review-error">{reviewError}</p>}
      {reviewNotice && <p className="review-notice">{reviewNotice}</p>}
      {verdict ? <>
        <div className={`review-primary-action ${primaryAction === "exclude" ? "exclude" : ""}`}>
          <div><strong>{primaryLabel}</strong><p>{primaryDescription}</p></div>
          <button className={`button compact ${primaryAction === "exclude" ? "danger" : "primary"}`} disabled={Boolean(reviewing) || (primaryNeedsComment && !comment.trim())} onClick={() => void review(primaryAction)}>{reviewing === primaryAction ? <LoaderCircle className="spin" size={14} /> : primaryAction === "exclude" ? <Trash2 size={14} /> : primaryAction === "rerun" ? <RefreshCw size={14} /> : <Check size={14} />} {reviewing === primaryAction ? "Procesando..." : primaryLabel}</button>
        </div>
        {primaryNeedsComment && !comment.trim() && reviewing !== "rerun" && <small className="review-hint">Escribe una indicación arriba para habilitar el reproceso.</small>}
        <details className="review-secondary-actions">
          <summary>Más opciones <span>{primaryAction === "rerun" ? "Guardar sin reprocesar" : "Acciones alternativas"}</span></summary>
          <div>
            {primaryAction !== "record" && <button className="button compact secondary" disabled={Boolean(reviewing)} onClick={() => void review("record")}>{reviewing === "record" ? <LoaderCircle className="spin" size={14} /> : <MessageSquareText size={14} />} Guardar solo la nota</button>}
            {primaryAction !== "apply" && <button className="button compact secondary" disabled={Boolean(reviewing)} onClick={() => void review("apply")}>{reviewing === "apply" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Aplicar datos manuales</button>}
            {primaryAction !== "rerun" && <button className="button compact secondary" disabled={Boolean(reviewing) || !comment.trim()} onClick={() => void review("rerun")}>{reviewing === "rerun" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Reprocesar con la nota</button>}
          </div>
        </details>
      </> : <p className="review-empty-guidance">Elige una opción arriba. Solo se mostrarán los controles necesarios para esa decisión.</p>}
      {(item.reviews || []).length > 0 && <details className="review-history">
        <summary>Historial de decisiones <span>{item.reviews?.length}</span></summary>
        <div>{(item.reviews || []).map((entry) => <div className="review-note" key={entry.id || entry.createdAt}><strong>{entry.verdict} · {entry.stage}{entry.memoryId ? " · precedente guardado" : ""}</strong><p>{entry.comment || "Sin comentario"}</p>{entry.resolvedAt && <small>Corrección aplicada</small>}</div>)}</div>
      </details>}
    </section>
    <details className="inspector-evidence">
      <summary><span><Database size={14} /> Información del ítem</span><small>4 secciones</small></summary>
      <div className="evidence-groups">
        <details><summary><span><Database size={14} /> Documento original</span><small>Disponible</small></summary><section><p>{item.original.description || "Sin descripción adicional."}</p><div className="facts">{item.original.lot && <span>{item.original.lot}</span>}<span>{item.original.unit || "Sin unidad"}</span><span>Cant. {String(item.original.quantity || "—")}</span><span>{item.original.ceilingPrice || "Sin techo"}</span></div><small>{sourceText(item)}</small></section></details>
        <details><summary><span><Settings2 size={14} /> Normalización</span><small>{normalization.meaningful.length} cambio(s)</small></summary><section>{item.normalized ? <><p>{item.normalized.name}</p><KeyList label="Cambios relevantes" values={normalization.meaningful} />{normalization.unchanged.length > 0 && <details className="normalization-unchanged"><summary>{normalization.unchanged.length} campo(s) conservados sin cambios</summary><KeyList label="Detalle técnico" values={normalization.unchanged} /></details>}{item.normalized.fallbackFields?.length ? <KeyList label="Campos conservados del original" values={item.normalized.fallbackFields} /> : null}</> : <p className="muted">Etapa no ejecutada.</p>}</section></details>
        <details><summary><span><ShieldCheck size={14} /> Criterio técnico</span><small>{unresolved.length ? `${unresolved.length} pendiente(s)` : "Completo"}</small></summary><section>{item.technical && plan ? <><div className="facts"><span>{purchaseLabel(item.technical.purchaseMode)}</span><span>{resolutionModeLabel(plan.mode)}</span><span>{automationLabel(plan.automationLevel)}</span></div><p>{plan.rationale}</p><KeyList label="Lo que el ítem exige" values={requirements} /><KeyList label="Lo que queda sin resolver" values={unresolved} /></> : <p className="muted">Etapa no ejecutada.</p>}</section></details>
        <details><summary><span><Search size={14} /> Validación comercial</span><small>{item.market?.supplier ? "Con fuente" : "Sin fuente"}</small></summary><section>{item.market ? <><div className="market-focus"><strong>{item.market.supplier || "Sin proveedor"}</strong><span>{formatMoney(item.market.price, item.market.currency)}</span></div>{item.market.url && <a href={item.market.url} target="_blank" rel="noreferrer">Abrir evidencia <ExternalLink size={13} /></a>}<p>{item.market.notes}</p><div className="facts"><ConfidenceBadge value={effectiveConfidence(item)} /><EffectiveDecisionBadge item={item} /></div>{item.supervision && <details><summary>Controles de supervisión</summary><dl><dt>Fuente</dt><dd>{verificationLabel(item.supervision.sourceSupport)}</dd><dt>Precio observado</dt><dd>{verificationLabel(item.supervision.priceObserved)}</dd><dt>Producto</dt><dd>{verificationLabel(item.supervision.productMatch)}</dd><dt>Presentación</dt><dd>{verificationLabel(item.supervision.presentationMatch)}</dd><dt>Componentes</dt><dd>{verificationLabel(item.supervision.componentCompleteness)}</dd><dt>Cálculo</dt><dd>{verificationLabel(item.supervision.calculationValid)}</dd></dl><p>{item.supervision.reason}</p>{item.supervision.humanAction && <p><strong>Acción humana:</strong> {item.supervision.humanAction}</p>}</details>}</> : <p className="muted">Etapa no ejecutada.</p>}</section></details>
      </div>
    </details>
  </div>;
}

const QUICK_REVIEW_TAGS = [
  "Presentación incorrecta",
  "Unidad o empaque",
  "Accesorio faltante",
  "Servicio no incluido",
  "Equivalencia insuficiente",
  "Precio no sustentado",
  "URL general con referencia",
  "Conservar fuente"
];

function assistantActionLabel(value: ItemAssistantExchange["suggestedAction"]) {
  return ({
    accept: "Conservar el resultado",
    apply: "Aplicar una corrección concreta",
    rerun: "Reprocesar solo este ítem",
    exclude: "Retirar la fila del inventario",
    human_review: "Pedir una decisión humana"
  } as const)[value];
}

function AssistantCorrectionDiff({ item, correction }: { item: AgentItem; correction?: HumanCorrection }) {
  if (!correction || !Object.keys(correction).length) return null;
  const current: Partial<Record<keyof HumanCorrection, unknown>> = {
    name: item.normalized?.name,
    description: item.normalized?.description,
    unit: item.normalized?.unit,
    quantity: item.normalized?.quantity,
    ceilingPriceCop: item.normalized?.ceilingPriceCop,
    supplier: item.market?.supplier,
    product: item.market?.product,
    price: item.market?.price,
    currency: item.market?.currency,
    url: item.market?.url,
    notes: item.market?.notes
  };
  const labels: Partial<Record<keyof HumanCorrection, string>> = {
    name: "Nombre",
    description: "Descripción",
    unit: "Unidad",
    quantity: "Cantidad",
    ceilingPriceCop: "Precio techo",
    supplier: "Proveedor",
    product: "Producto",
    price: "Precio",
    currency: "Moneda",
    url: "URL",
    notes: "Notas"
  };
  const rows = Object.entries(correction).filter(([key, value]) =>
    value !== undefined && value !== current[key as keyof HumanCorrection]
  );
  if (!rows.length) return null;
  return <div className="assistant-diff"><strong>Cambios propuestos</strong>{rows.map(([key, value]) => <div key={key}><span>{labels[key as keyof HumanCorrection] || key}</span><del>{String(current[key as keyof HumanCorrection] ?? "Sin dato")}</del><ins>{String(value ?? "Sin dato")}</ins></div>)}</div>;
}

function QuickReviewTags({ selected, onChange }: { selected: string[]; onChange: (values: string[]) => void }) {
  const available = QUICK_REVIEW_TAGS.filter((tag) => !selected.includes(tag));
  return <div className="quick-tags">
    <label>
      <span>Agregar motivo frecuente</span>
      <select value="" onChange={(event) => event.target.value && onChange([...selected, event.target.value])}>
        <option value="">Elegir un motivo...</option>
        {available.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
      </select>
    </label>
    {selected.length > 0 && <div className="selected-review-tags">{selected.map((tag) => <button type="button" key={tag} title="Quitar motivo" onClick={() => onChange(selected.filter((entry) => entry !== tag))}>{tag}<X size={11} /></button>)}</div>}
  </div>;
}

function priceComparisonLabel(ceiling: number | null | undefined, candidate: number | null | undefined, currency?: string) {
  if (ceiling === null || ceiling === undefined || candidate === null || candidate === undefined || ceiling <= 0 || (currency && currency !== "COP")) return "";
  const difference = ((candidate - ceiling) / ceiling) * 100;
  if (Math.abs(difference) < 0.5) return "En el nivel del techo";
  return `${Math.abs(Math.round(difference))}% ${difference < 0 ? "bajo" : "sobre"} el techo`;
}

function compactDecisionReason(value: string, maxLength = 150) {
  const text = cleanText(value);
  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`;
}

function uniquePresentationValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => cleanText(value || ""))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase("es-CO").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function splitNormalizationLog(values: string[]) {
  const meaningful: string[] = [];
  const unchanged: string[] = [];
  for (const raw of uniquePresentationValues(values)) {
    const value = raw
      .replaceAll("original.name", "nombre original")
      .replaceAll("original.description", "descripción original")
      .replaceAll("original.unit", "unidad original")
      .replaceAll("ceilingPriceCop", "precio techo")
      .replace(/\bnull\b/gi, "sin dato");
    const lower = value.toLocaleLowerCase("es-CO");
    const mentionsRisk = /(trunc|incomplet|falt|correg|transform|convert|interpret|decimal|separador)/.test(lower);
    const onlyPreserved = /(copiad[oa]|conservad[oa]|establecid[oa] en sin dato|sin cambios)/.test(lower) && !mentionsRisk;
    (onlyPreserved ? unchanged : meaningful).push(value);
  }
  return { meaningful, unchanged };
}

function KeyList({ label, values }: { label: string; values?: string[] }) { if (!values?.length) return null; return <div className="key-list"><strong>{label}</strong><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>; }
function effectiveDecision(item: AgentItem) { return item.humanDecision?.decision || item.supervision?.decision || item.market?.decision || "no_result"; }
function effectiveConfidence(item: AgentItem): Confidence { return item.humanDecision?.confidence || item.supervision?.confidence || item.market?.confidence || "no_data"; }
function defaultReviewVerdict(item: AgentItem): "correct" | "" {
  if (item.supervision?.reviewRequirement === "none") return "correct";
  if (effectiveConfidence(item) === "high" && effectiveDecision(item) === "accept") return "correct";
  return "";
}
function ConfidenceBadge({ value }: { value: Confidence }) { const labels = { high: "Alta", medium: "Media", low: "Baja", no_data: "Sin datos" }; return <span className={`confidence ${value}`}>{labels[value]}</span>; }
function EffectiveDecisionBadge({ item }: { item: AgentItem }) { const value = effectiveDecision(item); const labels: Record<string, string> = { accept: "Usar", accept_with_note: "Referencia suficiente", retry: "Reintentar", human_review: "Revisión humana", no_result: "Sin resultado" }; return <span className={`decision ${value}`}>{labels[value]}</span>; }
function stageState(steps: AgentStep[], active: StageId, stage: StageId, runStatus: string) {
  if (steps.some((step) => step.status === "running") || (active === stage && runStatus === "running")) return "running";
  if (!steps.length) return "pending";
  const hasUsableCompletion = steps.some((step) => step.status === "passed" || step.status === "warning");
  if (steps.some((step) => step.status === "failed")) return hasUsableCompletion ? "warning" : "failed";
  if (steps.some((step) => step.status === "warning" || step.status === "skipped")) return "warning";
  if (steps.every((step) => step.status === "passed")) return "passed";
  return "pending";
}
function stageStateLabel(value: string) { return ({ passed: "Completada", warning: "Con observaciones", running: "En curso", failed: "Falló", pending: "Pendiente" } as Record<string, string>)[value] || value; }
function stepStatusLabel(value: AgentStep["status"]) { return ({ passed: "Completada", warning: "Completada con observaciones", running: "En curso", failed: "Falló", pending: "Pendiente", skipped: "Omitida" } as Record<AgentStep["status"], string>)[value]; }
function formatDuration(value: number) { const seconds = Math.max(0, Math.round(value / 1000)); if (seconds < 60) return `${seconds}s`; return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function formatMoney(value: number | null | undefined, currency = "COP") { if (value === null || value === undefined) return "—"; return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value)} ${currency || "COP"}`; }
function purchaseLabel(value: string) { return ({ exact: "Coincidencia exacta", defined_range: "Gama definida", open: "Abierto", unclear: "Por aclarar" } as Record<string, string>)[value] || value; }
function resolutionModeLabel(value: string) { return ({ direct_product: "Producto directo", pack_conversion: "Conversión de presentación", bulk_proration: "Compra a granel", bundle_bom: "Conjunto de componentes", product_plus_service: "Producto y servicio", equivalent_benchmark: "Referencia equivalente", custom_fabrication: "Fabricación a medida", ambiguous: "Estrategia por aclarar" } as Record<string, string>)[value] || value; }
function automationLabel(value: string) { return ({ automatic: "Automático", assisted: "Asistido", human: "Requiere persona" } as Record<string, string>)[value] || value; }
function verificationLabel(value: string) { return ({ yes: "Sí", partial: "Parcial", no: "No", unknown: "No observable", not_applicable: "No aplica" } as Record<string, string>)[value] || value; }
function sourceText(item: AgentItem) { const source = item.original.source; return [source.file, source.sheet && `Hoja ${source.sheet}`, source.row && `fila ${source.row}`, source.page && `página ${source.page}`].filter(Boolean).join(" · "); }
