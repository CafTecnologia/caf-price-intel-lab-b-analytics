"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { financialIngestToTableRows } from "@/lib/financial-ingest-preview-rows";
import type { FinancialIngestPayload } from "@/lib/stage3-to-financial-ingest";

type AiCallTrace = {
  provider?: string;
  model?: string;
  stage?: string;
  status?: string;
  durationMs?: number;
  httpStatus?: number;
  httpStatusText?: string;
  providerStatus?: string;
  providerReason?: string;
  providerMessage?: string;
  finishReason?: string;
  finishMessage?: string;
  retryable?: boolean;
  certainty?: string;
  events?: Array<Record<string, unknown>>;
};

type ApiResponse = {
  runId?: string;
  analysisId?: string;
  analysisCode?: string;
  result?: StageResult;
  raw?: string;
  cleaned?: string;
  model?: string;
  provider?: "gemini" | "deepseek";
  groundingMetadata?: unknown;
  usage?: UsageSummary;
  cost?: CostSummary;
  callTrace?: AiCallTrace | null;
  details?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  errorTitle?: string;
  errorAction?: string;
  errorCategory?: string;
  retryable?: boolean;
};

type StageResult = {
  metadata?: Record<string, unknown>;
  items?: Record<string, unknown>[];
  control_calidad?: Record<string, unknown>;
};

type UsageSummary = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
};

type CostSummary = {
  provider: string;
  model: string;
  pricingLabel: string;
  pricingVerifiedAt: string;
  pricingSourceUrl: string;
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
  searchUsd: number;
  totalUsd: number;
  searchBillingUnit?: string;
  searchBillableUnits?: number;
  note?: string;
};

type StageModels = {
  stage1: string;
  stage2: string;
  stage3: string;
};

type LoadingStage = "stage1" | "stage2" | "stage3" | "pipeline" | null;

type ProgressPhase = "idle" | "preparing" | "stage1" | "stage2" | "stage3" | "completed" | "failed";

type ProgressState = {
  phase: ProgressPhase;
  percent: number;
  label: string;
};

type ProgressStep = {
  id: "stage1" | "stage2" | "stage3";
  label: string;
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
};

type StageTiming = {
  stage1Ms?: number;
  stage2Ms?: number;
  stage3Ms?: number;
  totalMs?: number;
};

type StageErrorResponse = ApiResponse & {
  errorCode?: string;
  errorTitle?: string;
  errorAction?: string;
  errorCategory?: string;
  retryable?: boolean;
};

type ConfigResponse = {
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  model?: string;
  stageModels?: Partial<StageModels>;
  usage?: UsageSummary;
  cost?: CostSummary;
  ok?: boolean;
  message?: string;
  error?: string;
  errorAction?: string;
};

type HistoricalStage = {
  stage: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  itemCount?: number | null;
  totalTokens?: number | null;
  totalUsd?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  thinkingTokens?: number | null;
  inputUsd?: number | null;
  cachedInputUsd?: number | null;
  outputUsd?: number | null;
  searchUsd?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: StageResult | null;
  raw?: string | null;
  groundingMetadata?: unknown;
  aiStatus?: string | null;
  providerHttpCode?: number | null;
  providerFinishReason?: string | null;
  callTrace?: AiCallTrace | null;
};

type HistoricalRun = {
  runId: string;
  analysisId?: string | null;
  analysisCode?: string | null;
  odooProjectId?: string | null;
  calculationId?: string | null;
  createdAt: string;
  updatedAt: string;
  appVariant?: string | null;
  fileName?: string | null;
  fileHash?: string | null;
  status: string;
  totalTokens?: number | null;
  totalUsd?: number | null;
  totalDurationMs?: number | null;
  qualityRating?: string | null;
  qualityNotes?: string | null;
  stages: HistoricalStage[];
};

type RunsResponse = {
  runs?: HistoricalRun[];
  error?: string;
};

type RunDetailResponse = {
  run?: HistoricalRun;
  error?: string;
};

const AI_CALL_STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  error: "Error",
  timeout: "Tiempo agotado",
  cancelled: "Cancelado"
};

type SortConfig = {
  column: string;
  direction: "asc" | "desc";
};

const AI_MODEL_GROUPS = [
  {
    label: "Linea 3",
    models: [
      {
        value: "gemini-3.1-pro-preview",
        label: "3.1 Pro Preview"
      },
      {
        value: "gemini-3-flash-preview",
        label: "3 Flash Preview"
      },
      {
        value: "gemini-3.1-flash-lite-preview",
        label: "3.1 Flash-Lite Preview"
      }
    ]
  },
  {
    label: "Linea 2.5",
    models: [
      {
        value: "gemini-2.5-pro",
        label: "2.5 Pro"
      },
      {
        value: "gemini-2.5-flash",
        label: "2.5 Flash"
      },
      {
        value: "gemini-2.5-flash-lite",
        label: "2.5 Flash-Lite"
      }
    ]
  },
  {
    label: "Linea 2.0 anteriores",
    models: [
      {
        value: "gemini-2.0-flash",
        label: "2.0 Flash (anterior)"
      },
      {
        value: "gemini-2.0-flash-001",
        label: "2.0 Flash 001 (anterior)"
      },
      {
        value: "gemini-2.0-flash-lite",
        label: "2.0 Flash-Lite (anterior)"
      },
      {
        value: "gemini-2.0-flash-lite-001",
        label: "2.0 Flash-Lite 001 (anterior)"
      }
    ]
  }
];

const KNOWN_AI_MODELS = new Set(
  AI_MODEL_GROUPS.flatMap((group) => group.models.map((item) => item.value))
);

const EMPTY_STAGE_MODELS: StageModels = {
  stage1: "",
  stage2: "",
  stage3: ""
};

const INITIAL_PROGRESS_STEPS: ProgressStep[] = [
  {
    id: "stage1",
    label: "Etapa 1: extracción y normalización",
    status: "pending"
  },
  {
    id: "stage2",
    label: "Etapa 2: lectura técnica",
    status: "pending"
  }
];

const STAGE3_PROGRESS_STEPS: ProgressStep[] = [
  {
    id: "stage3",
    label: "Etapa 3: cotización de precios",
    status: "pending"
  }
];

