"use client";

import {
  Fragment,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
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

type AiProvider = "gemini" | "deepseek";

type WorkProfileId = "default" | "medio" | "avanzado" | "manual";

type StageProviders = {
  stage1: "" | AiProvider;
  stage2: "" | AiProvider;
  stage3: "" | AiProvider;
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

type ResultsTabId = "stage1" | "stage2" | "stage3" | "stage4";

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
  hasGeminiApiKey?: boolean;
  hasDeepSeekApiKey?: boolean;
  maskedGeminiApiKey?: string | null;
  maskedDeepSeekApiKey?: string | null;
  provider?: AiProvider;
  geminiModel?: string;
  deepseekModel?: string;
  workProfile?: string;
  model?: string;
  stageProviders?: Partial<StageProviders>;
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

const DEEPSEEK_MODEL_GROUPS = [
  {
    label: "Linea V4",
    models: [
      { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
    ]
  }
];

const PROVIDER_MODEL_GROUPS: Record<AiProvider, typeof AI_MODEL_GROUPS> = {
  gemini: AI_MODEL_GROUPS,
  deepseek: DEEPSEEK_MODEL_GROUPS
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google",
  deepseek: "DeepSeek"
};

const KNOWN_AI_MODELS = new Set(
  Object.values(PROVIDER_MODEL_GROUPS).flatMap((groups) =>
    groups.flatMap((group) => group.models.map((item) => item.value))
  )
);

const EMPTY_STAGE_MODELS: StageModels = {
  stage1: "",
  stage2: "",
  stage3: ""
};

const EMPTY_STAGE_PROVIDERS: StageProviders = {
  stage1: "",
  stage2: "",
  stage3: ""
};

const WORK_PROFILES: Record<
  WorkProfileId,
  {
    label: string;
    description: string;
    stageProviders: StageProviders;
    stageModels: StageModels;
  }
> = {
  default: {
    label: "Default",
    description: "Menor costo. Recomendado para pruebas y archivos simples.",
    stageProviders: {
      stage1: "deepseek",
      stage2: "deepseek",
      stage3: "gemini"
    },
    stageModels: {
      stage1: "deepseek-v4-flash",
      stage2: "deepseek-v4-flash",
      stage3: "gemini-2.5-flash"
    }
  },
  medio: {
    label: "Medio",
    description: "Mas estable. Mejor equilibrio para la mayoria de documentos.",
    stageProviders: {
      stage1: "gemini",
      stage2: "gemini",
      stage3: "gemini"
    },
    stageModels: {
      stage1: "gemini-2.5-flash-lite",
      stage2: "gemini-2.5-flash-lite",
      stage3: "gemini-2.5-flash"
    }
  },
  avanzado: {
    label: "Avanzado",
    description: "Mas lento y experimental. Util para documentos tecnicos medianos.",
    stageProviders: {
      stage1: "deepseek",
      stage2: "deepseek",
      stage3: "gemini"
    },
    stageModels: {
      stage1: "deepseek-v4-pro",
      stage2: "deepseek-v4-pro",
      stage3: "gemini-2.5-flash"
    }
  },
  manual: {
    label: "Manual",
    description: "Configuracion personalizada por etapa.",
    stageProviders: EMPTY_STAGE_PROVIDERS,
    stageModels: EMPTY_STAGE_MODELS
  }
};

const VISIBLE_WORK_PROFILES: WorkProfileId[] = ["default", "medio", "avanzado", "manual"];

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
  const router = useRouter();
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
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [deepseekApiKey, setDeepSeekApiKey] = useState("");
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [geminiModel, setGeminiModel] = useState(getFirstProviderModel("gemini"));
  const [deepseekModel, setDeepSeekModel] = useState(getFirstProviderModel("deepseek"));
  const [workProfile, setWorkProfile] = useState<WorkProfileId>("manual");
  const [stageProviders, setStageProviders] = useState<StageProviders>(EMPTY_STAGE_PROVIDERS);
  const [stageModels, setStageModels] = useState<StageModels>(EMPTY_STAGE_MODELS);
  const [savedConfig, setSavedConfig] = useState<ConfigResponse | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configBusy, setConfigBusy] = useState<"save" | "test-gemini" | "test-deepseek" | null>(null);
  const [financialBusy, setFinancialBusy] = useState(false);
  const [financialMessage, setFinancialMessage] = useState<string | null>(null);
  const [financialIngestPreview, setFinancialIngestPreview] = useState<FinancialIngestPayload | null>(null);
  const [financialPreviewLoading, setFinancialPreviewLoading] = useState(false);
  const [financialPreviewError, setFinancialPreviewError] = useState<string | null>(null);
  const [runs, setRuns] = useState<HistoricalRun[]>([]);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [openingRunId, setOpeningRunId] = useState<string | null>(null);
  const [historicalRun, setHistoricalRun] = useState<HistoricalRun | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [activeAnalysisCode, setActiveAnalysisCode] = useState<string | null>(null);
  const [ignoreUrlAnalysisId, setIgnoreUrlAnalysisId] = useState(false);
  const [resultsTab, setResultsTab] = useState<ResultsTabId>("stage1");
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [activeStages, setActiveStages] = useState({ s1: true, s2: true, s3: true, s4: true });
  const [copRate, setCopRate] = useState(4200);

  const isHistoricalMode = useMemo(() => historicalRun !== null, [historicalRun]);
  const setManualStageProvider = useMemo(
    () =>
      setManualStageProviderFactory(
        setStageProviders,
        setStageModels,
        setWorkProfile,
        geminiModel || getFirstProviderModel("gemini"),
        deepseekModel || getFirstProviderModel("deepseek")
      ),
    [geminiModel, deepseekModel]
  );
  const setManualStageModel = useMemo(
    () => setManualStageModelFactory(setStageProviders, setStageModels, setWorkProfile),
    []
  );

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
    if (!configModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConfigModalOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [configModalOpen]);

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
      setProvider(payload.provider ?? "gemini");
      setGeminiModel(
        payload.geminiModel ||
          getModelFromProviderRef(payload.model, "gemini") ||
          getFirstProviderModel("gemini")
      );
      setDeepSeekModel(
        payload.deepseekModel ||
          getModelFromProviderRef(payload.model, "deepseek") ||
          getFirstProviderModel("deepseek")
      );
      setWorkProfile(normalizeWorkProfile(payload.workProfile));
      setStageProviders(normalizeStageProviders(payload.stageProviders));
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
    setSidebarExpanded(false);
    setOpeningRunId(null);
    setResultsTab("stage1");
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
    setActiveAnalysisId(null);
    setActiveAnalysisCode(null);
    setIgnoreUrlAnalysisId(true);
    setResultsTab("stage1");
  }

  async function saveConfig() {
    setConfigBusy("save");
    setConfigMessage(null);
    const nextStageProviders = normalizeStageProvidersForSave(stageProviders);

    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geminiApiKey,
        deepseekApiKey,
        provider,
        geminiModel,
        deepseekModel,
        model: buildProviderModelRef(provider, getProviderDefaultModel(provider, geminiModel, deepseekModel)),
        workProfile,
        stageProviders: nextStageProviders,
        stageModels
      })
    });
    const payload = (await response.json()) as ConfigResponse;

    if (!response.ok) {
      setConfigMessage(payload.error ?? "No se pudo guardar la configuración.");
    } else {
      setSavedConfig(payload);
      setGeminiApiKey("");
      setDeepSeekApiKey("");
      setConfigMessage("Configuración guardada.");
    }

    setConfigBusy(null);
  }

  function applyWorkProfile(profile: WorkProfileId) {
    setWorkProfile(profile);

    if (profile === "manual") {
      return;
    }

    const preset = WORK_PROFILES[profile];
    setStageProviders(preset.stageProviders);
    setStageModels(preset.stageModels);

    const presetGeminiModel = Object.values(preset.stageModels).find((value) => value.startsWith("gemini-"));
    const presetDeepSeekModel = Object.values(preset.stageModels).find((value) => value.startsWith("deepseek-"));

    if (presetGeminiModel) {
      setGeminiModel((current) => current || presetGeminiModel);
    }

    if (presetDeepSeekModel) {
      setDeepSeekModel((current) => current || presetDeepSeekModel);
    }
  }

  async function testProviderConfig(nextProvider: AiProvider) {
    setConfigBusy(nextProvider === "deepseek" ? "test-deepseek" : "test-gemini");
    setConfigMessage(null);
    const modelToTest = getProviderDefaultModel(nextProvider, geminiModel, deepseekModel);
    const hasKey =
      nextProvider === "deepseek"
        ? Boolean(deepseekApiKey.trim() || savedConfig?.hasDeepSeekApiKey)
        : Boolean(geminiApiKey.trim() || savedConfig?.hasGeminiApiKey);

    if (!hasKey || !modelToTest.trim()) {
      setConfigMessage(
        `${PROVIDER_LABELS[nextProvider]}: guarda o pega una API key y selecciona un modelo antes de probar.`
      );
      setConfigBusy(null);
      return;
    }

    const response = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geminiApiKey: nextProvider === "gemini" ? geminiApiKey : "",
        deepseekApiKey: nextProvider === "deepseek" ? deepseekApiKey : "",
        model: buildProviderModelRef(nextProvider, modelToTest)
      })
    });
    const payload = (await response.json()) as ConfigResponse;

    setConfigMessage(formatConnectionTestResult({ provider: nextProvider, responseOk: response.ok, payload }));
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
      const calcIdStr = typeof calcId === "string" && calcId.trim() ? calcId.trim() : null;
      void loadRuns();
      if (calcIdStr) {
        router.push(`/finanzas?calc=${encodeURIComponent(calcIdStr)}`);
        return;
      }
      setFinancialMessage(
        "El envío fue aceptado pero no se recibió un ID de cálculo. Revisá Simulador Financiero o la respuesta técnica."
      );
    } catch {
      setFinancialMessage("No se pudo conectar con Simulador Financiero (red o URL del servidor).");
    } finally {
      setFinancialBusy(false);
    }
  }

  function toggleStage(n: 1 | 2 | 3 | 4, value: boolean) {
    setActiveStages((prev) => {
      const next = { ...prev } as Record<string, boolean>;
      if (value) {
        next[`s${n}`] = true;
      } else {
        for (let i = n; i <= 4; i++) {
          next[`s${i}`] = false;
        }
      }
      return next as typeof prev;
    });
  }

  async function runSelectedStages() {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» antes de procesar otro archivo.");
      return;
    }
    if (!file) {
      setError("Carga un archivo antes de procesar.");
      return;
    }

    const totalStartedAt = Date.now();
    setLoading("pipeline");
    setError(null);
    setRunId(null);
    setPipelineStatus("Procesando etapas seleccionadas...");

    if (activeStages.s1) {
      setStage1(null);
      setStage2(null);
      setStage3(null);
      setActiveAnalysisId(null);
      setActiveAnalysisCode(null);
    } else if (activeStages.s2) {
      setStage2(null);
      setStage3(null);
    } else if (activeStages.s3) {
      setStage3(null);
    }

    setProcessStartedAt(totalStartedAt);
    setElapsedMs(0);
    setStageTiming({});

    const steps: ProgressStep[] = [];
    if (activeStages.s1) steps.push({ id: "stage1", label: "Etapa 1: extracción y normalización", status: "pending" });
    if (activeStages.s2) steps.push({ id: "stage2", label: "Etapa 2: lectura técnica", status: "pending" });
    if (activeStages.s3) steps.push({ id: "stage3", label: "Etapa 3: cotización de precios", status: "pending" });
    setProgressSteps(steps.length ? steps : INITIAL_PROGRESS_STEPS);
    setProgress({ phase: "preparing", percent: 5, label: "Preparando" });

    let currentStage1 = stage1;
    let currentStage2 = stage2;
    let currentRunId = runId;

    if (activeStages.s1) {
      setProgress({ phase: "stage1", percent: 12, label: "Etapa 1: extrayendo y normalizando" });
      setProgressStep("stage1", { status: "running" });
      const formData = new FormData();
      formData.append("file", file);
      appendStage1FormContext(formData);
      const s1At = Date.now();
      const s1Res = await fetch("/api/stage1", { method: "POST", body: formData });
      const s1Pay = (await s1Res.json()) as StageErrorResponse;
      const s1Ms = Date.now() - s1At;
      setStage1(s1Pay);
      currentStage1 = s1Pay;
      currentRunId = s1Pay.runId ?? null;
      setRunId(currentRunId);
      if (s1Res.ok && s1Pay.analysisId) {
        setActiveAnalysisId(s1Pay.analysisId);
        setActiveAnalysisCode(s1Pay.analysisCode ?? null);
      }
      setStageTiming((t) => ({ ...t, stage1Ms: s1Ms }));
      if (!s1Res.ok || !s1Pay.result) {
        setProgressStep("stage1", { status: "failed", durationMs: s1Ms });
        finishPipelineAsFailed(totalStartedAt, s1Pay, "stage1");
        return;
      }
      setProgressStep("stage1", { status: "done", durationMs: s1Ms });
    }

    if (activeStages.s2) {
      const dep = currentStage1 ?? stage1;
      if (!dep?.result) {
        setError("Etapa 2 requiere resultado de Etapa 1.");
        setLoading(null);
        return;
      }
      setProgress({ phase: "stage2", percent: 55, label: "Etapa 2: lectura técnica" });
      setProgressStep("stage2", { status: "running" });
      const s2Body: Record<string, unknown> = { stage1Json: dep.result, runId: dep.runId };
      const s2At = Date.now();
      const s2Res = await fetch("/api/stage2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s2Body) });
      const s2Pay = (await s2Res.json()) as StageErrorResponse;
      const s2Ms = Date.now() - s2At;
      setStage2(s2Pay);
      currentStage2 = s2Pay;
      setRunId(s2Pay.runId ?? currentRunId);
      setStageTiming((t) => ({ ...t, stage2Ms: s2Ms }));
      if (!s2Res.ok || !s2Pay.result) {
        setProgressStep("stage2", { status: "failed", durationMs: s2Ms });
        finishPipelineAsFailed(totalStartedAt, s2Pay, "stage2");
        return;
      }
      setProgressStep("stage2", { status: "done", durationMs: s2Ms });
    }

    if (activeStages.s3) {
      const dep = currentStage2 ?? stage2;
      if (!dep?.result) {
        setError("Etapa 3 requiere resultado de Etapa 2.");
        setLoading(null);
        return;
      }
      setProgress({ phase: "stage3", percent: 78, label: "Etapa 3: cotizando precios" });
      setProgressStep("stage3", { status: "running" });
      const s3Body: Record<string, unknown> = { stage2Json: dep.result, runId: dep.runId ?? currentRunId };
      const s3At = Date.now();
      const s3Res = await fetch("/api/stage3", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s3Body) });
      const s3Pay = (await s3Res.json()) as StageErrorResponse;
      const s3Ms = Date.now() - s3At;
      setStage3(s3Pay);
      setStageTiming((t) => ({ ...t, stage3Ms: s3Ms }));
      const totalMs = Date.now() - totalStartedAt;
      setElapsedMs(totalMs);
      setStageTiming((t) => ({ ...t, totalMs }));
      if (!s3Res.ok || !s3Pay.result) {
        setProgressStep("stage3", { status: "failed", durationMs: s3Ms });
        setProgress({ phase: "failed", percent: 88, label: "Etapa 3 detenida" });
        setError(buildUserErrorMessage(s3Pay, "No se pudo ejecutar la Etapa 3."));
        setPipelineStatus("Etapa 3 detenida.");
        setLoading(null);
        void loadRuns();
        return;
      }
      setProgressStep("stage3", { status: "done", durationMs: s3Ms });
    }

    const totalMs = Date.now() - totalStartedAt;
    setStageTiming((t) => ({ ...t, totalMs }));
    setElapsedMs(totalMs);
    setProgress({ phase: "completed", percent: 100, label: "Proceso completo" });
    const label = [activeStages.s1 && "E1", activeStages.s2 && "E2", activeStages.s3 && "E3"].filter(Boolean).join("+");
    setPipelineStatus(`Procesamiento completo: ${label} finalizadas.${activeStages.s4 ? " → Ve a Etapa 4 para enviar al simulador." : ""}`);
    setLoading(null);
    void loadRuns();
    if (activeStages.s3) setResultsTab("stage3");
    else if (activeStages.s2) setResultsTab("stage2");
    else if (activeStages.s1) setResultsTab("stage1");
  }

  async function runSingleStage(stageNum: 1 | 2 | 3, overrideProvider: AiProvider | "", overrideModel: string) {
    if (isHistoricalMode) {
      setError("Estás viendo una sesión guardada. Usá «Nuevo análisis» para procesar otro archivo.");
      return;
    }
    if (stageNum === 1 && !file) {
      setError("Carga un archivo antes de ejecutar la Etapa 1.");
      return;
    }
    if (stageNum >= 2 && !stage1?.result) {
      setError("Ejecuta primero la Etapa 1.");
      return;
    }
    if (stageNum >= 3 && !stage2?.result) {
      setError("Ejecuta primero la Etapa 2.");
      return;
    }

    const stageKey = `stage${stageNum}` as "stage1" | "stage2" | "stage3";
    const effectiveProvider = overrideProvider || (stageProviders[stageKey] as AiProvider) || "gemini";
    const effectiveModel = overrideModel || stageModels[stageKey];
    const modelRef = effectiveProvider && effectiveModel ? buildProviderModelRef(effectiveProvider, effectiveModel) : undefined;

    setLoading(stageKey);
    setError(null);

    if (stageNum === 1) {
      setStage1(null);
      setStage2(null);
      setStage3(null);
      setActiveAnalysisId(null);
      setActiveAnalysisCode(null);
      const formData = new FormData();
      formData.append("file", file!);
      if (modelRef) formData.append("model", modelRef);
      appendStage1FormContext(formData);
      const res = await fetch("/api/stage1", { method: "POST", body: formData });
      const pay = (await res.json()) as StageErrorResponse;
      setRunId(pay.runId ?? null);
      if (res.ok && pay.analysisId) {
        setActiveAnalysisId(pay.analysisId);
        setActiveAnalysisCode(pay.analysisCode ?? null);
      }
      setStage1(pay);
      if (!res.ok) setError(buildUserErrorMessage(pay, "No se pudo ejecutar la Etapa 1."));
    } else if (stageNum === 2) {
      setStage2(null);
      setStage3(null);
      const body: Record<string, unknown> = { stage1Json: stage1!.result, runId: stage1!.runId };
      if (modelRef) body.model = modelRef;
      const res = await fetch("/api/stage2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const pay = (await res.json()) as StageErrorResponse;
      setRunId(pay.runId ?? stage1!.runId ?? null);
      setStage2(pay);
      if (!res.ok) setError(buildUserErrorMessage(pay, "No se pudo ejecutar la Etapa 2."));
    } else {
      setStage3(null);
      const startedAt = Date.now();
      setProcessStartedAt(startedAt);
      setElapsedMs(0);
      setStageTiming({});
      setProgressSteps(STAGE3_PROGRESS_STEPS);
      setProgress({ phase: "stage3", percent: 10, label: "Etapa 3: cotizando precios" });
      setProgressStep("stage3", { status: "running" });
      const body: Record<string, unknown> = { stage2Json: stage2!.result, runId: stage2!.runId ?? runId };
      if (modelRef) body.model = modelRef;
      const res = await fetch("/api/stage3", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const pay = (await res.json()) as StageErrorResponse;
      const s3Ms = Date.now() - startedAt;
      setRunId(pay.runId ?? stage2!.runId ?? runId);
      setElapsedMs(s3Ms);
      setStageTiming({ stage3Ms: s3Ms, totalMs: s3Ms });
      if (!res.ok) {
        setStage3(pay);
        setProgressStep("stage3", { status: "failed", durationMs: s3Ms });
        setProgress({ phase: "failed", percent: 72, label: "Etapa 3 detenida" });
        setError(buildUserErrorMessage(pay, "No se pudo ejecutar la Etapa 3."));
        setPipelineStatus("Etapa 3 detenida.");
      } else {
        setStage3(pay);
        setProgressStep("stage3", { status: "done", durationMs: s3Ms });
        setProgress({ phase: "completed", percent: 100, label: "Etapa 3 completa" });
        setPipelineStatus(`Etapa 3 finalizada en ${formatDuration(s3Ms)}.`);
      }
      void loadRuns();
    }
    setLoading(null);
  }

  return (
    <main className="appShell">
      <SessionsSidebar
        expanded={sidebarExpanded}
        message={historyMessage}
        onExpandedChange={setSidebarExpanded}
        onOpenRun={(id) => void openHistoricalRun(id)}
        onRefresh={() => void loadRuns()}
        openingRunId={openingRunId}
        runs={runs}
      />

      <div className="workspaceColumn">
        <div className="workspaceInner">
          <header className="workspaceTopbar">
            <div className="workspaceTopbarMain">
              <h1 className="workspaceH1">Extracción de datos estratégicos</h1>
              {urlOdooProjectId || urlAnalysisId || activeAnalysisCode ? (
                <p className="muted contextLine contextLineCompact">
                  {activeAnalysisCode ? (
                    <>
                      <code className="inlineCode">{activeAnalysisCode}</code>
                      {activeAnalysisId ? <span className="muted"> · {shortId(activeAnalysisId)}</span> : null}
                    </>
                  ) : null}
                  {urlOdooProjectId ? (
                    <span>
                      {activeAnalysisCode ? " · " : null}
                      <code className="inlineCode">{urlOdooProjectId}</code>
                    </span>
                  ) : null}
                  {urlAnalysisId && !activeAnalysisCode ? (
                    <span>
                      {(urlOdooProjectId || activeAnalysisCode) ? " · " : null}
                      <code className="inlineCode">{shortId(urlAnalysisId)}</code>
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="topbarActions">
              <nav className="topbarNav" aria-label="Navegación principal">
                <button
                  type="button"
                  className="topbarNavButton"
                  onClick={() => setSidebarExpanded(true)}
                >
                  Historial
                </button>
                <a className="topbarNavLink" href="/finanzas">
                  Simulador
                </a>
              </nav>
              <button
                type="button"
                className="iconGearButton"
                aria-label="Abrir configuración del motor IA"
                title="Configuración del motor IA"
                onClick={() => {
                  setConfigModalOpen(true);
                  void loadConfig();
                }}
              >
                <svg className="iconGearSvg" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
                  />
                </svg>
              </button>
            </div>
          </header>

          <section className="panel workspacePanel">
            {historicalRun ? (
              <div className="historicalHeader">
                <div className="historicalHeaderMain">
                  <div className="fileLabelRow">
                    <span className="fileLabel">Sesión guardada</span>
                    <InfoTip
                      label="Lectura"
                      text="Solo lectura. Usá «Nuevo análisis» para procesar otro archivo."
                    />
                  </div>
                  <p className="muted metaOneLine">
                    {formatDateTime(historicalRun.updatedAt)} · {getRunDisplayStatus(historicalRun).label} ·{" "}
                    {shortId(historicalRun.runId)}
                  </p>
                </div>
                <button type="button" onClick={startNewRun}>
                  Nuevo análisis
                </button>
              </div>
            ) : (
              <>
                <div className="fileLabelRow">
                  <label className="fileLabel" htmlFor="document-file">
                    Archivo
                  </label>
                  <InfoTip
                    label="Flujo"
                    text="Elegí las etapas a correr, cargá el archivo y presioná «Procesar datos». Cada etapa puede reprocesarse individualmente desde su pestaña."
                  />
                </div>
                <input
                  key={fileInputKey}
                  id="document-file"
                  type="file"
                  accept=".txt,.csv,.xlsx,.docx,.pdf"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setFile(nextFile);
                    setError(null);
                  }}
                />
                {file ? <p className="muted fileNameHint">{file.name}</p> : null}
              </>
            )}

            {!isHistoricalMode ? (
              <div className="stageChecks">
                {([1, 2, 3, 4] as const).map((n) => {
                  const key = `s${n}` as keyof typeof activeStages;
                  const prevEnabled = n === 1 || activeStages[`s${n - 1}` as keyof typeof activeStages];
                  const checked = activeStages[key];
                  const hints = ["Extraer", "Técnico", "Cotizar", "Simulador"];
                  return (
                    <label key={n} className={`stageCheck${!prevEnabled ? " stageCheckDisabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!prevEnabled}
                        onChange={(e) => toggleStage(n, e.target.checked)}
                      />
                      <span className="stageCheckLabel">E{n}</span>
                      <small className="stageCheckHint">{hints[n - 1]}</small>
                    </label>
                  );
                })}
              </div>
            ) : null}
            <div className="runMainRow">
              <button
                type="button"
                className="runProcessButton"
                onClick={() => void runSelectedStages()}
                disabled={isHistoricalMode || loading !== null || !file}
              >
                {loading === "pipeline"
                  ? "Procesando..."
                  : stage1?.result || stage2?.result || stage3?.result
                  ? "Re-procesar"
                  : "Procesar datos"}
              </button>
              {!isHistoricalMode ? (
                <label className="copRateLabel">
                  TRM{" "}
                  <input
                    type="number"
                    className="copRateInput"
                    value={copRate}
                    min={1}
                    onChange={(e) => setCopRate(Math.max(1, Number(e.target.value) || 4200))}
                  />
                </label>
              ) : null}
            </div>

            <ProcessingMonitor
              elapsedMs={elapsedMs}
              progress={progress}
              steps={progressSteps}
              timing={stageTiming}
            />

            {pipelineStatus ? <div className="notice">{pipelineStatus}</div> : null}
            {error ? <div className="error">{error}</div> : null}
            {runId ? <p className="muted runIdHint">Run: {shortId(runId)}</p> : null}
          </section>

          <RunSummary stage1={stage1} stage2={stage2} stage3={stage3} copRate={copRate} />
          <StageResultsWorkspace
            activeTab={resultsTab}
            onTabChange={setResultsTab}
            stage1={stage1}
            stage2={stage2}
            stage3={stage3}
            file={file}
            loading={loading}
            stageProviders={stageProviders}
            stageModels={stageModels}
            copRate={copRate}
            isHistoricalMode={isHistoricalMode}
            onRunStage={(n, p, m) => void runSingleStage(n, p, m)}
            ingest={{
              stage3Done: Boolean(stage3?.result),
              ingest: financialIngestPreview,
              loading: financialPreviewLoading,
              previewError: financialPreviewError,
              financialBusy,
              financialMessage,
              onSend: () => void sendStage3ToFinancialOffer(),
              canSend:
                Boolean(stage3?.result) &&
                !financialPreviewLoading &&
                !financialPreviewError &&
                Boolean(financialIngestPreview?.items?.length)
            }}
          />
        </div>
      </div>

      {configModalOpen ? (
        <div
          className="configDrawerBackdrop"
          role="presentation"
          onClick={() => setConfigModalOpen(false)}
        >
          <div
            className="configDrawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="configDrawerHeader">
              <h2 id="config-modal-title">Configuración</h2>
              <button
                type="button"
                className="configDrawerClose"
                aria-label="Cerrar configuración"
                onClick={() => setConfigModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="sectionBadges configDrawerBadges">
              {savedConfig?.hasGeminiApiKey ? (
                <span className="badge">Google guardada {savedConfig.maskedGeminiApiKey}</span>
              ) : (
                <span className="badge">Google sin key</span>
              )}
              {savedConfig?.hasDeepSeekApiKey ? (
                <span className="badge">DeepSeek guardada {savedConfig.maskedDeepSeekApiKey}</span>
              ) : (
                <span className="badge">DeepSeek sin key</span>
              )}
            </div>

            <div className="configDrawerSection">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Motores IA</h3>
                <InfoTip
                  label="Almacenamiento"
                  text="Se guardan en .env.local del servidor (GEMINI_*, DEEPSEEK_*, AI_PROVIDER_*, AI_MODEL_*)."
                />
              </div>
              <div className="configGrid">
                <label>
                  <span>API key Google</span>
                  <input
                    type="password"
                    value={geminiApiKey}
                    placeholder={savedConfig?.hasGeminiApiKey ? "Dejar vacío para conservar la guardada" : "Pegá tu API key"}
                    onChange={(event) => setGeminiApiKey(event.target.value)}
                  />
                </label>

                <label>
                  <span>API key DeepSeek</span>
                  <input
                    type="password"
                    value={deepseekApiKey}
                    placeholder={savedConfig?.hasDeepSeekApiKey ? "Dejar vacío para conservar la guardada" : "Pegá tu API key"}
                    onChange={(event) => setDeepSeekApiKey(event.target.value)}
                  />
                </label>
              </div>

              <div className="providerModelGrid">
                <ProviderModelSelect
                  label="Modelo Google"
                  provider="gemini"
                  value={geminiModel}
                  busy={configBusy === "test-gemini"}
                  disabled={configBusy !== null}
                  onChange={setGeminiModel}
                  onTest={() => void testProviderConfig("gemini")}
                />
                <ProviderModelSelect
                  label="Modelo DeepSeek"
                  provider="deepseek"
                  value={deepseekModel}
                  busy={configBusy === "test-deepseek"}
                  disabled={configBusy !== null}
                  onChange={setDeepSeekModel}
                  onTest={() => void testProviderConfig("deepseek")}
                />
              </div>
            </div>

            <div className="configDrawerSection">
              <ProfileSelector value={workProfile} onChange={applyWorkProfile} />
            </div>

            <div className="configDrawerSection">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Proveedor y modelo por etapa</h3>
                <InfoTip
                  label="Perfiles"
                  text="Cada etapa puede usar proveedor y modelo distintos. Etapa 3 no permite DeepSeek porque requiere búsqueda web verificable."
                />
              </div>
              <div className="stageManualWrap">
                <table className="stageManualTable">
                  <thead>
                    <tr>
                      <th>Etapa</th>
                      <th>Proveedor</th>
                      <th>Modelo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["stage1", "stage2", "stage3"] as Array<keyof StageProviders>).map((stageId) => {
                      const selectedProvider =
                        stageId === "stage3" && stageProviders[stageId] === "deepseek"
                          ? "gemini"
                          : getCheckedProvider(stageProviders[stageId]);
                      const selectedModel =
                        stageModels[stageId] ||
                        getProviderDefaultModel(selectedProvider, geminiModel, deepseekModel);
                      return (
                        <tr key={stageId}>
                          <th scope="row">{stageId.toUpperCase().replace("STAGE", "Etapa ")}</th>
                          <td>
                            <select
                              value={selectedProvider}
                              onChange={(event) =>
                                setManualStageProvider(stageId, event.target.value as AiProvider)
                              }
                            >
                              <option value="deepseek" disabled={stageId === "stage3"}>
                                DeepSeek
                              </option>
                              <option value="gemini">Google</option>
                            </select>
                          </td>
                          <td>
                            <StageModelPicker
                              label={`Modelo ${stageId.replace("stage", "Etapa ")}`}
                              provider={selectedProvider}
                              value={stageModels[stageId]}
                              defaultModel={getProviderDefaultModel(selectedProvider, geminiModel, deepseekModel)}
                              onChange={(val) => setManualStageModel(stageId, val)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {stageProviders.stage3 === "deepseek" ? (
                <p className="notice warningNotice">
                  Etapa 3 necesita búsqueda web verificable. Seleccioná Google para Etapa 3 antes de cotizar.
                </p>
              ) : null}
            </div>

            <div className="configDrawerSection">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Proveedor por defecto</h3>
              </div>
              <div className="configGrid">
                <label>
                  <span>Proveedor base</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)}>
                    <option value="gemini">Google</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="actions">
              <button type="button" onClick={saveConfig} disabled={configBusy !== null}>
                {configBusy === "save" ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>

            {configMessage ? <div className="notice">{configMessage}</div> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function InfoTip({ label, text }: { label: string; text: string }) {
  const full = `${label}: ${text}`;

  return (
    <span className="infoTip" title={full} role="img" aria-label={full}>
      ℹ️
    </span>
  );
}

function SessionsSidebar({
  expanded,
  onExpandedChange,
  message,
  runs,
  openingRunId,
  onOpenRun,
  onRefresh
}: {
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  message: string | null;
  runs: HistoricalRun[];
  openingRunId: string | null;
  onOpenRun: (runId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <aside
      className={`sessionsSidebar ${expanded ? "isExpanded" : "isCollapsed"}`}
      id="session-sidebar"
      aria-label="Historial de sesiones"
    >
      <div className="sessionsSidebarToolbar">
        {expanded ? (
          <>
            <h2 className="sessionsSidebarHeading">Sesiones</h2>
            <div className="sessionsSidebarToolbarActions">
              <button
                className="sessionsIconBtn"
                onClick={() => void onRefresh()}
                title="Actualizar lista"
                type="button"
              >
                ⟳
              </button>
              <button
                aria-label="Contraer panel de historial"
                className="sessionsIconBtn"
                onClick={() => onExpandedChange(false)}
                title="Contraer"
                type="button"
              >
                ⟨
              </button>
            </div>
          </>
        ) : (
          <button
            aria-expanded={false}
            aria-label="Abrir historial de sesiones"
            className="sessionsCollapsedTrigger"
            onClick={() => onExpandedChange(true)}
            title="Historial"
            type="button"
          >
            <svg className="sessionsListIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"
              />
            </svg>
          </button>
        )}
      </div>

      {expanded ? (
        <div className="sessionsSidebarBody">
          {message ? <div className="error sessionsSidebarError">{message}</div> : null}
          {runs.length === 0 ? (
            <p className="muted sessionsEmpty">Sin sesiones aún.</p>
          ) : (
            <ul className="sessionsList">
              {runs.map((run) => {
                const displayStatus = getRunDisplayStatus(run);

                return (
                  <li className="sessionsListItem" key={run.runId}>
                    <div className="sessionsListItemTop">
                      <span className="sessionsListDate">{formatDateTime(run.updatedAt)}</span>
                      <span className={`statusPill ${displayStatus.className}`}>{displayStatus.label}</span>
                    </div>
                    <div className="sessionsListFile" title={run.fileName ?? undefined}>
                      {run.fileName ?? "Sin archivo"}
                    </div>
                    {run.analysisCode ? (
                      <div className="sessionsListMeta muted">{run.analysisCode}</div>
                    ) : null}
                    <button
                      className="secondary sessionsOpenBtn"
                      disabled={openingRunId !== null}
                      onClick={() => onOpenRun(run.runId)}
                      type="button"
                    >
                      {openingRunId === run.runId ? "Abriendo…" : "Abrir"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </aside>
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

function normalizeWorkProfile(value?: string): WorkProfileId {
  return value === "default" || value === "medio" || value === "avanzado" || value === "manual"
    ? value
    : "manual";
}

function normalizeStageModels(value?: Partial<StageModels>): StageModels {
  return {
    stage1: typeof value?.stage1 === "string" ? value.stage1 : "",
    stage2: typeof value?.stage2 === "string" ? value.stage2 : "",
    stage3: typeof value?.stage3 === "string" ? value.stage3 : ""
  };
}

function normalizeStageProviders(value?: Partial<StageProviders>): StageProviders {
  return {
    stage1: value?.stage1 === "deepseek" || value?.stage1 === "gemini" ? value.stage1 : "",
    stage2: value?.stage2 === "deepseek" || value?.stage2 === "gemini" ? value.stage2 : "",
    stage3: value?.stage3 === "deepseek" || value?.stage3 === "gemini" ? value.stage3 : ""
  };
}

function normalizeStageProvidersForSave(value: StageProviders): StageProviders {
  return {
    stage1: getCheckedProvider(value.stage1),
    stage2: getCheckedProvider(value.stage2),
    stage3: value.stage3 === "deepseek" ? "gemini" : getCheckedProvider(value.stage3)
  };
}

function getCheckedProvider(value: string | null | undefined): AiProvider {
  return value === "deepseek" ? "deepseek" : "gemini";
}

function getProviderDefaultModel(provider: AiProvider, googleModel: string, deepSeekModel: string) {
  return provider === "deepseek" ? deepSeekModel : googleModel;
}

function getFirstProviderModel(nextProvider: AiProvider) {
  return PROVIDER_MODEL_GROUPS[nextProvider][0]?.models[0]?.value ?? "";
}

function getProviderFromRef(model?: string): AiProvider {
  const normalized = normalizeModelValue(model ?? "");
  if (normalized.startsWith("deepseek:") || normalized.startsWith("deepseek-")) {
    return "deepseek";
  }
  return "gemini";
}

function getModelFromProviderRef(model: string | undefined, nextProvider: AiProvider) {
  return getProviderFromRef(model) === nextProvider ? stripProvider(model ?? "") : "";
}

function buildProviderModelRef(nextProvider: AiProvider, model: string) {
  return model.trim() ? `${nextProvider}:${stripProvider(model)}` : "";
}

function normalizeModelValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^(gemini|deepseek):/i.test(trimmed)) {
    const [providerTag, ...rest] = trimmed.split(":");
    return `${providerTag.toLowerCase()}:${rest.join(":").trim()}`;
  }
  if (/^deepseek-/i.test(trimmed)) {
    return `deepseek:${trimmed}`;
  }
  return `gemini:${trimmed}`;
}

function stripProvider(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^(gemini|deepseek):/i.test(trimmed)) {
    return trimmed.split(":").slice(1).join(":").trim();
  }
  return trimmed;
}

function setManualStageProviderFactory(
  setStageProvidersState: Dispatch<SetStateAction<StageProviders>>,
  setStageModelsState: Dispatch<SetStateAction<StageModels>>,
  setWorkProfileState: Dispatch<SetStateAction<WorkProfileId>>,
  geminiDefaultModel: string,
  deepseekDefaultModel: string
) {
  return (stage: keyof StageProviders, nextProvider: AiProvider) => {
    setWorkProfileState("manual");
    setStageProvidersState((current) => ({ ...current, [stage]: nextProvider }));
    setStageModelsState((current) => ({
      ...current,
      [stage]: getProviderDefaultModel(nextProvider, geminiDefaultModel, deepseekDefaultModel)
    }));
  };
}

function setManualStageModelFactory(
  setStageProvidersState: Dispatch<SetStateAction<StageProviders>>,
  setStageModelsState: Dispatch<SetStateAction<StageModels>>,
  setWorkProfileState: Dispatch<SetStateAction<WorkProfileId>>
) {
  return (stage: keyof StageModels, model: string) => {
    setWorkProfileState("manual");
    setStageModelsState((current) => ({ ...current, [stage]: model }));
    const providerForModel = getProviderFromRef(model);
    setStageProvidersState((current) => ({ ...current, [stage]: providerForModel }));
  };
}

function formatConnectionTestResult({
  provider,
  responseOk,
  payload
}: {
  provider: AiProvider;
  responseOk: boolean;
  payload: ConfigResponse;
}) {
  const providerLabel = PROVIDER_LABELS[provider];
  if (!responseOk) {
    return `${providerLabel}: ${buildUserErrorMessage(payload, "No se pudo conectar con el motor IA.")}`;
  }
  return [
    `${providerLabel}: ${payload.message ?? `conexion exitosa (${getModelDisplayName(payload.model)}).`}`,
    payload.usage ? `Tokens prueba: ${payload.usage.totalTokens.toLocaleString("es-CO")}.` : null,
    payload.cost ? `Costo est.: ${formatUsd(payload.cost.totalUsd)}.` : null
  ]
    .filter(Boolean)
    .join(" ");
}

function getModelDisplayName(model?: string) {
  if (!model) {
    return "modelo seleccionado";
  }

  const modelWithoutProvider = stripProvider(model);
  const known = Object.values(PROVIDER_MODEL_GROUPS)
    .flatMap((groups) => groups.flatMap((group) => group.models))
    .find((item) => item.value === modelWithoutProvider);

  if (known) {
    return known.label;
  }

  return modelWithoutProvider
    .replace(/^models\//i, "")
    .replace(/^gemini-/i, "")
    .replace(/^deepseek-/i, "DeepSeek ")
    .replace(/-/g, " ");
}

function geminiModelFlatSelectOptions() {
  return AI_MODEL_GROUPS.flatMap((group) =>
    group.models.map((item) => (
      <option key={item.value} value={item.value}>
        {group.label} — {item.label}
      </option>
    ))
  );
}

function ProviderModelSelect({
  label,
  provider,
  value,
  busy,
  disabled,
  onChange,
  onTest
}: {
  label: string;
  provider: AiProvider;
  value: string;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <div className="providerModelCard">
      <label>
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Selecciona un modelo {PROVIDER_LABELS[provider]}</option>
          {PROVIDER_MODEL_GROUPS[provider].map((group) => (
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
      <button type="button" className="secondary miniButton" onClick={onTest} disabled={disabled}>
        {busy ? "Probando..." : `Probar ${PROVIDER_LABELS[provider]}`}
      </button>
    </div>
  );
}

/**
 * Desplegable de modelos por etapa: no usa <select> nativo dentro del drawer con overflow,
 * porque en Chrome/Windows el menú nativo queda recortado y parece “vacío”. El menú va en portal.
 */
function ProfileSelector({
  value,
  onChange
}: {
  value: WorkProfileId;
  onChange: (value: WorkProfileId) => void;
}) {
  return (
    <div className="profileBlock">
      <div className="profileHeader">
        <div>
          <h3 className="configDrawerSectionTitle">Perfil de trabajo</h3>
          <p className="muted profileIntro">Elegí una combinación predefinida de motores por etapa o ajustala manualmente.</p>
        </div>
        <span className="badge">{WORK_PROFILES[value].label}</span>
      </div>
      <div className="profileOptions">
        {VISIBLE_WORK_PROFILES.map((profile) => (
          <label className={`profileOption ${value === profile ? "selected" : ""}`} key={profile}>
            <input
              checked={value === profile}
              name="work-profile"
              onChange={() => onChange(profile)}
              type="radio"
              value={profile}
            />
            <span>
              <strong>{WORK_PROFILES[profile].label}</strong>
              <small>{WORK_PROFILES[profile].description}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function StageModelPicker({
  label,
  provider,
  value,
  defaultModel,
  onChange
}: {
  label: string;
  provider: AiProvider;
  value: string;
  defaultModel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const summary = useMemo(() => {
    if (!value) {
      return `Usar defecto (${getModelDisplayName(defaultModel)})`;
    }
    return `${getModelDisplayName(value)}${KNOWN_AI_MODELS.has(value) ? "" : " (guardado)"}`;
  }, [value, defaultModel]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuBox(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 260);
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    const below = rect.bottom + 4;
    const maxHeight = Math.max(140, Math.min(window.innerHeight * 0.55, window.innerHeight - below - 10));
    setMenuBox({ top: below, left, width, maxHeight });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function onPointerDown(event: MouseEvent | PointerEvent) {
      const t = event.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    }

    function onScroll() {
      setOpen(false);
    }

    function onResize() {
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const menu =
    open && menuBox
      ? createPortal(
          <div
            ref={menuRef}
            className="modelPickerMenuRoot"
            style={{
              position: "fixed",
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
              overflowY: "auto",
              zIndex: 500
            }}
          >
            <ul className="modelPickerMenu" role="listbox" aria-label={`${label}: elegir modelo`}>
              <li role="none">
                <button
                  type="button"
                  className={`modelPickerOption${value === "" ? " modelPickerOptionActive" : ""}`}
                  role="option"
                  aria-selected={value === ""}
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  Usar defecto ({getModelDisplayName(defaultModel)})
                </button>
              </li>
              {value && !KNOWN_AI_MODELS.has(value) ? (
                <li role="none">
                  <button
                    type="button"
                    className="modelPickerOption modelPickerOptionActive"
                    role="option"
                    aria-selected
                    onClick={() => {
                      onChange(value);
                      setOpen(false);
                    }}
                  >
                    {getModelDisplayName(value)} (guardado)
                  </button>
                </li>
              ) : null}
              {PROVIDER_MODEL_GROUPS[provider].map((group) => (
                <Fragment key={group.label}>
                  <li className="modelPickerGroupLabel" aria-hidden>
                    {group.label}
                  </li>
                  {group.models.map((item) => (
                    <li key={item.value} role="none">
                      <button
                        type="button"
                        className={`modelPickerOption${value === item.value ? " modelPickerOptionActive" : ""}`}
                        role="option"
                        aria-selected={value === item.value}
                        onClick={() => {
                          onChange(item.value);
                          setOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="modelPicker" ref={wrapRef}>
      <span className="modelPickerLabel">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="modelPickerTrigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: modelo del motor o usar el defecto global`}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
      </button>
      {menu}
    </div>
  );
}

function StageResultsWorkspace({
  activeTab,
  onTabChange,
  stage1,
  stage2,
  stage3,
  file,
  loading,
  stageProviders,
  stageModels,
  copRate,
  isHistoricalMode,
  onRunStage,
  ingest
}: {
  activeTab: ResultsTabId;
  onTabChange: (tab: ResultsTabId) => void;
  stage1: ApiResponse | null;
  stage2: ApiResponse | null;
  stage3: ApiResponse | null;
  file: File | null;
  loading: LoadingStage;
  stageProviders: StageProviders;
  stageModels: StageModels;
  copRate: number;
  isHistoricalMode: boolean;
  onRunStage: (n: 1 | 2 | 3, provider: AiProvider | "", model: string) => void;
  ingest: {
    stage3Done: boolean;
    ingest: FinancialIngestPayload | null;
    loading: boolean;
    previewError: string | null;
    financialBusy: boolean;
    financialMessage: string | null;
    onSend: () => void;
    canSend: boolean;
  };
}) {
  const tabs: Array<{ id: ResultsTabId; label: string; hint: string }> = [
    { id: "stage1", label: "Etapa 1", hint: "Extracción" },
    { id: "stage2", label: "Etapa 2", hint: "Técnico" },
    { id: "stage3", label: "Etapa 3", hint: "Cotización" },
    { id: "stage4", label: "Etapa 4", hint: "Ingesta financiera" }
  ];

  return (
    <div className="stageResultsBleed">
      <section className="panel stageResultsPanel">
        <div className="sectionHeader stageResultsPanelHeader">
          <div className="stageResultsPanelTitleRow">
            <h2 className="stageResultsPanelTitle">Resultados por etapa</h2>
            <InfoTip
              label="Tablas"
              text="Una etapa por pestaña. El scroll largo va dentro de la tabla. Clic en una fila para ver texto completo en celdas truncadas."
            />
          </div>
        </div>

        <div className="stageTabBar" role="tablist" aria-label="Seleccionar etapa de resultados">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`stageTab ${activeTab === tab.id ? "stageTabActive" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="stageTabLabel">{tab.label}</span>
              <span className="stageTabHint">{tab.hint}</span>
            </button>
          ))}
        </div>

        <div className="stageTabPanel" role="tabpanel">
          {activeTab === "stage1" ? (
            <StageTabPanel
              title="Resultado Etapa 1"
              stageNum={1}
              response={stage1}
              canProcess={Boolean(file)}
              hasFile={Boolean(file)}
              defaultProvider={(stageProviders.stage1 as AiProvider) || "gemini"}
              defaultModel={stageModels.stage1}
              loading={loading}
              isHistoricalMode={isHistoricalMode}
              copRate={copRate}
              onRun={(p, m) => onRunStage(1, p, m)}
            />
          ) : null}
          {activeTab === "stage2" ? (
            <StageTabPanel
              title="Resultado Etapa 2"
              stageNum={2}
              response={stage2}
              canProcess={Boolean(stage1?.result)}
              hasFile={Boolean(file)}
              defaultProvider={(stageProviders.stage2 as AiProvider) || "gemini"}
              defaultModel={stageModels.stage2}
              loading={loading}
              isHistoricalMode={isHistoricalMode}
              copRate={copRate}
              onRun={(p, m) => onRunStage(2, p, m)}
            />
          ) : null}
          {activeTab === "stage3" ? (
            <StageTabPanel
              title="Resultado Etapa 3"
              stageNum={3}
              response={stage3}
              canProcess={Boolean(stage2?.result)}
              hasFile={Boolean(file)}
              defaultProvider={(stageProviders.stage3 as AiProvider) || "gemini"}
              defaultModel={stageModels.stage3}
              loading={loading}
              isHistoricalMode={isHistoricalMode}
              copRate={copRate}
              onRun={(p, m) => onRunStage(3, p, m)}
            />
          ) : null}
          {activeTab === "stage4" ? <IngestStageSection {...ingest} embedded /> : null}
        </div>
      </section>
    </div>
  );
}

function StageTabPanel({
  title,
  stageNum,
  response,
  canProcess,
  hasFile,
  defaultProvider,
  defaultModel,
  loading,
  isHistoricalMode,
  copRate,
  onRun
}: {
  title: string;
  stageNum: 1 | 2 | 3;
  response: ApiResponse | null;
  canProcess: boolean;
  hasFile: boolean;
  defaultProvider: AiProvider;
  defaultModel: string;
  loading: LoadingStage;
  isHistoricalMode: boolean;
  copRate: number;
  onRun: (provider: AiProvider | "", model: string) => void;
}) {
  const [overrideProvider, setOverrideProvider] = useState<AiProvider | "">("");
  const [overrideModel, setOverrideModel] = useState("");

  const itemCount = response?.result?.items?.length ?? 0;
  const hasResult = response?.result != null;
  const isRunning = loading === (`stage${stageNum}` as LoadingStage);
  const canRun = !isHistoricalMode && !loading && canProcess && (stageNum !== 1 || hasFile);
  const btnLabel = isRunning ? "Procesando..." : hasResult ? "Reprocesar" : "Procesar";
  const disabledTitle = !canProcess
    ? stageNum === 1 ? "Carga un archivo primero" : `Requiere resultado de Etapa ${stageNum - 1}`
    : stageNum === 1 && !hasFile ? "Carga un archivo primero"
    : undefined;

  const effectiveProvider = (overrideProvider || defaultProvider || "gemini") as AiProvider;

  const runBar = !isHistoricalMode ? (
    <div className="stageTabRunBar">
      <div className="stageTabProviderRow">
        <select
          className="stageTabProviderSelect"
          value={overrideProvider}
          onChange={(e) => {
            setOverrideProvider(e.target.value as AiProvider | "");
            setOverrideModel("");
          }}
        >
          <option value="">Perfil global ({PROVIDER_LABELS[defaultProvider] || "Gemini"})</option>
          <option value="gemini">Google Gemini</option>
          <option value="deepseek">DeepSeek</option>
        </select>
        <StageModelPicker
          label="Modelo"
          provider={effectiveProvider}
          value={overrideModel}
          defaultModel={defaultModel}
          onChange={setOverrideModel}
        />
      </div>
      <button
        type="button"
        className={hasResult ? "secondary miniButton stageTabRunBtn" : "miniButton stageTabRunBtn"}
        disabled={!canRun}
        title={disabledTitle}
        onClick={() => onRun(overrideProvider, overrideModel)}
      >
        {btnLabel}
      </button>
    </div>
  ) : null;

  if (!response || (!response.result && !response.error)) {
    return (
      <div className="stageTabBody">
        {runBar}
        {!canProcess && stageNum > 1 ? (
          <p className="muted stageTabPlaceholder">Requiere que Etapa {stageNum - 1} esté completada.</p>
        ) : stageNum === 1 && !hasFile ? (
          <p className="muted stageTabPlaceholder">Cargá un archivo para comenzar.</p>
        ) : (
          <p className="muted stageTabPlaceholder">Sin datos aún. Usá «Procesar» para ejecutar esta etapa.</p>
        )}
      </div>
    );
  }

  return (
    <div className="stageTabBody">
      {runBar}
      {response.error ? <div className="error">{response.error}</div> : null}
      <div className="sectionBadges stageTabBadges">
        <span className="badge">{itemCount} ítems</span>
        {response.model ? <span className="badge">Motor IA: {getModelDisplayName(response.model)}</span> : null}
        {response.usage ? (
          <span className="badge">Tokens: {response.usage.totalTokens.toLocaleString("es-CO")}</span>
        ) : null}
        {response.cost ? (
          <span className="badge">
            Costo: {formatUsd(response.cost.totalUsd)}
            {copRate > 0 ? ` · ≈ COP ${Math.round(response.cost.totalUsd * copRate).toLocaleString("es-CO")}` : ""}
          </span>
        ) : null}
      </div>

      <DynamicTable items={response.result?.items ?? []} />

      <div className="stageJsonStack">
        {response.result?.metadata ? <JsonDetails title="Metadata" value={response.result.metadata} subtle /> : null}
        {response.result?.control_calidad ? (
          <JsonDetails title="Control de calidad" value={response.result.control_calidad} subtle />
        ) : null}
        {response.groundingMetadata ? (
          <JsonDetails title="Fuentes de busqueda del motor IA" value={response.groundingMetadata} subtle />
        ) : null}
        {response.usage || response.cost ? (
          <JsonDetails title="Uso y costo estimado" value={{ usage: response.usage, cost: response.cost }} subtle />
        ) : null}
        {response.raw || response.cleaned ? (
          <JsonDetails
            title="JSON crudo"
            value={response.cleaned ? { cleaned: response.cleaned, raw: response.raw } : response.raw}
            subtle
          />
        ) : null}
      </div>
    </div>
  );
}

function RunSummary({
  stage1,
  stage2,
  stage3,
  copRate
}: {
  stage1: ApiResponse | null;
  stage2: ApiResponse | null;
  stage3: ApiResponse | null;
  copRate: number;
}) {
  const stageData = [
    { label: "E1", response: stage1 },
    { label: "E2", response: stage2 },
    { label: "E3", response: stage3 }
  ].filter((s) => s.response?.usage || s.response?.cost);

  if (!stageData.length) return null;

  let totalUsd = 0;
  let totalTokens = 0;

  for (const { response } of stageData) {
    totalUsd += response?.cost?.totalUsd ?? 0;
    totalTokens += response?.usage?.totalTokens ?? 0;
  }

  const cop = copRate > 0 ? Math.round(totalUsd * copRate) : null;

  return (
    <div className="runSummary">
      <div className="runSummaryHeader">
        <span className="runSummaryTitle">Resumen de corrida</span>
        <span className="badge">{totalTokens.toLocaleString("es-CO")} tok</span>
        <span className="badge">{formatUsd(totalUsd)}</span>
        {cop != null ? <span className="badge">≈ COP {cop.toLocaleString("es-CO")}</span> : null}
      </div>
      <div className="runSummaryRows">
        {stageData.map(({ label, response }) => {
          if (!response) return null;
          const usd = response.cost?.totalUsd ?? 0;
          const tokens = response.usage?.totalTokens ?? 0;
          const stageCop = copRate > 0 ? Math.round(usd * copRate) : null;
          return (
            <span key={label} className="runSummaryRow">
              <strong>{label}</strong>: {getModelDisplayName(response.model)} · {tokens.toLocaleString("es-CO")} tok · {formatUsd(usd)}{stageCop != null ? ` · ≈ COP ${stageCop.toLocaleString("es-CO")}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function cellPlainTextDeep(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (depth > 5) {
    return "…";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cellPlainTextDeep(entry, depth + 1)).join(" · ");
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${cellPlainTextDeep(entry, depth + 1)}`)
      .join(" | ");
  }

  return "";
}

function getCellPlainTextForTitle(value: unknown, maxLen = 900): string {
  const text = cellPlainTextDeep(value).replace(/\s+/g, " ").trim();

  if (text.length <= maxLen) {
    return text;
  }

  return `${text.slice(0, maxLen)}…`;
}

function isComplexCellValue(value: unknown, column: string): boolean {
  const normalized = normalizeLabel(column);
  const complexColumns = new Set([
    "estado de cotizacion",
    "cotizaciones encontradas",
    "auditoria de busqueda",
    "vista rapida de cotizacion"
  ]);

  if (complexColumns.has(normalized)) {
    return true;
  }

  if (value === null || value === undefined || value === "") {
    return false;
  }

  return typeof value === "object";
}

function DynamicTable({ items }: { items: Record<string, unknown>[] }) {
  const columns = useMemo(() => Object.keys(items[0] ?? {}), [items]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

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
    <div className="dataTableMount">
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

      <div className="tableWrap tableWrapScroll">
        <table className="dataTable dataTableCompact">
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
            {sortedItems.map((item, rowIndex) => {
              const expanded = expandedRow === rowIndex;

              return (
                <tr
                  className={expanded ? "dataTableRowExpanded" : undefined}
                  key={rowIndex}
                  onClick={() => setExpandedRow((current) => (current === rowIndex ? null : rowIndex))}
                  title={expanded ? undefined : "Clic para expandir o contraer la fila"}
                >
                  {visibleColumns.map((column) => {
                    const raw = item[column];
                    const complex = isComplexCellValue(raw, column);
                    const bodyClass = expanded
                      ? "cellBody cellBodyExpanded"
                      : complex
                        ? "cellBody cellBodyComplex"
                        : "cellBody cellBodyEllipsis";

                    return (
                      <td
                        className={[getCellClassName(column)].filter(Boolean).join(" ")}
                        key={column}
                        title={getCellPlainTextForTitle(raw)}
                      >
                        <div className={bodyClass}>{formatCell(raw, column)}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JsonDetails({ title, value, subtle }: { title: string; value: unknown; subtle?: boolean }) {
  return (
    <details className={`jsonDetails${subtle ? " jsonDetailsSubtle" : ""}`}>
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
  onSend,
  canSend,
  embedded = false
}: {
  stage3Done: boolean;
  ingest: FinancialIngestPayload | null;
  loading: boolean;
  previewError: string | null;
  financialBusy: boolean;
  financialMessage: string | null;
  onSend: () => void;
  canSend: boolean;
  embedded?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const tableItems = useMemo(() => (ingest ? financialIngestToTableRows(ingest) : []), [ingest]);

  useEffect(() => {
    if (ingest) {
      setIsOpen(true);
    }
  }, [ingest]);

  if (!stage3Done) {
    const waiting = (
      <>
        {!embedded ? (
          <div className="sectionHeader stageHeader">
            <div className="stageHeaderTitle">
              <h2>Etapa 4: Preparación análisis financiero</h2>
            </div>
          </div>
        ) : null}
        <p className="muted stageTabPlaceholder">Completá Etapa 3 para la vista previa.</p>
      </>
    );

    if (embedded) {
      return <div className="stageTabBody">{waiting}</div>;
    }

    return <section className="panel">{waiting}</section>;
  }

  const header = (
    <div className="sectionHeader stageHeader">
      <div className="stageHeaderTitle">
        {embedded ? null : (
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? "Cerrar Etapa 4" : "Abrir Etapa 4"}
            className="sectionToggle"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            {isOpen ? "-" : "+"}
          </button>
        )}
        <h2 className={embedded ? "stageIngestHeading" : undefined}>Etapa 4: Preparación análisis financiero</h2>
      </div>

      <div className="sectionBadges">
        <span className="badge">{ingest?.items.length ?? 0} ítems</span>
        <span className="badge">Ingesta v1</span>
        {ingest?.settings?.usd_to_cop_rate ? (
          <span className="badge">TRM USD {ingest.settings.usd_to_cop_rate}</span>
        ) : null}
      </div>
    </div>
  );

  const body =
    loading || previewError || (isOpen && ingest) ? (
      <>
        {loading ? <p className="muted">Generando vista previa…</p> : null}
        {previewError ? <div className="error">{previewError}</div> : null}

        {isOpen && !loading && ingest ? (
          <>
            <p className="muted ingestPreviewLine">
              Vista previa <strong>POST /api/import</strong> · <strong>{ingest.calculation.name}</strong>
              {ingest.settings?.usd_import_pct != null ? ` · import USD ${ingest.settings.usd_import_pct}%` : null}
              <InfoTip
                label="Ingesta"
                text="Cada envío crea un cálculo nuevo en Simulador Financiero. El JSON coincide con el cuerpo del POST /api/import (contrato v1)."
              />
            </p>

            {tableItems.length ? (
              <DynamicTable items={tableItems} />
            ) : (
              <p className="empty">Sin filas exportables.</p>
            )}

            <div className="stageJsonStack">
              <JsonDetails title="JSON ingesta (v1)" value={ingest} subtle />
            </div>

            <div className="actions actionsCompact">
              <button type="button" onClick={onSend} disabled={financialBusy || !canSend}>
                {financialBusy ? "Enviando..." : "Enviar análisis financiero"}
              </button>
            </div>

            {financialMessage ? <div className="notice">{financialMessage}</div> : null}
          </>
        ) : null}
      </>
    ) : null;

  if (embedded) {
    return (
      <div className="stageTabBody">
        {header}
        {body}
      </div>
    );
  }

  return (
    <section className="panel">
      {header}
      {body}
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
    "nombre del producto",
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