function Home() {
  const searchParams = useSearchParams();
  const urlOdooProjectId = useMemo(() => searchParams.get("odooProjectId")?.trim() || undefined, [searchParams]);
  const urlAnalysisId = useMemo(() => searchParams.get("analysisId")?.trim() || undefined, [searchParams]);

  const [file, setFile] = useState<File | null>(null);
  const [stage1, setStage1] = useState<ApiResponse | null>(null);
  const [stage2, setStage2] = useState<ApiResponse | null>(null);
  const [stage3, setStage3] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<LoadingStage>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState>({
    phase: "idle",
    percent: 0,
    label: "Listo"
  });
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>(INITIAL_PROGRESS_STEPS);
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stageTiming, setStageTiming] = useState<StageTiming>({});
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [stageModels, setStageModels] = useState<StageModels>(EMPTY_STAGE_MODELS);
  const [savedConfig, setSavedConfig] = useState<ConfigResponse | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configBusy, setConfigBusy] = useState<"save" | "test" | null>(null);
  const [financialBusy, setFinancialBusy] = useState(false);
  const [financialMessage, setFinancialMessage] = useState<string | null>(null);
  const [financialCalculationId, setFinancialCalculationId] = useState<string | null>(null);
  const [financialIngestPreview, setFinancialIngestPreview] = useState<FinancialIngestPayload | null>(null);
  const [financialPreviewLoading, setFinancialPreviewLoading] = useState(false);
  const [financialPreviewError, setFinancialPreviewError] = useState<string | null>(null);
  const [runs, setRuns] = useState<HistoricalRun[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [openingRunId, setOpeningRunId] = useState<string | null>(null);
  const [historicalRun, setHistoricalRun] = useState<HistoricalRun | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [activeAnalysisCode, setActiveAnalysisCode] = useState<string | null>(null);
  const [ignoreUrlAnalysisId, setIgnoreUrlAnalysisId] = useState(false);

  const isHistoricalMode = useMemo(() => historicalRun !== null, [historicalRun]);

  function appendStage1FormContext(formData: FormData) {
    if (urlOdooProjectId) {
      formData.append("odooProjectId", urlOdooProjectId);
    }
    const analysisForRequest = activeAnalysisId || (!ignoreUrlAnalysisId ? urlAnalysisId : undefined);
    if (analysisForRequest) {
      formData.append("analysisId", analysisForRequest);
    }
  }

  useEffect(() => {
    void loadConfig();
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!stage3?.result) {
      setFinancialIngestPreview(null);
      setFinancialPreviewError(null);
      setFinancialPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setFinancialPreviewLoading(true);
    setFinancialPreviewError(null);
    setFinancialMessage(null);
    setFinancialCalculationId(null);

    void fetch("/api/financial-offer/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage3Result: stage3.result, externalId: null })
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ingest?: FinancialIngestPayload;
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setFinancialIngestPreview(null);
          setFinancialPreviewError(payload.error ?? "No se pudo armar la vista previa de Etapa 4.");
          return;
        }
        setFinancialIngestPreview(payload.ingest ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setFinancialIngestPreview(null);
          setFinancialPreviewError("Error de red al generar la vista previa.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFinancialPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [stage3?.result]);

  useEffect(() => {
    if (!processStartedAt || (loading !== "pipeline" && loading !== "stage3")) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processStartedAt);
      setProgress((current) => {
        if (current.phase === "stage1") {
          return { ...current, percent: Math.min(current.percent + 1, 48) };
        }

        if (current.phase === "stage2") {
          return { ...current, percent: Math.min(current.percent + 1, 92) };
        }

        if (current.phase === "stage3") {
          return { ...current, percent: Math.min(current.percent + 1, 94) };
        }

        return current;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [loading, processStartedAt]);

  async function loadConfig() {
    const response = await fetch("/api/config");
    const payload = (await response.json()) as ConfigResponse;

    if (response.ok) {
      setSavedConfig(payload);
      setModel(payload.model ?? "");
      setStageModels(normalizeStageModels(payload.stageModels));
    } else {
      setConfigMessage(payload.error ?? "No se pudo leer la configuración.");
    }
  }

  async function loadRuns() {
    const response = await fetch("/api/runs?limit=50");
    const payload = (await response.json()) as RunsResponse;

    if (!response.ok) {
      setHistoryMessage(payload.error ?? "No se pudo leer el historial.");
      return;
    }

    setHistoryMessage(null);
    setRuns(payload.runs ?? []);
  }

  async function openHistoricalRun(nextRunId: string) {
    setOpeningRunId(nextRunId);
    setHistoryMessage(null);

    const response = await fetch(`/api/runs/${encodeURIComponent(nextRunId)}`);
    const payload = (await response.json()) as RunDetailResponse;

    if (!response.ok || !payload.run) {
      setHistoryMessage(payload.error ?? "No se pudo abrir la corrida.");
      setOpeningRunId(null);
      return;
    }

    const nextRun = payload.run;
    setHistoricalRun(nextRun);
    setActiveAnalysisId(nextRun.analysisId ?? null);
    setActiveAnalysisCode(nextRun.analysisCode ?? null);
    setIgnoreUrlAnalysisId(true);
    setFile(null);
    setFileInputKey((current) => current + 1);
    setRunId(nextRun.runId);
    setStage1(stageToApiResponse(nextRun, "stage1"));
    setStage2(stageToApiResponse(nextRun, "stage2"));
    setStage3(stageToApiResponse(nextRun, "stage3"));
    setError(null);
    setPipelineStatus(getHistoricalRunSummary(nextRun));
    setLoading(null);
    setProcessStartedAt(null);
    setElapsedMs(Number(nextRun.totalDurationMs ?? 0));
    setStageTiming({ totalMs: Number(nextRun.totalDurationMs ?? 0) });
    setProgress({ phase: "idle", percent: 0, label: "Listo" });
    setProgressSteps(INITIAL_PROGRESS_STEPS);
    setHistoryOpen(false);
    setOpeningRunId(null);
  }

  function startNewRun() {
    setHistoricalRun(null);
    setFile(null);
    setFileInputKey((current) => current + 1);
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setRunId(null);
    setError(null);
    setPipelineStatus(null);
    setLoading(null);
    setProcessStartedAt(null);
    setElapsedMs(0);
    setStageTiming({});
    setProgress({ phase: "idle", percent: 0, label: "Listo" });
    setProgressSteps(INITIAL_PROGRESS_STEPS);
    setFinancialMessage(null);
    setFinancialCalculationId(null);
    setActiveAnalysisId(null);
    setActiveAnalysisCode(null);
    setIgnoreUrlAnalysisId(true);
  }

  async function saveConfig() {
    setConfigBusy("save");
    setConfigMessage(null);

    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, model, stageModels })
    });
    const payload = (await response.json()) as ConfigResponse;

    if (!response.ok) {
      setConfigMessage(payload.error ?? "No se pudo guardar la configuración.");
    } else {
      setSavedConfig(payload);
      setApiKey("");
      setConfigMessage("Configuración guardada.");
    }

    setConfigBusy(null);
  }

  async function testConfig() {
    setConfigBusy("test");
    setConfigMessage(null);

    const response = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, model })
    });
    const payload = (await response.json()) as ConfigResponse;

    setConfigMessage(
      response.ok
        ? [
            payload.message ?? `Conexion exitosa con el motor IA (${getModelDisplayName(payload.model)}).`,
            payload.usage ? `Tokens prueba: ${payload.usage.totalTokens.toLocaleString("es-CO")}.` : null,
            payload.cost ? `Costo est.: ${formatUsd(payload.cost.totalUsd)}.` : null
          ]
            .filter(Boolean)
            .join(" ")
        : buildUserErrorMessage(payload, "No se pudo conectar con el motor IA.")
    );
    setConfigBusy(null);
  }

  async function runPipeline(nextFile: File) {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» antes de procesar otro archivo.");
      return;
    }

    const totalStartedAt = Date.now();

    setLoading("pipeline");
    setError(null);
    setRunId(null);
    setPipelineStatus("Procesando Etapa 1 y Etapa 2 automáticamente...");
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setActiveAnalysisId(null);
    setActiveAnalysisCode(null);
    setProcessStartedAt(totalStartedAt);
    setElapsedMs(0);
    setStageTiming({});
    setProgressSteps(INITIAL_PROGRESS_STEPS);
    setProgress({
      phase: "preparing",
      percent: 5,
      label: "Preparando archivo"
    });

    const formData = new FormData();
    formData.append("file", nextFile);
    appendStage1FormContext(formData);

    setProgress({
      phase: "stage1",
      percent: 12,
      label: "Etapa 1: extrayendo y normalizando"
    });
    setProgressStep("stage1", { status: "running" });

    const stage1StartedAt = Date.now();
    const stage1Response = await fetch("/api/stage1", {
      method: "POST",
      body: formData
    });
    const stage1Payload = (await stage1Response.json()) as StageErrorResponse;
    const stage1Ms = Date.now() - stage1StartedAt;

    setStage1(stage1Payload);
    setRunId(stage1Payload.runId ?? null);
    if (stage1Response.ok && stage1Payload.analysisId) {
      setActiveAnalysisId(stage1Payload.analysisId);
      setActiveAnalysisCode(stage1Payload.analysisCode ?? null);
    }
    setStageTiming((current) => ({ ...current, stage1Ms }));

    if (!stage1Response.ok || !stage1Payload.result) {
      setProgressStep("stage1", { status: "failed", durationMs: stage1Ms });
      finishPipelineAsFailed(totalStartedAt, stage1Payload, "stage1");
      return;
    }

    setProgressStep("stage1", { status: "done", durationMs: stage1Ms });
    setProgress({
      phase: "stage2",
      percent: 62,
      label: "Etapa 2: lectura técnica para cotización"
    });
    setProgressStep("stage2", { status: "running" });

    const stage2StartedAt = Date.now();
    const stage2Response = await fetch("/api/stage2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage1Json: stage1Payload.result, runId: stage1Payload.runId })
    });
    const stage2Payload = (await stage2Response.json()) as StageErrorResponse;
    const stage2Ms = Date.now() - stage2StartedAt;

    setStage2(stage2Payload);
    setRunId(stage2Payload.runId ?? stage1Payload.runId ?? null);
    setStageTiming((current) => ({ ...current, stage2Ms }));

    if (!stage2Response.ok || !stage2Payload.result) {
      setProgressStep("stage2", { status: "failed", durationMs: stage2Ms });
      finishPipelineAsFailed(totalStartedAt, stage2Payload, "stage2");
      return;
    }

    const totalMs = Date.now() - totalStartedAt;
    setProgressStep("stage2", { status: "done", durationMs: stage2Ms });
    setStageTiming((current) => ({ ...current, totalMs }));
    setElapsedMs(totalMs);
    setProgress({
      phase: "completed",
      percent: 100,
      label: "Proceso completo"
    });
    setPipelineStatus("Procesamiento completo: Etapa 1 y Etapa 2 finalizadas. Etapa 3 queda lista para ejecutar manualmente.");
    setLoading(null);
    void loadRuns();
  }

  function finishPipelineAsFailed(
    totalStartedAt: number,
    failure: StageErrorResponse,
    failedStage: "stage1" | "stage2"
  ) {
    const totalMs = Date.now() - totalStartedAt;
    const stageName = failedStage === "stage1" ? "Etapa 1" : "Etapa 2";
    const code = failure.errorCode ? ` Código: ${failure.errorCode}.` : "";
    const action = failure.errorAction ? ` Qué hacer: ${failure.errorAction}` : "";
    const title = failure.errorTitle ? `${failure.errorTitle}: ` : "";
    const message = failure.error ?? `No se pudo completar la ${stageName}.`;

    setElapsedMs(totalMs);
    setStageTiming((current) => ({ ...current, totalMs }));
    setProgress({
      phase: "failed",
      percent: failedStage === "stage1" ? 35 : 78,
      label: "Proceso detenido"
    });
    setError(`${title}${message}${action}${code} Falló en ${stageName}.`);
    setPipelineStatus("Procesamiento detenido. El detalle técnico quedó en el log y el JSON crudo queda visible si existe.");
    setLoading(null);
    void loadRuns();
  }

  function setProgressStep(id: ProgressStep["id"], patch: Partial<ProgressStep>) {
    setProgressSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step))
    );
  }

  async function runStage1() {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» para procesar otro archivo.");
      return;
    }

    if (!file) {
      setError("Carga un archivo antes de ejecutar la Etapa 1.");
      return;
    }

    setLoading("stage1");
    setError(null);
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setActiveAnalysisId(null);
    setActiveAnalysisCode(null);

    const formData = new FormData();
    formData.append("file", file);
    appendStage1FormContext(formData);

    const response = await fetch("/api/stage1", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as StageErrorResponse;
    setRunId(payload.runId ?? null);
    if (response.ok && payload.analysisId) {
      setActiveAnalysisId(payload.analysisId);
      setActiveAnalysisCode(payload.analysisCode ?? null);
    }

    if (!response.ok) {
      setStage1(payload);
      setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 1."));
    } else {
      setStage1(payload);
    }

    setLoading(null);
  }

  async function runStage2() {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» para procesar otro archivo.");
      return;
    }

    if (!stage1?.result) {
      setError("Ejecuta primero la Etapa 1.");
      return;
    }

    setLoading("stage2");
    setError(null);
    setStage2(null);
    setStage3(null);

    const response = await fetch("/api/stage2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage1Json: stage1.result, runId: stage1.runId })
    });
    const payload = (await response.json()) as StageErrorResponse;
    setRunId(payload.runId ?? stage1.runId ?? null);

    if (!response.ok) {
      setStage2(payload);
      setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 2."));
    } else {
      setStage2(payload);
    }

    setLoading(null);
  }

  async function runStage3() {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» para procesar otro archivo.");
      return;
    }

    if (!stage2?.result) {
      setError("Ejecuta primero la Etapa 2.");
      return;
    }

    setLoading("stage3");
    setError(null);
    setStage3(null);
    setPipelineStatus("Etapa 3: buscando fuentes de precio con el motor IA...");

    const startedAt = Date.now();
    setProcessStartedAt(startedAt);
    setElapsedMs(0);
    setStageTiming({});
    setProgressSteps(STAGE3_PROGRESS_STEPS);
    setProgress({
      phase: "stage3",
      percent: 10,
      label: "Etapa 3: cotizando precios"
    });
    setProgressStep("stage3", { status: "running" });

    const response = await fetch("/api/stage3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage2Json: stage2.result, runId: stage2.runId ?? runId })
    });
    const payload = (await response.json()) as StageErrorResponse;
    const stage3Ms = Date.now() - startedAt;

    setRunId(payload.runId ?? stage2.runId ?? runId);
    setElapsedMs(stage3Ms);
    setStageTiming({ stage3Ms, totalMs: stage3Ms });

    if (!response.ok) {
      setStage3(payload);
      setProgressStep("stage3", { status: "failed", durationMs: stage3Ms });
      setProgress({
        phase: "failed",
        percent: 72,
        label: "Etapa 3 detenida"
      });
      setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 3."));
      setPipelineStatus("Etapa 3 detenida. El detalle técnico quedó en el log y el JSON crudo queda visible si existe.");
    } else {
      setStage3(payload);
      setProgressStep("stage3", { status: "done", durationMs: stage3Ms });
      setProgress({
        phase: "completed",
        percent: 100,
        label: "Etapa 3 completa"
      });
      setPipelineStatus(`Etapa 3 finalizada en ${formatDuration(stage3Ms)}.`);
    }

    setLoading(null);
    void loadRuns();
  }

  async function sendStage3ToFinancialOffer() {
    if (!stage3?.result) {
      setFinancialMessage("Ejecuta primero la Etapa 3.");
      return;
    }

    setFinancialBusy(true);
    setFinancialMessage(null);
    setFinancialCalculationId(null);

    try {
      const response = await fetch("/api/financial-offer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage3Result: stage3.result,
          externalId: null,
          ...(activeAnalysisId ? { analysisId: activeAnalysisId } : {})
        })
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        publicUrl?: string;
        calculationId?: string;
        upstream?: { url?: string; calculationId?: string };
      };

      if (!response.ok || !payload.ok) {
        setFinancialMessage(
          payload.error ?? "Simulador Financiero no aceptó los datos. Revisá la consola o la respuesta técnica."
        );
        return;
      }

      const calcId = payload.calculationId ?? payload.upstream?.calculationId ?? null;
      setFinancialCalculationId(typeof calcId === "string" ? calcId : null);
      setFinancialMessage(
        "Listo: el cálculo quedó en Simulador Financiero. Usá el botón de abajo para abrirlo aquí mismo (vista integrada en /finanzas)."
      );
      void loadRuns();
    } catch {
      setFinancialMessage("No se pudo conectar con Simulador Financiero (red o URL del servidor).");
    } finally {
      setFinancialBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="topbar">
        <div>
          <p className="eyebrow">Suite de análisis técnico y financiero · Extracción de datos estratégicos</p>
          <h1>Extracción de datos estratégicos</h1>
          {urlOdooProjectId || urlAnalysisId || activeAnalysisCode ? (
            <p className="muted contextLine">
              {activeAnalysisCode ? (
                <>
                  Análisis activo: <code className="inlineCode">{activeAnalysisCode}</code>
                  {activeAnalysisId ? (
                    <>
                      {" "}
                      (<span className="muted">id {shortId(activeAnalysisId)}</span>)
                    </>
                  ) : null}
                </>
              ) : null}
              {urlOdooProjectId ? (
                <span>
                  {activeAnalysisCode ? " · " : ""}
                  Proyecto Odoo (URL): <code className="inlineCode">{urlOdooProjectId}</code>
                </span>
              ) : null}
              {urlAnalysisId && !activeAnalysisCode ? (
                <span>
                  {(urlOdooProjectId || activeAnalysisCode) ? " · " : ""}
                  Análisis predefinido (URL): <code className="inlineCode">{shortId(urlAnalysisId)}</code>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <nav className="topbarNav" aria-label="Navegación principal">
          <a className="topbarNavLink" href="#historial-pipeline">
            Sesiones guardadas
          </a>
          <a className="topbarNavLink" href="/finanzas">
            Simulador Financiero
          </a>
        </nav>
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <h2>Configuración del motor IA</h2>
          {savedConfig?.hasApiKey ? (
            <span className="badge">API key guardada {savedConfig.maskedApiKey}</span>
          ) : (
            <span className="badge">Sin API key</span>
          )}
        </div>

        <div className="configGrid">
          <label>
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={savedConfig?.hasApiKey ? "Dejar vacío para conservar la guardada" : "Pegá tu API key"}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          <label>
            <span>Modelo del motor IA</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">Selecciona un modelo</option>
              {model && !KNOWN_AI_MODELS.has(model) ? (
                <option value={model}>{getModelDisplayName(model)} (guardado)</option>
              ) : null}
              {AI_MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="stageConfigBlock">
          <p className="muted">
            Modelo por defecto para todo el flujo. Opcionalmente podés escoger otro por etapa.
          </p>
          <div className="stageModelGrid">
            <StageModelSelect
              label="Etapa 1"
              value={stageModels.stage1}
              defaultModel={model}
              onChange={(value) => setStageModels((current) => ({ ...current, stage1: value }))}
            />
            <StageModelSelect
              label="Etapa 2"
              value={stageModels.stage2}
              defaultModel={model}
              onChange={(value) => setStageModels((current) => ({ ...current, stage2: value }))}
            />
            <StageModelSelect
              label="Etapa 3"
              value={stageModels.stage3}
              defaultModel={model}
              onChange={(value) => setStageModels((current) => ({ ...current, stage3: value }))}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" onClick={saveConfig} disabled={configBusy !== null}>
            {configBusy === "save" ? "Guardando..." : "Guardar configuración"}
          </button>
          <button type="button" className="secondary" onClick={testConfig} disabled={configBusy !== null}>
            {configBusy === "test" ? "Probando..." : "Probar conexión"}
          </button>
        </div>

        {configMessage ? <div className="notice">{configMessage}</div> : null}
      </section>

      <HistorySection
        isOpen={historyOpen}
        message={historyMessage}
        runs={runs}
        openingRunId={openingRunId}
        onOpenRun={(id) => void openHistoricalRun(id)}
        onRefresh={() => void loadRuns()}
        onToggle={() => setHistoryOpen((current) => !current)}
      />

      <section className="panel">
        {historicalRun ? (
          <div className="historicalHeader">
            <div>
              <label className="fileLabel">Sesión guardada (solo lectura)</label>
              <p className="muted">
                {formatDateTime(historicalRun.updatedAt)} - {getRunDisplayStatus(historicalRun).label} -{" "}
                {shortId(historicalRun.runId)}
              </p>
            </div>
            <button type="button" onClick={startNewRun}>
              Nuevo análisis
            </button>
          </div>
        ) : (
          <>
            <label className="fileLabel" htmlFor="document-file">
              Archivo
            </label>
            <input
              key={fileInputKey}
              id="document-file"
              type="file"
              accept=".txt,.csv,.xlsx,.docx,.pdf"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setError(null);
                if (nextFile) {
                  void runPipeline(nextFile);
                }
              }}
            />
            {file ? <p className="muted">{file.name}</p> : null}
            <p className="muted">
              Al cargar un archivo, la app ejecuta automáticamente Etapa 1 y Etapa 2. La Etapa 3 se ejecuta manualmente.
            </p>
          </>
        )}

        <div className="actions">
          <button type="button" onClick={() => file && runPipeline(file)} disabled={isHistoricalMode || loading !== null || !file}>
            {loading === "pipeline" ? "Procesando..." : "Reintentar flujo completo"}
          </button>
          <button type="button" className="secondary" onClick={runStage1} disabled={isHistoricalMode || loading !== null}>
            {loading === "stage1" ? "Extrayendo..." : "1. Extraer y normalizar"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={runStage2}
            disabled={isHistoricalMode || loading !== null || !stage1?.result}
          >
            {loading === "stage2" ? "Analizando..." : "2. Analizar técnicamente"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={runStage3}
            disabled={isHistoricalMode || loading !== null || !stage2?.result}
          >
            {loading === "stage3" ? "Cotizando..." : "3. Cotizar precios"}
          </button>
        </div>

        {historicalRun ? (
          <p className="muted">Esta sesión está en modo lectura. Para procesar otro archivo usá «Nuevo análisis».</p>
        ) : null}

        <ProcessingMonitor
          elapsedMs={elapsedMs}
          progress={progress}
          steps={progressSteps}
          timing={stageTiming}
        />

        {pipelineStatus ? <div className="notice">{pipelineStatus}</div> : null}
        {error ? <div className="error">{error}</div> : null}
        {runId ? <p className="muted">Run tecnico: {runId}</p> : null}
      </section>

      <StageSection title="Resultado Etapa 1" response={stage1} />
      <StageSection title="Resultado Etapa 2" response={stage2} />
      <StageSection title="Resultado Etapa 3" response={stage3} />

      <IngestStageSection
        stage3Done={Boolean(stage3?.result)}
        ingest={financialIngestPreview}
        loading={financialPreviewLoading}
        previewError={financialPreviewError}
        financialBusy={financialBusy}
        financialMessage={financialMessage}
        financialCalculationId={financialCalculationId}
        onSend={() => void sendStage3ToFinancialOffer()}
        canSend={
          Boolean(stage3?.result) &&
          !financialPreviewLoading &&
          !financialPreviewError &&
          Boolean(financialIngestPreview?.items?.length)
        }
      />
    </main>
  );
}

function HistorySection({
  isOpen,
  message,
  runs,
  openingRunId,
  onOpenRun,
  onRefresh,
  onToggle
}: {
  isOpen: boolean;
  message: string | null;
  runs: HistoricalRun[];
  openingRunId: string | null;
  onOpenRun: (runId: string) => void;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  return (
    <section className="panel" id="historial-pipeline">
      <div className="sectionHeader stageHeader">
        <div className="stageHeaderTitle">
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? "Ocultar lista" : "Mostrar lista"}
            className="sectionToggle"
            onClick={onToggle}
            type="button"
          >
            {isOpen ? "-" : "+"}
          </button>
          <div>
            <h2>Sesiones guardadas</h2>
            <p className="muted historySubtitle">
              Cada fila es una ejecución del flujo por etapas (Etapas 1-3) persistida en esta instalación. Pronto podrás enlazarla a un proyecto u
              oferta comercial.
            </p>
          </div>
        </div>
        <div className="sectionBadges">
          <span className="badge">{runs.length} sesiones</span>
          <button className="secondary miniButton" onClick={onRefresh} type="button">
            Actualizar
          </button>
        </div>
      </div>

      {message ? <div className="error">{message}</div> : null}

      {isOpen ? (
        <>
          {runs.length === 0 ? (
            <p className="muted">Todavía no hay sesiones guardadas. Procesá un archivo para crear la primera.</p>
          ) : (
            <div className="historyTableWrap">
              <table className="historyTable">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Archivo</th>
                    <th>Análisis</th>
                    <th>Estado</th>
                    <th>Variante</th>
                    <th>Etapas/modelos</th>
                    <th>Tokens</th>
                    <th>Costo</th>
                    <th>Tiempo</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const displayStatus = getRunDisplayStatus(run);

                    return (
                      <tr key={run.runId}>
                        <td>
                          <strong>{formatDateTime(run.updatedAt)}</strong>
                          <span className="muted smallText">{shortId(run.runId)}</span>
                        </td>
                        <td>
                          <strong>{run.fileName ?? "Sin archivo"}</strong>
                          {run.fileHash ? (
                            <span className="muted smallText">Hash {run.fileHash.slice(0, 10)}</span>
                          ) : null}
                        </td>
                        <td>
                          {run.analysisCode ? (
                            <>
                              <strong>{run.analysisCode}</strong>
                              {run.odooProjectId ? (
                                <span className="muted smallText">Odoo proyecto: {run.odooProjectId}</span>
                              ) : (
                                <span className="muted smallText">Sin proyecto Odoo</span>
                              )}
                              {run.calculationId ? (
                                <span className="muted smallText">Cálculo: {shortId(run.calculationId)}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>
                          <span className={`statusPill ${displayStatus.className}`}>{displayStatus.label}</span>
                        </td>
                        <td>{run.appVariant ?? "-"}</td>
                        <td>
                          <div className="stageMiniList">
                            {(Array.isArray(run.stages) ? run.stages : []).map((stage) => (
                              <span key={stage.stage}>
                                {formatStageLabel(stage.stage)}: {stage.provider ?? "-"} /{" "}
                                {getModelDisplayName(stage.model ?? undefined)}
                                {stage.aiStatus
                                  ? ` - ${formatAiCallStatus({
                                      status: stage.aiStatus,
                                      httpStatus: stage.providerHttpCode ?? undefined,
                                      finishReason: stage.providerFinishReason ?? undefined
                                    })}`
                                  : ""}
                                {stage.errorCode ? ` (${stage.errorCode})` : ""}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>{formatNumber(run.totalTokens)}</td>
                        <td>{typeof run.totalUsd === "number" ? formatUsd(run.totalUsd) : ""}</td>
                        <td>{formatDuration(Number(run.totalDurationMs ?? 0))}</td>
                        <td>
                          <button
                            className="secondary miniButton"
                            disabled={openingRunId !== null}
                            onClick={() => onOpenRun(run.runId)}
                            type="button"
                          >
                            {openingRunId === run.runId ? "Abriendo..." : "Abrir"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function stageToApiResponse(run: HistoricalRun, stageName: "stage1" | "stage2" | "stage3"): ApiResponse | null {
  const stage = (Array.isArray(run.stages) ? run.stages : []).find((item) => item.stage === stageName);

  if (!stage) {
    return null;
  }

  return {
    runId: run.runId,
    result: stage.result ?? undefined,
    raw: stage.raw ?? undefined,
    provider: normalizeHistoricalProvider(stage.provider),
    model: stage.model ?? undefined,
    groundingMetadata: stage.groundingMetadata,
    usage: buildHistoricalUsage(stage),
    cost: buildHistoricalCost(stage),
    callTrace: stage.callTrace ?? undefined,
    error: stage.errorMessage ?? undefined,
    errorCode: stage.errorCode ?? undefined,
    errorTitle: stage.status === "failed" ? "Etapa fallida" : undefined
  };
}

function buildHistoricalUsage(stage: HistoricalStage): UsageSummary | undefined {
  if (typeof stage.totalTokens !== "number") {
    return undefined;
  }

  return {
    inputTokens: Number(stage.inputTokens ?? 0),
    cachedInputTokens: Number(stage.cachedInputTokens ?? 0),
    outputTokens: Number(stage.outputTokens ?? 0),
    thinkingTokens: Number(stage.thinkingTokens ?? 0),
    totalTokens: stage.totalTokens
  };
}

function buildHistoricalCost(stage: HistoricalStage): CostSummary | undefined {
  if (typeof stage.totalUsd !== "number") {
    return undefined;
  }

  return {
    provider: stage.provider ?? "historico",
    model: stage.model ?? "historico",
    pricingLabel: "Historico guardado",
    pricingVerifiedAt: "",
    pricingSourceUrl: "",
    inputUsd: Number(stage.inputUsd ?? 0),
    cachedInputUsd: Number(stage.cachedInputUsd ?? 0),
    outputUsd: Number(stage.outputUsd ?? 0),
    searchUsd: Number(stage.searchUsd ?? 0),
    totalUsd: stage.totalUsd
  };
}

function normalizeHistoricalProvider(provider: string | null | undefined): ApiResponse["provider"] {
  return provider === "deepseek" || provider === "gemini" ? provider : undefined;
}

function getHistoricalRunSummary(run: HistoricalRun) {
  const displayStatus = getRunDisplayStatus(run);
  const stages = (Array.isArray(run.stages) ? run.stages : [])
    .map((stage) => formatStageLabel(stage.stage))
    .join(", ");

  if (displayStatus.className === "incomplete") {
    return `Sesión guardada incompleta. Se guardó: ${stages || "ninguna etapa"}.`;
  }

  if (displayStatus.className === "failed") {
    return "Sesión guardada con fallo. Podés revisar las etapas guardadas y el mensaje de error.";
  }

  return `Sesión guardada (${displayStatus.label.toLowerCase()}).`;
}

function getRunDisplayStatus(run: HistoricalRun) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  if (run.status === "failed" || stages.some((stage) => stage.status === "failed")) {
    return { className: "failed", label: "Fallida" };
  }

  if (run.status === "completed") {
    return { className: "completed", label: "Completada" };
  }

  return { className: "incomplete", label: "Incompleta" };
}

function formatStageLabel(stage: string) {
  if (stage === "stage1") {
    return "Etapa 1";
  }

  if (stage === "stage2") {
    return "Etapa 2";
  }

  if (stage === "stage3") {
    return "Etapa 3";
  }

  return stage;
}

function formatAiCallStatus(trace: Pick<AiCallTrace, "status" | "httpStatus" | "finishReason">) {
  const base = AI_CALL_STATUS_LABELS[trace.status ?? ""] ?? trace.status ?? "sin detalle";
  const http = trace.httpStatus ? ` HTTP ${trace.httpStatus}` : "";
  const finish = trace.finishReason && trace.finishReason !== "STOP" ? ` (${trace.finishReason})` : "";
  return `${base}${http}${finish}`;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString("es-CO") : "";
}

function shortId(value: string) {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function ProcessingMonitor({
  elapsedMs,
  progress,
  steps,
  timing
}: {
  elapsedMs: number;
  progress: ProgressState;
  steps: ProgressStep[];
  timing: StageTiming;
}) {
  if (progress.phase === "idle") {
    return null;
  }

  const phaseElapsedMs =
    progress.phase === "stage2" && timing.stage1Ms
      ? Math.max(0, elapsedMs - timing.stage1Ms)
      : elapsedMs;
  const liveMessage = getLiveProcessMessage(progress.phase, phaseElapsedMs);

  return (
    <div className="processMonitor">
      <div
        aria-label={`Progreso ${Math.round(progress.percent)} por ciento`}
        className="donut"
        style={{
          background: `conic-gradient(var(--accent) ${progress.percent * 3.6}deg, #e3e8ed 0deg)`
        }}
      >
        <div className="donutInner">
          <strong>{Math.round(progress.percent)}%</strong>
          <span>{formatDuration(elapsedMs)}</span>
        </div>
      </div>

      <div className="processInfo">
        <div className="processTitle">{progress.label}</div>
        <div className="processMeta">
          <span>Tiempo total: {formatDuration(timing.totalMs ?? elapsedMs)}</span>
          {liveMessage ? <span>{liveMessage}</span> : null}
        </div>

        <div className="stepList">
          {steps.map((step) => (
            <div className={`stepItem ${step.status}`} key={step.id}>
              <span className="stepDot" />
              <span>{step.label}</span>
              <strong>{step.durationMs ? formatDuration(step.durationMs) : getStepLabel(step.status)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getStepLabel(status: ProgressStep["status"]) {
  if (status === "running") {
    return "En curso";
  }

  if (status === "done") {
    return "Listo";
  }

  if (status === "failed") {
    return "Fallo";
  }

  return "Pendiente";
}

function getLiveProcessMessage(phase: ProgressPhase, elapsedMs: number) {
  if (phase === "preparing") {
    return "Leyendo el archivo antes de enviarlo al motor IA.";
  }

  if (phase !== "stage1" && phase !== "stage2" && phase !== "stage3") {
    return null;
  }

  const stageName =
    phase === "stage1" ? "Etapa 1" : phase === "stage2" ? "Etapa 2" : "Etapa 3";
  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 15) {
    return `${stageName}: solicitud enviada al motor IA.`;
  }

  if (seconds < 45) {
    return phase === "stage3"
      ? `${stageName}: buscando y comparando fuentes.`
      : `${stageName}: el motor IA sigue trabajando.`;
  }

  if (seconds < 90) {
    return phase === "stage3"
      ? `${stageName}: búsqueda lenta; seguimos esperando respuesta.`
      : `${stageName}: respuesta lenta, seguimos esperando.`;
  }

  return `${stageName}: espera prolongada; si falla, mostraremos el motivo y la accion sugerida.`;
}

function buildUserErrorMessage(payload: Pick<ApiResponse, "error" | "errorAction">, fallback: string) {
  const message = payload.error ?? fallback;
  return payload.errorAction ? `${message} Que hacer: ${payload.errorAction}` : message;
}

function normalizeStageModels(value?: Partial<StageModels>): StageModels {
  return {
    stage1: typeof value?.stage1 === "string" ? value.stage1 : "",
    stage2: typeof value?.stage2 === "string" ? value.stage2 : "",
    stage3: typeof value?.stage3 === "string" ? value.stage3 : ""
  };
}

function getModelDisplayName(model?: string) {
  if (!model) {
    return "modelo seleccionado";
  }

  const known = AI_MODEL_GROUPS.flatMap((group) => group.models).find(
    (item) => item.value === model
  );

  if (known) {
    return known.label;
  }

  return model
    .replace(/^models\//i, "")
    .replace(/^gemini-/i, "")
    .replace(/-/g, " ");
}

function StageModelSelect({
  label,
  value,
  defaultModel,
  onChange
}: {
  label: string;
  value: string;
  defaultModel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Usar defecto ({getModelDisplayName(defaultModel)})</option>
        {value && !KNOWN_AI_MODELS.has(value) ? (
          <option value={value}>{getModelDisplayName(value)} (guardado)</option>
        ) : null}
        {AI_MODEL_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.models.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function StageSection({ title, response }: { title: string; response: ApiResponse | null }) {
  const [isOpen, setIsOpen] = useState(true);
  const itemCount = response?.result?.items?.length ?? 0;

  useEffect(() => {
    if (response) {
      setIsOpen(true);
    }
  }, [response]);

  return (
    <section className="panel">
      <div className="sectionHeader stageHeader">
        <div className="stageHeaderTitle">
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? `Cerrar ${title}` : `Abrir ${title}`}
            className="sectionToggle"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            {isOpen ? "-" : "+"}
          </button>
          <h2>{title}</h2>
        </div>

        <div className="sectionBadges">
          <span className="badge">{itemCount} items</span>
          {response?.model ? (
            <span className="badge">Motor IA: {getModelDisplayName(response.model)}</span>
          ) : null}
          {response?.usage ? (
            <span className="badge">Tokens: {response.usage.totalTokens.toLocaleString("es-CO")}</span>
          ) : null}
          {response?.cost ? (
            <span className="badge">Costo est.: {formatUsd(response.cost.totalUsd)}</span>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <>
          <DynamicTable items={response?.result?.items ?? []} />

          {response?.result?.metadata ? (
            <JsonDetails title="Metadata" value={response.result.metadata} />
          ) : null}

          {response?.result?.control_calidad ? (
            <JsonDetails title="Control de calidad" value={response.result.control_calidad} />
          ) : null}

          {response?.groundingMetadata ? (
            <JsonDetails title="Fuentes de busqueda del motor IA" value={response.groundingMetadata} />
          ) : null}

          {response?.usage || response?.cost ? (
            <JsonDetails
              title="Uso y costo estimado"
              value={{ usage: response.usage, cost: response.cost }}
            />
          ) : null}

          {response?.raw || response?.cleaned ? (
            <JsonDetails
              title="JSON crudo"
              value={response.cleaned ? { cleaned: response.cleaned, raw: response.raw } : response.raw}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DynamicTable({ items }: { items: Record<string, unknown>[] }) {
  const columns = useMemo(() => Object.keys(items[0] ?? {}), [items]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  useEffect(() => {
    const validColumns = new Set(columns);

    setHiddenColumns((current) => current.filter((column) => validColumns.has(column)));
    setColumnWidths((current) =>
      Object.fromEntries(Object.entries(current).filter(([column]) => validColumns.has(column)))
    );
    setSortConfig((current) =>
      current && validColumns.has(current.column) ? current : null
    );
  }, [columns]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.includes(column)),
    [columns, hiddenColumns]
  );

  const sortedItems = useMemo(() => {
    if (!sortConfig) {
      return items;
    }

    return [...items]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const compared = compareCellValues(
          left.item[sortConfig.column],
          right.item[sortConfig.column]
        );

        if (compared === 0) {
          return left.index - right.index;
        }

        return sortConfig.direction === "asc" ? compared : -compared;
      })
      .map(({ item }) => item);
  }, [items, sortConfig]);

  if (!items.length) {
    return <p className="empty">No se detectaron items</p>;
  }

  function toggleSort(column: string) {
    setSortConfig((current) => {
      if (current?.column !== column) {
        return { column, direction: "asc" };
      }

      return {
        column,
        direction: current.direction === "asc" ? "desc" : "asc"
      };
    });
  }

  function adjustColumnWidth(column: string, amount: number) {
    setColumnWidths((current) => {
      const nextWidth = Math.max(
        90,
        Math.min(720, (current[column] ?? getDefaultColumnWidth(column)) + amount)
      );

      return {
        ...current,
        [column]: nextWidth
      };
    });
  }

  function hideColumn(column: string) {
    setHiddenColumns((current) =>
      current.includes(column) ? current : [...current, column]
    );
    setSortConfig((current) => (current?.column === column ? null : current));
  }

  function showColumn(column: string) {
    setHiddenColumns((current) => current.filter((item) => item !== column));
  }

  return (
    <>
      {hiddenColumns.length ? (
        <div className="hiddenColumnsBar">
          <span>Ocultas:</span>
          {hiddenColumns.map((column) => (
            <button
              className="tableToolButton"
              key={column}
              onClick={() => showColumn(column)}
              title={`Mostrar ${column}`}
              type="button"
            >
              + {column}
            </button>
          ))}
        </div>
      ) : null}

      <div className="tableWrap">
        <table className="dataTable">
          <colgroup>
            {visibleColumns.map((column) => (
              <col
                key={column}
                style={{ width: `${columnWidths[column] ?? getDefaultColumnWidth(column)}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column}>
                  <div className="thContent">
                    <button
                      className="sortButton"
                      onClick={() => toggleSort(column)}
                      title={`Ordenar por ${column}`}
                      type="button"
                    >
                      <span className="thLabel">{column}</span>
                      <span className="sortMark">{getSortLabel(column, sortConfig)}</span>
                    </button>
                    <div className="columnControls">
                      <button
                        aria-label={`Angostar ${column}`}
                        className="tableIconButton"
                        onClick={() => adjustColumnWidth(column, -40)}
                        title="Angostar columna"
                        type="button"
                      >
                        A-
                      </button>
                      <button
                        aria-label={`Ensanchar ${column}`}
                        className="tableIconButton"
                        onClick={() => adjustColumnWidth(column, 40)}
                        title="Ensanchar columna"
                        type="button"
                      >
                        A+
                      </button>
                      <button
                        aria-label={`Ocultar ${column}`}
                        className="tableIconButton"
                        disabled={visibleColumns.length <= 1}
                        onClick={() => hideColumn(column)}
                        title="Ocultar columna"
                        type="button"
                      >
                        -
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, rowIndex) => (
              <tr key={rowIndex}>
                {visibleColumns.map((column) => (
                  <td className={getCellClassName(column)} key={column}>
                    {formatCell(item[column], column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="jsonDetails">
      <summary>{title}</summary>
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function IngestStageSection({
  stage3Done,
  ingest,
  loading,
  previewError,
  financialBusy,
  financialMessage,
  financialCalculationId,
  onSend,
  canSend
}: {
  stage3Done: boolean;
  ingest: FinancialIngestPayload | null;
  loading: boolean;
  previewError: string | null;
  financialBusy: boolean;
  financialMessage: string | null;
  financialCalculationId: string | null;
  onSend: () => void;
  canSend: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const tableItems = useMemo(() => (ingest ? financialIngestToTableRows(ingest) : []), [ingest]);

  useEffect(() => {
    if (ingest) {
      setIsOpen(true);
    }
  }, [ingest]);

  if (!stage3Done) {
    return (
      <section className="panel">
        <div className="sectionHeader stageHeader">
          <div className="stageHeaderTitle">
            <h2>Etapa 4: Preparación análisis financiero</h2>
          </div>
        </div>
        <p className="muted">
          Ejecuta la Etapa 3 para ver aquí la tabla y el JSON que se enviarán a Simulador Financiero (contrato de ingesta v1).
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="sectionHeader stageHeader">
        <div className="stageHeaderTitle">
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? "Cerrar Etapa 4" : "Abrir Etapa 4"}
            className="sectionToggle"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            {isOpen ? "-" : "+"}
          </button>
          <h2>Etapa 4: Preparación análisis financiero</h2>
        </div>

        <div className="sectionBadges">
          <span className="badge">{ingest?.items.length ?? 0} ítems</span>
          <span className="badge">Ingesta v1</span>
          {ingest?.settings?.usd_to_cop_rate ? (
            <span className="badge">TRM USD {ingest.settings.usd_to_cop_rate}</span>
          ) : null}
        </div>
      </div>

      {loading ? <p className="muted">Generando vista previa de lo que se enviará a Simulador Financiero...</p> : null}
      {previewError ? <div className="error">{previewError}</div> : null}

      {isOpen && !loading && ingest ? (
        <>
          <p className="muted">
            Revisá la grilla como en las otras etapas. Esto es exactamente el cuerpo del <strong>POST /api/import</strong>{" "}
            (cada envío genera un <strong>cálculo nuevo</strong> en Simulador Financiero). Nombre del cálculo:{" "}
            <strong>{ingest.calculation.name}</strong>
            {ingest.settings?.usd_import_pct != null ? ` · import USD ${ingest.settings.usd_import_pct}%` : null}.
          </p>

          {tableItems.length ? (
            <DynamicTable items={tableItems} />
          ) : (
            <p className="empty">No hay filas exportables (revisá descripciones o fuentes en Etapa 3).</p>
          )}

          <JsonDetails title="JSON de ingesta (contrato v1, mismo cuerpo que POST /api/import)" value={ingest} />

          <div className="actions">
            <button type="button" onClick={onSend} disabled={financialBusy || !canSend}>
              {financialBusy ? "Enviando..." : "Enviar análisis financiero"}
            </button>
          </div>

          {financialMessage ? <div className="notice">{financialMessage}</div> : null}
          {financialCalculationId ? (
            <>
              <p className="muted">
                ID del cálculo: <code className="inlineCode">{financialCalculationId}</code>
              </p>
              <div className="actions">
                <a className="linkAsButton" href={`/finanzas?calc=${encodeURIComponent(financialCalculationId)}`}>
                  Ver cálculo en Simulador Financiero (misma app)
                </a>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) {
    return "USD 0.000000";
  }

  return `USD ${value.toFixed(6)}`;
}

function formatCell(value: unknown, column?: string): ReactNode {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const normalizedColumn = column ? normalizeLabel(column) : "";

  if (normalizedColumn === "estado de cotizacion" && isRecord(value)) {
    return <StatusCell value={value} />;
  }

  if (normalizedColumn === "cotizaciones encontradas" && Array.isArray(value)) {
    return <QuotesCell quotes={value} />;
  }

  if (normalizedColumn === "auditoria de busqueda" && isRecord(value)) {
    return <SearchAuditCell value={value} />;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return "";
    }

    return (
      <div className="cellList">
        {value.map((entry, index) => (
          <span className="cellLine" key={index}>
            {isRecord(entry) ? compactRecord(entry) : String(entry)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return <span>{compactRecord(value as Record<string, unknown>)}</span>;
  }

  return String(value);
}

function StatusCell({ value }: { value: Record<string, unknown> }) {
  const rows = ([
    ["Resultado", value.resultado_busqueda],
    ["Estado", value.estado_pricing],
    ["Fuentes", value.alcance_fuentes],
    ["Comparacion", value.calidad_comparacion_global],
    ["Techo", value.relacion_precio_techo],
    ["Siguiente", value.decision_siguiente_paso]
  ] as Array<[string, unknown]>).filter(([, entry]) => hasValue(entry));

  return (
    <div className="cellList">
      {rows.map(([label, entry]) => (
        <span className="cellLine" key={label}>
          <span className="cellLabel">{label}:</span> {String(entry)}
        </span>
      ))}
    </div>
  );
}

function QuotesCell({ quotes }: { quotes: unknown[] }) {
  if (!quotes.length) {
    return <span className="cellMuted">Sin fuentes defendibles</span>;
  }

  return (
    <div className="quoteList">
      {quotes.map((entry, index) => {
        if (!isRecord(entry)) {
          return (
            <div className="quoteItem" key={index}>
              {String(entry)}
            </div>
          );
        }

        const source = getRecord(entry.fuente);
        const product = getRecord(entry.producto);
        const price = getRecord(entry.precio);
        const defense = getRecord(entry.defensa);
        const sourceName = textValue(source.nombre) || "Fuente sin nombre";
        const productTitle = textValue(product.titulo);
        const priceText = formatPrice(price);
        const technicalMatch = textValue(defense.coincidencia_tecnica);
        const sourceStatus = textValue(defense.estado_fuente);
        const alerts = toTextArray(defense.alertas).filter((alert) => alert !== "ninguna");

        return (
          <div className="quoteItem" key={index}>
            <div className="quoteTitle">
              {textValue(entry.numero) || index + 1}. {sourceName}
            </div>
            <div className="quoteMeta">
              {productTitle ? <span>{productTitle}</span> : null}
              {priceText ? <span>{priceText}</span> : null}
              <span>
                {[technicalMatch, sourceStatus].filter(Boolean).join(" | ")}
              </span>
              {alerts.length ? <span>Alertas: {alerts.join(", ")}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchAuditCell({ value }: { value: Record<string, unknown> }) {
  const strategies = toTextArray(value.estrategias_intentadas);
  const discarded = Array.isArray(value.fuentes_descartadas)
    ? value.fuentes_descartadas.length
    : 0;

  return (
    <div className="cellList">
      {strategies.length ? (
        <span className="cellLine">
          <span className="cellLabel">Intentos:</span> {strategies.join(", ")}
        </span>
      ) : null}
      {hasValue(value.motivo_menos_de_3) ? (
        <span className="cellLine">
          <span className="cellLabel">Menos de 3:</span> {String(value.motivo_menos_de_3)}
        </span>
      ) : null}
      <span className="cellLine">
        <span className="cellLabel">Descartadas:</span> {discarded}
      </span>
      <span className="cellLine">
        <span className="cellLabel">Revision:</span>{" "}
        {value.requiere_revision_humana ? "humana" : "no requerida"}
      </span>
    </div>
  );
}

function getSortLabel(column: string, sortConfig: SortConfig | null) {
  if (sortConfig?.column !== column) {
    return "A-Z";
  }

  return sortConfig.direction === "asc" ? "A-Z ↑" : "Z-A ↓";
}

function getDefaultColumnWidth(column: string) {
  const normalized = normalizeLabel(column);
  const compactColumns = new Set([
    "consecutivo interno",
    "lote",
    "no. item",
    "und de medida",
    "cant",
    "confianza",
    "confianza cotizacion"
  ]);

  if (compactColumns.has(normalized)) {
    return 130;
  }

  if (getCellClassName(column) === "tdWide") {
    return 360;
  }

  return 190;
}

function compareCellValues(left: unknown, right: unknown) {
  const leftValue = getComparableValue(left);
  const rightValue = getComparableValue(right);

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue), "es", {
    numeric: true,
    sensitivity: "base"
  });
}

function getComparableValue(value: unknown): string | number {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const text = Array.isArray(value)
    ? value.map((entry) => formatCompactValue(entry)).join(" ")
    : isRecord(value)
      ? compactRecord(value)
      : String(value);
  const parsedNumber = parseLooseNumber(text);

  return parsedNumber ?? text;
}

function parseLooseNumber(value: string) {
  const cleaned = value.trim().replace(/\s/g, "");

  if (!cleaned || /[a-z]/i.test(cleaned)) {
    return null;
  }

  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(/,/g, ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function getCellClassName(column: string) {
  const normalized = normalizeLabel(column);
  const wideColumns = new Set([
    "nombre o descripcion",
    "descripcion",
    "detalles o ficha tecnica",
    "ficha tecnica",
    "nota tecnica para cotizacion",
    "estado de cotizacion",
    "vista rapida de cotizacion",
    "cotizaciones encontradas",
    "auditoria de busqueda",
    "resumen de cotizacion",
    "fuente 1",
    "fuente 2",
    "fuente 3"
  ]);

  return wideColumns.has(normalized) ? "tdWide" : undefined;
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function textValue(value: unknown) {
  if (!hasValue(value)) {
    return "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return typeof value === "string" ? value : "";
}

function toTextArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => textValue(entry)).filter(Boolean)
    : [];
}

function formatPrice(price: Record<string, unknown>) {
  const original = textValue(price.texto_original);
  if (original) {
    return original;
  }

  const currency = textValue(price.moneda);
  const value = textValue(price.valor);

  return [currency, value].filter(Boolean).join(" ");
}

function compactRecord(value: Record<string, unknown>) {
  const entries = Object.entries(value)
    .filter(([, entry]) => hasValue(entry))
    .slice(0, 6)
    .map(([key, entry]) => `${key}: ${formatCompactValue(entry)}`);

  return entries.join(" | ");
}

function formatCompactValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatCompactValue(entry)).join(", ");
  }

  if (isRecord(value)) {
    return compactRecord(value);
  }

  return String(value);
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Cargando aplicación…</p>
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
