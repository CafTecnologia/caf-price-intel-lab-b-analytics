"use client";

import {
  Fragment,
  Suspense,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { formatNumberEsCO, formatScalarForUi, parseLooseNumber, type NumberDisplayFormat } from "@/lib/display-format-es-co";
import { financialIngestToTableRows } from "@/lib/financial-ingest-preview-rows";
import { parseJsonFromModelText } from "@/lib/json";
import {
  DEFAULT_QUOTE_PROVIDER_ID,
  QUOTE_PROVIDER_DEFINITIONS,
  getQuoteProviderDefinition,
  getQuoteProviderUrl,
  type QuoteProviderId
} from "@/lib/quote-provider-contract";
import { downloadFinancialIngestPreviewExcel, downloadStageItemsExcel } from "@/lib/stage-results-export-xlsx";
import type { FinancialIngestPayload } from "@/lib/stage3-to-financial-ingest";
import {
  type WorkProfileId,
  WORK_PROFILE_OPTIONS,
  getGeminiStageModelsForWorkProfile,
  getStageProvidersAllGemini,
  isWorkProfileId
} from "@/lib/work-profiles";

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

type Stage3PreservationNotice = {
  preservedPrevious?: boolean;
  reason?: string;
  attemptedItemCount?: number;
  activeItemCount?: number;
  attemptedCoverage?: Record<string, unknown>;
  activeCoverage?: Record<string, unknown>;
  activeRunId?: string | null;
  activeModel?: string | null;
  activeProvider?: string | null;
  attemptedModel?: string | null;
  attemptedProvider?: string | null;
};

type ApiUsageAttemptPayload = {
  provider?: "gemini" | "deepseek" | "openai" | "vps";
  model?: string;
  usage?: UsageSummary;
  cost?: CostSummary;
  itemCount?: number;
};

type ApiResponse = {
  runId?: string;
  analysisId?: string;
  analysisCode?: string;
  result?: StageResult;
  raw?: string;
  cleaned?: string;
  model?: string;
  provider?: "gemini" | "deepseek" | "openai" | "vps";
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
  preservation?: Stage3PreservationNotice;
  usageAttempt?: ApiUsageAttemptPayload;
};

type StageResult = {
  [key: string]: unknown;
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
type UiMode = "standard" | "admin";

type StageProviders = {
  stage1: "" | AiProvider;
  stage2: "" | AiProvider;
  stage3: "" | AiProvider;
};

type LoadingStage = "stage1" | "stage2" | "stage3" | "pipeline" | null;

type LastErrorContext = {
  scope: "pipeline" | "stage1" | "stage2" | "stage3";
  retryable: boolean;
};

type ActiveStagesState = {
  s1: boolean;
  s2: boolean;
  s3: boolean;
  s4: boolean;
};

type OfficialTrmClientState =
  | { status: "loading" }
  | {
      status: "ready";
      value: number;
      vigenciahasta: string;
      source: string;
      fromOfficialDataset: boolean;
    }
  | { status: "unavailable"; detail?: string };

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

type ResultsTabId = "stage1" | "stage2" | "stage3" | "stage3b" | "stage3c" | "stage4";
type Stage3FinancialSource = "stage2" | "stage3" | "stage3b" | "stage3c";
type Stage3RunMode = "classic" | "stage3b_api" | "stage3b_manual" | "stage3b_local" | "stage3c_parallel";

type Stage3BRunOptions = {
  action?: "quote" | "manual_quote" | "supervise" | "apply" | "discard_last_attempt";
  stage2Json: unknown;
  currentStage3B?: ApiResponse | null;
  runId?: string;
  provider?: "openai" | "google";
  model?: string;
  reasoningEffort?: string;
  supervisorModel?: string;
  maxAttempts?: number;
  batchSize?: number;
  searchContextSize?: "low" | "medium" | "high";
  promptInstruction?: string;
  manualRaw?: string;
  manualItemKeys?: string[];
  manualPromptFinal?: string;
  autoSupervise?: boolean;
  selectedItemKeys?: string[];
};

type Stage3CShardStatus = "pending" | "quoting" | "integrating" | "done" | "failed";

type Stage3CShardState = {
  id: string;
  label: string;
  itemKeys: string[];
  attempt: number;
  status: Stage3CShardStatus;
  approved: string[];
  pending: string[];
  message: string;
  jobId?: string;
  lastError?: string;
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
  enableStage3ReviewTools?: boolean;
  reviewProvider?: "" | AiProvider;
  reviewModel?: string;
  displayNumberFormat?: NumberDisplayFormat;
  usage?: UsageSummary;
  cost?: CostSummary;
  ok?: boolean;
  message?: string;
  error?: string;
  errorAction?: string;
  providerServices?: ProviderServiceStatus[];
};

type ProviderServiceStatus = {
  id: string;
  label: string;
  envKey: string;
  services: string[];
  role: string;
  docsUrl: string;
  notes: string;
  model?: string;
  modelEnvKey?: string;
  defaultModel?: string;
  modelOptions?: Array<{ value: string; label: string }>;
  reasoningEffort?: string;
  reasoningEnvKey?: string;
  defaultReasoningEffort?: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
};

type ProviderServiceKeys = Record<string, string>;

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

type HistoricalUsageAttempt = HistoricalStage & {
  attemptId?: number | string | null;
  runId?: string | null;
  analysisId?: string | null;
  analysisCode?: string | null;
  createdAt?: string | null;
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
  usageAttempts?: HistoricalUsageAttempt[];
};

type RunsResponse = {
  runs?: HistoricalRun[];
  error?: string;
};

type RunDetailResponse = {
  run?: HistoricalRun;
  error?: string;
};

type PipelineLogRow = {
  ts?: string;
  runId?: string;
  stage?: string;
  event?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  fileName?: string;
  data?: unknown;
  error?: unknown;
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

type AdjustmentPopoverState = {
  rowIndex: number;
  column: string;
};

type AlertsDrawerState = {
  rowIndex: number;
  column: string;
  alerts: string[];
} | null;

const AI_MODEL_GROUPS = [
  {
    label: "Linea 3 estable / actual",
    models: [
      {
        value: "gemini-3.5-flash",
        label: "3.5 Flash"
      },
      {
        value: "gemini-3.1-flash-lite",
        label: "3.1 Flash-Lite"
      },
      {
        value: "gemini-3.1-pro-preview",
        label: "3.1 Pro Preview"
      },
      {
        value: "gemini-3-pro-preview",
        label: "3 Pro Preview"
      }
    ]
  },
  {
    label: "Linea 3 preview / fallback",
    models: [
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
    label: "Linea 2.5 fallback",
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
      },
      {
        value: "gemini-2.5-flash-lite-preview-09-2025",
        label: "2.5 Flash-Lite Preview 09-2025"
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

const EXTERNAL_PROVIDER_EMPTY_KEYS: ProviderServiceKeys = {
  openai: "",
  anthropic: "",
  perplexity: "",
  brave: "",
  tavily: "",
  exa: "",
  serpapi: ""
};

const PROVIDER_SERVICE_ROLE_LABELS: Record<string, string> = {
  cotizador_con_busqueda: "Cotizador con busqueda",
  buscador_evidencia: "Buscador de evidencia",
  buscador_compras: "Buscador comercial"
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

const RAW_TEXT_PREVIEW_LIMIT = 20000;

function getStage3RunModeShortLabel(mode: Stage3RunMode) {
  if (mode === "stage3c_parallel") return "E3-C";
  if (mode === "stage3b_local") return "E3-B PC";
  if (mode === "stage3b_manual") return "E3-B manual";
  if (mode === "stage3b_api") return "E3-B API";
  return "E3";
}

function getStage3RunModeProgressLabel(mode: Stage3RunMode) {
  if (mode === "stage3c_parallel") return "Etapa 3-C paralela: carriles fijos";
  if (mode === "stage3b_local") return "Etapa 3-B proveedor Codex";
  if (mode === "stage3b_manual") return "Etapa 3-B manual: preparar copia";
  if (mode === "stage3b_api") return "Etapa 3-B API: cotización asistida";
  return "Etapa 3: cotización de precios";
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlOdooProjectId = useMemo(() => searchParams.get("odooProjectId")?.trim() || undefined, [searchParams]);
  const urlAnalysisId = useMemo(() => searchParams.get("analysisId")?.trim() || undefined, [searchParams]);
  const urlRunId = useMemo(() => searchParams.get("run")?.trim() || undefined, [searchParams]);

  const [file, setFile] = useState<File | null>(null);
  const [stage1, setStage1] = useState<ApiResponse | null>(null);
  const [stage2, setStage2] = useState<ApiResponse | null>(null);
  const [stage3, setStage3] = useState<ApiResponse | null>(null);
  const [stage3b, setStage3B] = useState<ApiResponse | null>(null);
  const [stage3c, setStage3C] = useState<ApiResponse | null>(null);
  const [stage2Experiment, setStage2Experiment] = useState<ApiResponse | null>(null);
  const [stage3GoogleExperiment, setStage3GoogleExperiment] = useState<ApiResponse | null>(null);
  const [stage3OpenAiExperiment, setStage3OpenAiExperiment] = useState<ApiResponse | null>(null);
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
  const [providerServiceKeys, setProviderServiceKeys] = useState<ProviderServiceKeys>(EXTERNAL_PROVIDER_EMPTY_KEYS);
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [geminiModel, setGeminiModel] = useState(getFirstProviderModel("gemini"));
  const [deepseekModel, setDeepSeekModel] = useState(getFirstProviderModel("deepseek"));
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
  const [usageAttempts, setUsageAttempts] = useState<HistoricalUsageAttempt[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDropzoneActive, setIsDropzoneActive] = useState(false);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [activeAnalysisCode, setActiveAnalysisCode] = useState<string | null>(null);
  const [ignoreUrlAnalysisId, setIgnoreUrlAnalysisId] = useState(false);
  const [resultsTab, setResultsTab] = useState<ResultsTabId>("stage1");
  const [stage3FinancialSource, setStage3FinancialSource] = useState<Stage3FinancialSource>("stage3");
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logStage, setLogStage] = useState<"all" | "stage1" | "stage2" | "stage3" | "stage3b" | "stage3c">("all");
  const [logRows, setLogRows] = useState<PipelineLogRow[]>([]);
  const [logBusy, setLogBusy] = useState(false);
  const [logMessage, setLogMessage] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [workProfile, setWorkProfile] = useState<WorkProfileId>("default");
  const [enableStage3ReviewTools, setEnableStage3ReviewTools] = useState(false);
  const [reviewProvider, setReviewProvider] = useState<"" | AiProvider>("");
  const [reviewModel, setReviewModel] = useState("");
  const [displayNumberFormat, setDisplayNumberFormat] = useState<NumberDisplayFormat>("es-CO");
  const [uiMode, setUiMode] = useState<UiMode>("standard");
  const [profileBusy, setProfileBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "warning" } | null>(null);
  const [toastPortalReady, setToastPortalReady] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workProfileRef = useRef(workProfile);
  const stageProvidersRef = useRef(stageProviders);
  const stageModelsRef = useRef(stageModels);
  const providerRef = useRef(provider);
  const geminiModelRef = useRef(geminiModel);
  const deepseekModelRef = useRef(deepseekModel);
  const geminiApiKeyRef = useRef(geminiApiKey);
  const deepseekApiKeyRef = useRef(deepseekApiKey);
  const providerServiceKeysRef = useRef(providerServiceKeys);
  const enableStage3ReviewToolsRef = useRef(enableStage3ReviewTools);
  const reviewProviderRef = useRef(reviewProvider);
  const reviewModelRef = useRef(reviewModel);
  const displayNumberFormatRef = useRef(displayNumberFormat);
  const urlRunHydratedRef = useRef<string | null>(null);
  const [lastErrorContext, setLastErrorContext] = useState<LastErrorContext | null>(null);
  const [activeStages, setActiveStages] = useState<ActiveStagesState>({
    s1: true,
    s2: true,
    s3: false,
    s4: false
  });
  const [stage3RunMode, setStage3RunMode] = useState<Stage3RunMode>("stage3b_manual");
  const [trmClientState, setTrmClientState] = useState<OfficialTrmClientState>({ status: "loading" });
  const copRate = trmClientState.status === "ready" ? trmClientState.value : 0;
  const activeStage3ForFinancial =
    stage3FinancialSource === "stage2"
      ? stage2
      : stage3FinancialSource === "stage3c"
        ? stage3c
      : stage3FinancialSource === "stage3b"
        ? stage3b
        : stage3;
  const activeStage3FinancialLabel =
    stage3FinancialSource === "stage2"
      ? "Etapa 2"
      : stage3FinancialSource === "stage3c"
        ? "Etapa 3-C"
      : stage3FinancialSource === "stage3b"
        ? "Etapa 3-B"
        : "Etapa 3";
  const setManualStageProvider = useMemo(
    () =>
      setManualStageProviderFactory(
        setStageProviders,
        setStageModels,
        geminiModel || getFirstProviderModel("gemini"),
        deepseekModel || getFirstProviderModel("deepseek")
      ),
    [geminiModel, deepseekModel]
  );
  const setManualStageModel = useMemo(
    () => setManualStageModelFactory(setStageProviders, setStageModels),
    []
  );

  useEffect(() => {
    workProfileRef.current = workProfile;
    stageProvidersRef.current = stageProviders;
    stageModelsRef.current = stageModels;
    providerRef.current = provider;
    geminiModelRef.current = geminiModel;
    deepseekModelRef.current = deepseekModel;
    geminiApiKeyRef.current = geminiApiKey;
    deepseekApiKeyRef.current = deepseekApiKey;
    providerServiceKeysRef.current = providerServiceKeys;
    enableStage3ReviewToolsRef.current = enableStage3ReviewTools;
    reviewProviderRef.current = reviewProvider;
    reviewModelRef.current = reviewModel;
    displayNumberFormatRef.current = displayNumberFormat;
  });

  useEffect(() => {
    setToastPortalReady(true);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("ia-stages-ui-mode");
    if (stored === "admin") {
      setUiMode("admin");
    }
    const storedStage3Mode = window.localStorage.getItem("ia-stages-stage3-run-mode");
    if (storedStage3Mode === "classic" || storedStage3Mode === "stage3b_api" || storedStage3Mode === "stage3b_manual" || storedStage3Mode === "stage3b_local" || storedStage3Mode === "stage3c_parallel") {
      setStage3RunMode(storedStage3Mode);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ia-stages-ui-mode", uiMode);
  }, [uiMode]);

  useEffect(() => {
    window.localStorage.setItem("ia-stages-stage3-run-mode", stage3RunMode);
  }, [stage3RunMode]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (manualPersistTimerRef.current) {
        clearTimeout(manualPersistTimerRef.current);
      }
    };
  }, []);

  const showAppToast = useCallback((message: string, tone: "success" | "error" | "warning") => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  function appendStage1FormContext(formData: FormData) {
    if (urlOdooProjectId) {
      formData.append("odooProjectId", urlOdooProjectId);
    }
    const analysisForRequest = activeAnalysisId || (!ignoreUrlAnalysisId ? urlAnalysisId : undefined);
    if (analysisForRequest) {
      formData.append("analysisId", analysisForRequest);
    }
  }

  function replaceRunInUrl(nextRunId: string | null) {
    const params = new URLSearchParams(window.location.search);
    params.delete("launchToken");
    params.delete("odooBaseUrl");
    params.delete("odooDb");
    if (nextRunId) {
      params.set("run", nextRunId);
    } else {
      params.delete("run");
    }
    const query = params.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    void loadConfig();
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!urlRunId || urlRunHydratedRef.current === urlRunId || runId === urlRunId) {
      return;
    }
    urlRunHydratedRef.current = urlRunId;
    void openHistoricalRun(urlRunId, { fromUrl: true });
  }, [urlRunId, runId]);

  useEffect(() => {
    if (runId && runId !== urlRunId) {
      replaceRunInUrl(runId);
    }
  }, [runId, urlRunId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/trm")
      .then(async (response) => {
        const data = (await response.json()) as {
          value?: number | null;
          vigenciahasta?: string;
          source?: string;
          fromOfficialDataset?: boolean;
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (response.ok && typeof data.value === "number" && data.value > 0) {
          setTrmClientState({
            status: "ready",
            value: data.value,
            vigenciahasta: typeof data.vigenciahasta === "string" ? data.vigenciahasta : "",
            source: typeof data.source === "string" ? data.source : "",
            fromOfficialDataset: Boolean(data.fromOfficialDataset)
          });
          return;
        }
        setTrmClientState({
          status: "unavailable",
          detail: data.error ?? "No se obtuvo una TRM válida desde el servidor."
        });
      })
      .catch(() => {
        if (!cancelled) {
          setTrmClientState({ status: "unavailable", detail: "No se pudo consultar la TRM oficial." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLogRows([]);
    setLogMessage(null);
    setFeedbackMessage(null);
    setFeedbackText("");
  }, [runId]);

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
    if (!activeStage3ForFinancial?.result) {
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
      body: JSON.stringify({
        stage3Result: activeStage3ForFinancial.result,
        sourceSystem: `ia-stages-web:${stage3FinancialSource}`,
        ...(activeAnalysisId ? { analysisId: activeAnalysisId } : {}),
        ...(runId ? { runId } : {}),
        ...(copRate > 0 ? { usdToCopRate: copRate } : {})
      })
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
  }, [activeStage3ForFinancial?.result, copRate, stage3FinancialSource]);

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
      setStageProviders(normalizeStageProviders(payload.stageProviders));
      setStageModels(normalizeStageModels(payload.stageModels));
      setWorkProfile(isWorkProfileId(payload.workProfile) ? payload.workProfile : "default");
      setEnableStage3ReviewTools(Boolean(payload.enableStage3ReviewTools));
      setReviewProvider(
        payload.reviewProvider === "gemini" || payload.reviewProvider === "deepseek" ? payload.reviewProvider : ""
      );
      setReviewModel(typeof payload.reviewModel === "string" ? payload.reviewModel : "");
      setDisplayNumberFormat(payload.displayNumberFormat === "raw" ? "raw" : "es-CO");
      setProviderServiceKeys(EXTERNAL_PROVIDER_EMPTY_KEYS);
    } else {
      setConfigMessage(payload.error ?? "No se pudo leer la configuración.");
    }
  }

  function setSelectedFile(nextFile: File | null) {
    setFile(nextFile);
    setIsDropzoneActive(false);
    setError(null);
  }

  function pickDroppedFile(files: FileList | null) {
    const nextFile = files?.[0] ?? null;
    setSelectedFile(nextFile);
  }

  async function loadRuns() {
    const response = await fetch("/api/runs?limit=25");
    const payload = (await response.json()) as RunsResponse;

    if (!response.ok) {
      setHistoryMessage(payload.error ?? "No se pudo leer el historial.");
      return;
    }

    setHistoryMessage(null);
    setRuns(payload.runs ?? []);
  }

  async function openHistoricalRun(nextRunId: string, options?: { fromUrl?: boolean }) {
    setOpeningRunId(nextRunId);
    setHistoryMessage(null);

    const response = await fetch(`/api/runs/${encodeURIComponent(nextRunId)}${isAdminMode ? "?technical=1" : ""}`);
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
    const nextStage3 = stageToApiResponse(nextRun, "stage3");
    const nextStage3B = stageToApiResponse(nextRun, "stage3b");
    const nextStage3C = stageToApiResponse(nextRun, "stage3c");
    setStage3(nextStage3);
    setStage3B(nextStage3B);
    setStage3C(nextStage3C);
    setStage3FinancialSource(nextStage3C?.result ? "stage3c" : nextStage3B?.result ? "stage3b" : "stage3");
    setStage2Experiment(stageToApiResponse(nextRun, "stage2_experimental"));
    setStage3GoogleExperiment(stageToApiResponse(nextRun, "stage3_google_lab"));
    setStage3OpenAiExperiment(stageToApiResponse(nextRun, "stage3_openai_lab"));
    if (!options?.fromUrl) {
      replaceRunInUrl(nextRun.runId);
    }
    setUsageAttempts(Array.isArray(nextRun.usageAttempts) ? nextRun.usageAttempts : []);
    setError(null);
    setPipelineStatus(null);
    showAppToast(getHistoricalRunSummary(nextRun), "success");
    setLoading(null);
    setProcessStartedAt(null);
    setElapsedMs(Number(nextRun.totalDurationMs ?? 0));
    setStageTiming({ totalMs: Number(nextRun.totalDurationMs ?? 0) });
    setProgress({ phase: "idle", percent: 0, label: "Listo" });
    setProgressSteps(INITIAL_PROGRESS_STEPS);
    setSidebarExpanded(false);
    setOpeningRunId(null);
    setResultsTab(nextStage3C?.result ? "stage3c" : nextStage3B?.result ? "stage3b" : nextStage3?.result ? "stage3" : stageToApiResponse(nextRun, "stage2")?.result ? "stage2" : "stage1");
    setLastErrorContext(null);
    const nextStage1 = stageToApiResponse(nextRun, "stage1");
    const nextStage2 = stageToApiResponse(nextRun, "stage2");
    const nextHasStage1 = Boolean(nextStage1?.result);
    const nextHasStage2 = Boolean(nextStage2?.result);
    const nextHasStage3 = Boolean(nextStage3?.result || nextStage3B?.result || nextStage3C?.result);
    setActiveStages(
      !nextHasStage1
        ? { s1: true, s2: true, s3: false, s4: false }
        : !nextHasStage2
          ? { s1: false, s2: true, s3: false, s4: false }
          : { s1: false, s2: false, s3: !nextHasStage3, s4: false }
    );
  }

  function startNewRun() {
    setHistoricalRun(null);
    setFile(null);
    setIsDropzoneActive(false);
    setFileInputKey((current) => current + 1);
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setStage3B(null);
    setStage3C(null);
    setStage3FinancialSource("stage3");
    setStage2Experiment(null);
    setStage3GoogleExperiment(null);
    setStage3OpenAiExperiment(null);
    setUsageAttempts([]);
    setRunId(null);
    replaceRunInUrl(null);
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
    setActiveStages({ s1: true, s2: true, s3: true, s4: false });
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
        stageModels,
        enableStage3ReviewTools,
        reviewProvider,
        reviewModel,
        displayNumberFormat,
        providerServiceKeys
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
      if (isWorkProfileId(payload.workProfile)) {
        setWorkProfile(payload.workProfile);
      }
      setDisplayNumberFormat(payload.displayNumberFormat === "raw" ? "raw" : "es-CO");
    }

    setConfigBusy(null);
  }

  async function flushManualStageAssignment() {
    if (workProfileRef.current !== "manual") {
      return;
    }
    const nextStageProviders = normalizeStageProvidersForSave(stageProvidersRef.current);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geminiApiKey: geminiApiKeyRef.current,
          deepseekApiKey: deepseekApiKeyRef.current,
          provider: providerRef.current,
          geminiModel: geminiModelRef.current,
          deepseekModel: deepseekModelRef.current,
          model: buildProviderModelRef(
            providerRef.current,
            getProviderDefaultModel(providerRef.current, geminiModelRef.current, deepseekModelRef.current)
          ),
          workProfile: "manual",
          stageProviders: nextStageProviders,
          stageModels: stageModelsRef.current,
          enableStage3ReviewTools: enableStage3ReviewToolsRef.current,
          reviewProvider: reviewProviderRef.current,
          reviewModel: reviewModelRef.current,
          displayNumberFormat: displayNumberFormatRef.current
        })
      });
      const payload = (await response.json()) as ConfigResponse;
      if (!response.ok) {
        showAppToast(payload.error ?? "No se pudo guardar la selección manual.", "error");
        void loadConfig();
        return;
      }
      setSavedConfig(payload);
      setGeminiApiKey("");
      setDeepSeekApiKey("");
      if (isWorkProfileId(payload.workProfile)) {
        setWorkProfile(payload.workProfile);
      }
      setDisplayNumberFormat(payload.displayNumberFormat === "raw" ? "raw" : "es-CO");
      setStageProviders(normalizeStageProviders(payload.stageProviders));
      setStageModels(normalizeStageModels(payload.stageModels));
      showAppToast("Proveedor y modelos guardados.", "success");
    } catch {
      showAppToast("Error de red al guardar la selección manual.", "error");
    }
  }

  function bumpManualPersist() {
    if (workProfileRef.current !== "manual") {
      return;
    }
    if (manualPersistTimerRef.current) {
      clearTimeout(manualPersistTimerRef.current);
    }
    manualPersistTimerRef.current = setTimeout(() => {
      manualPersistTimerRef.current = null;
      void flushManualStageAssignment();
    }, 450);
  }

  function handleManualProviderSelection(stageId: keyof StageProviders, next: AiProvider) {
    setManualStageProvider(stageId, next);
    bumpManualPersist();
  }

  function handleManualModelSelection(stageId: keyof StageModels, model: string) {
    setManualStageModel(stageId, model);
    bumpManualPersist();
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

  async function applyWorkProfileSelection(nextProfile: WorkProfileId) {
    setProfileBusy(true);

    const nextStages =
      nextProfile === "manual"
        ? {
            stageProviders: normalizeStageProvidersForSave(stageProviders),
            stageModels
          }
        : {
            stageProviders: normalizeStageProvidersForSave(getStageProvidersAllGemini()),
            stageModels: getGeminiStageModelsForWorkProfile(nextProfile)
          };

    if (nextProfile !== "manual") {
      setStageProviders(getStageProvidersAllGemini());
      setStageModels(getGeminiStageModelsForWorkProfile(nextProfile));
    }

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
        workProfile: nextProfile,
        stageProviders: nextStages.stageProviders,
        stageModels: nextStages.stageModels
      })
    });
    const payload = (await response.json()) as ConfigResponse;
    setProfileBusy(false);

    if (!response.ok) {
      showAppToast(payload.error ?? "No se pudo guardar el perfil en el servidor.", "error");
      void loadConfig();
      return;
    }

    setSavedConfig(payload);
    setGeminiApiKey("");
    setDeepSeekApiKey("");
    setWorkProfile(isWorkProfileId(payload.workProfile) ? payload.workProfile : nextProfile);
    setStageProviders(normalizeStageProviders(payload.stageProviders));
    setStageModels(normalizeStageModels(payload.stageModels));
    showAppToast("Perfil guardado en el servidor.", "success");
  }

  function retryLastFailedStage() {
    if (!lastErrorContext?.retryable) {
      return;
    }
    const scope = lastErrorContext.scope;
    setLastErrorContext(null);
    setError(null);
    if (scope === "stage1") {
      void runStage1();
      return;
    }
    if (scope === "stage2") {
      void runStage2();
      return;
    }
    if (scope === "stage3") {
      void runStage3();
      return;
    }
    if (scope === "pipeline" && file) {
      void runPipeline(file);
    }
  }

  async function runPipeline(nextFile: File) {
    if (historicalRun) {
      setError(
        "Estás en una sesión abierta desde el listado. Para analizar otro archivo con el flujo automático, inicia un análisis nuevo."
      );
      return;
    }

    const totalStartedAt = Date.now();

    setLoading("pipeline");
    setError(null);
    setLastErrorContext(null);
    setRunId(null);
    setPipelineStatus("Procesando Etapa 1 y Etapa 2 automáticamente...");
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setStage3B(null);
    setStage3C(null);
    setStage3FinancialSource("stage3");
    setStage2Experiment(null);
    setStage3GoogleExperiment(null);
    setStage3OpenAiExperiment(null);
    setUsageAttempts([]);
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
    if (stage1Payload.analysisId) {
      setActiveAnalysisId(stage1Payload.analysisId);
      setActiveAnalysisCode(stage1Payload.analysisCode ?? null);
    }
    setStageTiming((current) => ({ ...current, stage1Ms }));

    if (!stage1Response.ok || !stage1Payload.result) {
      setProgressStep("stage1", { status: "failed", durationMs: stage1Ms });
      finishPipelineAsFailed(totalStartedAt, stage1Payload, "stage1");
      return;
    }

    appendUsageAttemptFromResponse(setUsageAttempts, "stage1", stage1Payload);
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

    appendUsageAttemptFromResponse(setUsageAttempts, "stage2", stage2Payload);
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
    const core = buildUserErrorMessage(failure, `No se pudo completar la ${stageName}.`);

    setElapsedMs(totalMs);
    setStageTiming((current) => ({ ...current, totalMs }));
    setProgress({
      phase: "failed",
      percent: failedStage === "stage1" ? 35 : 78,
      label: "Proceso detenido"
    });
    setError(`${core} Falló en ${stageName}.`);
    setPipelineStatus("Procesamiento detenido. El detalle técnico quedó en el log y el JSON crudo queda visible si existe.");
    setLastErrorContext({ scope: failedStage, retryable: Boolean(failure.retryable) });
    setLoading(null);
    void loadRuns();
  }

  function setProgressStep(id: ProgressStep["id"], patch: Partial<ProgressStep>) {
    setProgressSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step))
    );
  }

  function hasResultForStage(n: 1 | 2 | 3 | 4) {
    if (n === 1) return Boolean(stage1?.result);
    if (n === 2) return Boolean(stage2?.result);
    if (n === 3) return Boolean(stage3?.result || stage3b?.result || stage3c?.result);
    return Boolean(activeStage3ForFinancial?.result);
  }

  function canSelectStage(n: 1 | 2 | 3 | 4, state: ActiveStagesState = activeStages) {
    if (n === 1) return true;
    const previousKey = `s${n - 1}` as keyof ActiveStagesState;
    return Boolean(state[previousKey] || hasResultForStage((n - 1) as 1 | 2 | 3));
  }

  function toggleStage(n: 1 | 2 | 3 | 4, value: boolean) {
    setActiveStages((prev) => {
      const next: ActiveStagesState = { ...prev };
      const key = `s${n}` as keyof ActiveStagesState;
      if (value) {
        if (!canSelectStage(n, next)) {
          return prev;
        }
        next[key] = true;
      } else {
        next[key] = false;
        for (let i = n + 1; i <= 4; i += 1) {
          const stageIndex = i as 1 | 2 | 3 | 4;
          if (!canSelectStage(stageIndex, next)) {
            (next as Record<string, boolean>)[`s${i}`] = false;
          }
        }
      }
      return next;
    });
  }

  async function runSingleStage(
    stageNum: 1 | 2 | 3,
    overrideProvider: AiProvider | "",
    overrideModel: string
  ) {
    if (stageNum === 1) {
      if (historicalRun && !file) {
        setError(
          "Esta sesión no tiene el archivo en memoria. Adjunta el archivo en el cargador para reintentar la Etapa 1, o desmarca la Etapa 1 si solo reprocesas etapas posteriores."
        );
        return;
      }
      if (!file) {
        setError("Carga un archivo antes de ejecutar la Etapa 1.");
        return;
      }
    } else if (!stage1?.result) {
      setError("Ejecuta primero la Etapa 1.");
      return;
    } else if (stageNum === 3 && !stage2?.result) {
      setError("Ejecuta primero la Etapa 2.");
      return;
    }

    const stageKey = `stage${stageNum}` as "stage1" | "stage2" | "stage3";
    const effectiveProvider = (overrideProvider || getCheckedProvider(stageProviders[stageKey])) as AiProvider;
    const effectiveModel =
      overrideModel ||
      stageModels[stageKey] ||
      getProviderDefaultModel(effectiveProvider, geminiModel, deepseekModel);
    const modelRef =
      effectiveProvider && effectiveModel ? buildProviderModelRef(effectiveProvider, effectiveModel) : undefined;

    setLoading(stageKey);
    setError(null);
    setLastErrorContext(null);

    if (stageNum === 1) {
      if (historicalRun && file) {
        setHistoricalRun(null);
      }
      setStage1(null);
      setStage2(null);
      setStage3(null);
      setStage3B(null);
      setStage3C(null);
      setStage3FinancialSource("stage3");
      setStage2Experiment(null);
      setStage3GoogleExperiment(null);
      setStage3OpenAiExperiment(null);
      setUsageAttempts([]);
      setActiveAnalysisId(null);
      setActiveAnalysisCode(null);
      const formData = new FormData();
      formData.append("file", file!);
      if (modelRef) {
        formData.append("model", modelRef);
      }
      appendStage1FormContext(formData);
      const res = await fetch("/api/stage1", { method: "POST", body: formData });
      const payload = (await res.json()) as StageErrorResponse;
      setRunId(payload.runId ?? null);
      if (payload.analysisId) {
        setActiveAnalysisId(payload.analysisId);
        setActiveAnalysisCode(payload.analysisCode ?? null);
      }
      setStage1(payload);
      if (!res.ok) {
        setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 1."));
        setLastErrorContext({ scope: "stage1", retryable: Boolean(payload.retryable) });
      } else {
        appendUsageAttemptFromResponse(setUsageAttempts, "stage1", payload);
      }
      setLoading(null);
      return;
    }

    if (stageNum === 2) {
      setStage2(null);
      setStage3(null);
      const body: Record<string, unknown> = { stage1Json: stage1!.result, runId: stage1!.runId };
      if (modelRef) {
        body.model = modelRef;
      }
      const res = await fetch("/api/stage2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await res.json()) as StageErrorResponse;
      setRunId(payload.runId ?? stage1!.runId ?? null);
      setStage2(payload);
      if (!res.ok) {
        setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 2."));
        setLastErrorContext({ scope: "stage2", retryable: Boolean(payload.retryable) });
      } else {
        appendUsageAttemptFromResponse(setUsageAttempts, "stage2", payload);
      }
      setLoading(null);
      return;
    }

    if (stage3RunMode === "stage3b_manual" || stage3RunMode === "stage3b_local") {
      setResultsTab("stage3b");
      setPipelineStatus(stage3RunMode === "stage3b_local" ? "Etapa 3-B proveedor Codex lista: ejecuta el paquete en el proveedor elegido." : "Etapa 3-B manual lista: copia el Markdown, procesa en tu IA y pega la respuesta.");
      setLoading(null);
      return;
    }

    if (stage3RunMode === "stage3b_api") {
      setLoading(null);
      await runStage3B({
        action: "quote",
        stage2Json: stage2!.result,
        runId: stage2!.runId ?? runId ?? undefined,
        provider: "openai",
        model: "gpt-5.4-mini",
        reasoningEffort: "medium",
        supervisorModel: reviewProvider && reviewModel ? `${reviewProvider}:${reviewModel}` : undefined,
        maxAttempts: 3,
        batchSize: 20,
        searchContextSize: "low"
      });
      return;
    }

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

    const body: Record<string, unknown> = {
      stage2Json: stage2!.result,
      runId: stage2!.runId ?? runId
    };
    if (modelRef) {
      body.model = modelRef;
    }
    const res = await fetch("/api/stage3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await res.json()) as StageErrorResponse;
    const stage3Ms = Date.now() - startedAt;
    setRunId(payload.runId ?? stage2!.runId ?? runId);
    setElapsedMs(stage3Ms);
    setStageTiming({ stage3Ms, totalMs: stage3Ms });

    if (!res.ok) {
      setStage3(payload);
      setProgressStep("stage3", { status: "failed", durationMs: stage3Ms });
      setProgress({
        phase: "failed",
        percent: 72,
        label: "Etapa 3 detenida"
      });
      setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 3."));
      setPipelineStatus("Etapa 3 detenida. El detalle técnico quedó en el log y el JSON crudo queda visible si existe.");
      setLastErrorContext({ scope: "stage3", retryable: Boolean(payload.retryable) });
    } else {
      setStage3(payload);
      setStage3FinancialSource("stage3");
      appendUsageAttemptFromResponse(setUsageAttempts, "stage3", payload);
      setProgressStep("stage3", { status: "done", durationMs: stage3Ms });
      setProgress({
        phase: "completed",
        percent: 100,
        label: payload.preservation?.preservedPrevious ? "Etapa 3 preservada" : "Etapa 3 completa"
      });
      if (payload.preservation?.preservedPrevious) {
        const msg = getStage3PreservationMessage(payload.preservation);
        showAppToast(msg, "warning");
        setPipelineStatus(msg);
      } else {
        setPipelineStatus(`Etapa 3 finalizada en ${formatDuration(stage3Ms)}.`);
      }
    }
    setLoading(null);
    void loadRuns();
  }

  async function runSelectedStages() {
    if (!activeStages.s1 && !activeStages.s2 && !activeStages.s3) {
      setError("Selecciona al menos una etapa entre 1 y 3 para procesar.");
      return;
    }
    if (activeStages.s1 && !file) {
      setError("Marcaste la Etapa 1: adjunta el archivo para procesar o desmarca Etapa 1 si solo vas a usar resultados ya existentes.");
      return;
    }

    const totalStartedAt = Date.now();
    if (activeStages.s1 && file && historicalRun) {
      setHistoricalRun(null);
    }
    setLoading("pipeline");
    setError(null);
    setLastErrorContext(null);
    setPipelineStatus("Procesando etapas seleccionadas…");

    if (activeStages.s1) {
      setStage1(null);
      setStage2(null);
      setStage3(null);
      setStage3B(null);
      setStage3C(null);
      setStage3FinancialSource("stage3");
      setStage2Experiment(null);
      setStage3GoogleExperiment(null);
      setStage3OpenAiExperiment(null);
      setUsageAttempts([]);
      setActiveAnalysisId(null);
      setActiveAnalysisCode(null);
    } else if (activeStages.s2) {
      setStage2(null);
      setStage3(null);
      setStage3B(null);
      setStage3C(null);
      setStage3FinancialSource("stage3");
    } else if (activeStages.s3) {
      setStage3(null);
      setStage3B(null);
      setStage3C(null);
      setStage3FinancialSource("stage3");
    }

    setProcessStartedAt(totalStartedAt);
    setElapsedMs(0);
    setStageTiming({});

    const steps: ProgressStep[] = [];
    if (activeStages.s1) {
      steps.push({ id: "stage1", label: "Etapa 1: extracción y normalización", status: "pending" });
    }
    if (activeStages.s2) {
      steps.push({ id: "stage2", label: "Etapa 2: lectura técnica", status: "pending" });
    }
    if (activeStages.s3) {
      steps.push({ id: "stage3", label: getStage3RunModeProgressLabel(stage3RunMode), status: "pending" });
    }
    setProgressSteps(steps.length ? steps : INITIAL_PROGRESS_STEPS);
    setProgress({ phase: "preparing", percent: 5, label: "Preparando" });

    let currentStage1 = stage1;
    let currentStage2 = stage2;
    let currentRunId = runId;

    if (activeStages.s1) {
      setProgress({ phase: "stage1", percent: 12, label: "Etapa 1: extrayendo y normalizando" });
      setProgressStep("stage1", { status: "running" });
      const formData = new FormData();
      formData.append("file", file!);
      appendStage1FormContext(formData);
      const s1At = Date.now();
      const s1Res = await fetch("/api/stage1", { method: "POST", body: formData });
      const s1Pay = (await s1Res.json()) as StageErrorResponse;
      const s1Ms = Date.now() - s1At;
      setStage1(s1Pay);
      currentStage1 = s1Pay;
      currentRunId = s1Pay.runId ?? null;
      setRunId(currentRunId);
      if (s1Pay.analysisId) {
        setActiveAnalysisId(s1Pay.analysisId);
        setActiveAnalysisCode(s1Pay.analysisCode ?? null);
      }
      setStageTiming((t) => ({ ...t, stage1Ms: s1Ms }));
      if (!s1Res.ok || !s1Pay.result) {
        setProgressStep("stage1", { status: "failed", durationMs: s1Ms });
        finishPipelineAsFailed(totalStartedAt, s1Pay, "stage1");
        return;
      }
      appendUsageAttemptFromResponse(setUsageAttempts, "stage1", s1Pay);
      setProgressStep("stage1", { status: "done", durationMs: s1Ms });
    }

    if (activeStages.s2) {
      const dep = currentStage1 ?? stage1;
      if (!dep?.result) {
        setError("La Etapa 2 requiere resultado de la Etapa 1.");
        setLoading(null);
        return;
      }
      setProgress({ phase: "stage2", percent: 55, label: "Etapa 2: lectura técnica" });
      setProgressStep("stage2", { status: "running" });
      const s2Body: Record<string, unknown> = { stage1Json: dep.result, runId: dep.runId };
      const s2At = Date.now();
      const s2Res = await fetch("/api/stage2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s2Body)
      });
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
      appendUsageAttemptFromResponse(setUsageAttempts, "stage2", s2Pay);
      setProgressStep("stage2", { status: "done", durationMs: s2Ms });
    }

    if (activeStages.s3) {
      const dep = currentStage2 ?? stage2;
      if (!dep?.result) {
        setError("La Etapa 3 requiere resultado de la Etapa 2.");
        setLoading(null);
        return;
      }
      setProgress({ phase: "stage3", percent: 78, label: getStage3RunModeProgressLabel(stage3RunMode) });
      setProgressStep("stage3", { status: "running" });
      const s3At = Date.now();
      if (stage3RunMode === "stage3c_parallel") {
        setPipelineStatus("Etapa 3-C lista: configura carriles y ejecuta el procesamiento paralelo.");
        setResultsTab("stage3c");
        const s3Ms = Date.now() - s3At;
        setStageTiming((t) => ({ ...t, stage3Ms: s3Ms }));
        setProgressStep("stage3", { status: "done", durationMs: s3Ms });
      } else if (stage3RunMode === "stage3b_manual" || stage3RunMode === "stage3b_local") {
        setPipelineStatus(stage3RunMode === "stage3b_local" ? "Etapa 3-B proveedor Codex lista: ejecuta el paquete en el proveedor elegido." : "Etapa 3-B manual lista: copia el Markdown, procesa en tu IA y pega la respuesta.");
        setResultsTab("stage3b");
        const s3Ms = Date.now() - s3At;
        setStageTiming((t) => ({ ...t, stage3Ms: s3Ms }));
        setProgressStep("stage3", { status: "done", durationMs: s3Ms });
      } else if (stage3RunMode === "stage3b_api") {
        setPipelineStatus("Etapa 3-B API: cotizando primer lote asistido...");
        const s3Res = await fetch("/api/stage3b/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "quote",
            stage2Json: dep.result,
            runId: dep.runId ?? currentRunId,
            provider: "openai",
            model: "gpt-5.4-mini",
            reasoningEffort: "medium",
            supervisorModel: reviewProvider && reviewModel ? `${reviewProvider}:${reviewModel}` : undefined,
            batchSize: 20,
            maxAttempts: 3,
            searchContextSize: "low"
          })
        });
        const s3Pay = (await s3Res.json()) as StageErrorResponse;
        const s3Ms = Date.now() - s3At;
        setStage3B(s3Pay);
        setStage3FinancialSource("stage3b");
        setStageTiming((t) => ({ ...t, stage3Ms: s3Ms }));
        if (!s3Res.ok || !s3Pay.result) {
          setProgressStep("stage3", { status: "failed", durationMs: s3Ms });
          setProgress({ phase: "failed", percent: 88, label: "Etapa 3-B detenida" });
          setError(buildUserErrorMessage(s3Pay, "No se pudo ejecutar la Etapa 3-B."));
          setPipelineStatus("Etapa 3-B detenida.");
          setLastErrorContext({ scope: "stage3", retryable: Boolean(s3Pay.retryable) });
          setLoading(null);
          void loadRuns();
          return;
        }
        appendUsageAttemptFromResponse(setUsageAttempts, "stage3b", s3Pay);
        setResultsTab("stage3b");
        setProgressStep("stage3", { status: "done", durationMs: s3Ms });
      } else {
        setPipelineStatus("Etapa 3: buscando fuentes de precio con el motor IA...");
        const s3Body: Record<string, unknown> = {
          stage2Json: dep.result,
          runId: dep.runId ?? currentRunId
        };
        const s3Res = await fetch("/api/stage3", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s3Body)
        });
        const s3Pay = (await s3Res.json()) as StageErrorResponse;
        const s3Ms = Date.now() - s3At;
        setStage3(s3Pay);
        setStage3FinancialSource("stage3");
        setStageTiming((t) => ({ ...t, stage3Ms: s3Ms }));
        if (!s3Res.ok || !s3Pay.result) {
          setProgressStep("stage3", { status: "failed", durationMs: s3Ms });
          setProgress({ phase: "failed", percent: 88, label: "Etapa 3 detenida" });
          setError(buildUserErrorMessage(s3Pay, "No se pudo ejecutar la Etapa 3."));
          setPipelineStatus("Etapa 3 detenida.");
          setLastErrorContext({ scope: "stage3", retryable: Boolean(s3Pay.retryable) });
          setLoading(null);
          void loadRuns();
          return;
        }
        appendUsageAttemptFromResponse(setUsageAttempts, "stage3", s3Pay);
        if (s3Pay.preservation?.preservedPrevious) {
          const msg = getStage3PreservationMessage(s3Pay.preservation);
          showAppToast(msg, "warning");
          setPipelineStatus(msg);
        }
        setProgressStep("stage3", { status: "done", durationMs: s3Ms });
      }
    }

    const totalMs = Date.now() - totalStartedAt;
    setStageTiming((t) => ({ ...t, totalMs }));
    setElapsedMs(totalMs);
    setProgress({ phase: "completed", percent: 100, label: "Proceso completo" });
    const label = [activeStages.s1 ? "E1" : null, activeStages.s2 ? "E2" : null, activeStages.s3 ? getStage3RunModeShortLabel(stage3RunMode) : null]
      .filter(Boolean)
      .join(" + ");
    setPipelineStatus(
      `Procesamiento completo: ${label || "ninguna etapa"}.${activeStages.s4 ? " Revisa la Etapa 4 para enviar al simulador." : ""}`
    );
    setLoading(null);
    void loadRuns();
    if (activeStages.s3) {
      setResultsTab(stage3RunMode === "classic" ? "stage3" : stage3RunMode === "stage3c_parallel" ? "stage3c" : "stage3b");
    } else if (activeStages.s2) {
      setResultsTab("stage2");
    } else if (activeStages.s1) {
      setResultsTab("stage1");
    }
  }

  async function runStage1() {
    await runSingleStage(1, "", "");
  }

  async function runStage2() {
    await runSingleStage(2, "", "");
  }

  async function runStage3() {
    await runSingleStage(3, "", "");
  }

  async function runStage3B(options: Stage3BRunOptions) {
    if (!options.stage2Json) {
      setError("Etapa 3-B necesita una salida de Etapa 2.");
      return;
    }

    setLoading("stage3");
    setError(null);
    setPipelineStatus(options.action === "supervise" ? "Etapa 3-B: supervisor revisando el ultimo intento..." : options.action === "apply" ? "Etapa 3-B: subiendo seleccionados a la tabla principal..." : "Etapa 3-B: cotizador procesando el siguiente lote...");
    setProcessStartedAt(Date.now());
    setProgressSteps(STAGE3_PROGRESS_STEPS);
    setProgress({ phase: "stage3", percent: 12, label: options.action === "supervise" ? "Etapa 3-B: supervisando intento" : options.action === "apply" ? "Etapa 3-B: aplicando seleccion" : "Etapa 3-B: cotizando lote" });
    setProgressStep("stage3", { status: "running" });

    try {
      const startedAt = Date.now();
      const response = await fetch("/api/stage3b/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, currentStage3B: options.currentStage3B ?? stage3b, action: options.action || "quote" })
      });
      const payload = (await response.json()) as StageErrorResponse;
      const durationMs = Date.now() - startedAt;
      setRunId(payload.runId ?? options.runId ?? runId);
      setElapsedMs(durationMs);
      setStageTiming({ stage3Ms: durationMs, totalMs: durationMs });

      if (!response.ok || !payload.result) {
        setStage3B(payload);
        setProgressStep("stage3", { status: "failed", durationMs });
        setProgress({ phase: "failed", percent: 72, label: "Etapa 3-B detenida" });
        setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 3-B."));
        setPipelineStatus("Etapa 3-B detenida. Revisa el detalle tecnico y los logs.");
        setLastErrorContext({ scope: "stage3", retryable: Boolean(payload.retryable) });
        return payload;
      }

      setStage3B(payload);
      setStage3FinancialSource("stage3b");
      setResultsTab("stage3b");
      appendUsageAttemptFromResponse(setUsageAttempts, "stage3b", payload);
      setProgressStep("stage3", { status: "done", durationMs });
      setProgress({ phase: "completed", percent: 100, label: options.action === "supervise" ? "Intento 3-B supervisado" : options.action === "apply" ? "Seleccion 3-B aplicada" : "Lote 3-B cotizado" });
      const quality = payload.result.control_calidad?.etapa3b ? payload.result.control_calidad : null;
      const accepted = Number(quality?.sirve_directo ?? 0) + Number(quality?.sirve_con_cautela ?? 0);
      const total = Number(quality?.total_items ?? payload.result.items?.length ?? 0);
      setPipelineStatus(`Etapa 3-B actualizada: ${accepted}/${total} item(s) con fuente util o con cautela.`);
      const appliedKeys = Array.isArray(options.selectedItemKeys) ? options.selectedItemKeys.filter(Boolean) : [];
      const applyToast = appliedKeys.length === 1
        ? `Item ${appliedKeys[0]} aprobado y consolidado en Tabla Maestra.`
        : appliedKeys.length > 1
          ? `${appliedKeys.length} items aprobados y consolidados en Tabla Maestra.`
          : "Seleccion 3-B aprobada en la Tabla Maestra.";
      showAppToast(options.action === "supervise" ? "Supervisor 3-B aplicado." : options.action === "apply" ? applyToast : "Raw de cotizador 3-B guardado.", "success");
      void loadRuns();
      return payload;
    } finally {
      setLoading(null);
    }
  }

  async function runStage3C(options: Stage3BRunOptions) {
    if (!options.stage2Json) {
      setError("Etapa 3-C necesita una salida de Etapa 2.");
      return;
    }

    try {
      const startedAt = Date.now();
      const response = await fetch("/api/stage3c/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, currentStage3B: options.currentStage3B ?? stage3c, action: options.action || "manual_quote" })
      });
      const payload = (await response.json()) as StageErrorResponse;
      const durationMs = Date.now() - startedAt;
      setRunId(payload.runId ?? options.runId ?? runId);

      if (!response.ok || !payload.result) {
        setStage3C(payload);
        setError(buildUserErrorMessage(payload, "No se pudo ejecutar la Etapa 3-C."));
        setPipelineStatus("Etapa 3-C detenida. Revisa el carril y el log.");
        setLastErrorContext({ scope: "stage3", retryable: Boolean(payload.retryable) });
        return payload;
      }

      setStage3C(payload);
      setStage3FinancialSource("stage3c");
      setResultsTab("stage3c");
      appendUsageAttemptFromResponse(setUsageAttempts, "stage3c", payload);
      setStageTiming((current) => ({ ...current, stage3Ms: durationMs, totalMs: durationMs }));
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setPipelineStatus("Etapa 3-C detenida por error de red o integracion.");
    }
  }

  async function sendStage3ToFinancialOffer() {
    if (!activeStage3ForFinancial?.result) {
      setFinancialMessage("Elige una fuente lista: Etapa 2, Etapa 3 o Etapa 3-B.");
      return;
    }

    setFinancialBusy(true);
    setFinancialMessage(null);

    try {
      const response = await fetch("/api/financial-offer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage3Result: activeStage3ForFinancial.result,
          sourceSystem: `ia-stages-web:${stage3FinancialSource}`,
          ...(activeAnalysisId ? { analysisId: activeAnalysisId } : {}),
          ...(runId ? { runId } : {})
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
          payload.error ?? "Simulador Financiero no aceptó los datos. Revisa la consola o la respuesta técnica."
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
        "El envío fue aceptado pero no se recibió un ID de cálculo. Revisa Simulador Financiero o la respuesta técnica."
      );
    } catch {
      setFinancialMessage("No se pudo conectar con Simulador Financiero (red o URL del servidor).");
    } finally {
      setFinancialBusy(false);
    }
  }

  async function loadPipelineLog() {
    if (!runId) {
      setLogMessage("Primero necesitas un Run ID (ejecuta una etapa o abre una sesión del listado).");
      return;
    }

    setLogBusy(true);
    setLogMessage(null);
    try {
      const response = await fetch(
        `/api/pipeline-log?runId=${encodeURIComponent(runId)}&stage=${encodeURIComponent(logStage)}&limit=200`
      );
      const payload = (await response.json()) as { rows?: PipelineLogRow[]; error?: string };
      if (!response.ok) {
        setLogRows([]);
        setLogMessage(payload.error ?? "No se pudo leer el log técnico.");
        return;
      }
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      setLogRows(rows);
      setLogMessage(rows.length ? null : "No hay eventos de log para este Run ID todavía.");
    } catch {
      setLogRows([]);
      setLogMessage("Error de red al leer el log.");
    } finally {
      setLogBusy(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackText.trim()) {
      setFeedbackMessage("Escribe un comentario antes de enviar.");
      return;
    }

    setFeedbackBusy(true);
    setFeedbackMessage(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          stage: logStage === "all" ? resultsTab : logStage,
          analysisId: activeAnalysisId,
          analysisCode: activeAnalysisCode,
          odooProjectId: urlOdooProjectId ?? null,
          url: typeof window !== "undefined" ? window.location.href : null,
          userText: feedbackText,
          meta: {
            pipelineStatus,
            uiError: error,
            activeTab: resultsTab,
            historicalMode: Boolean(historicalRun)
          }
        })
      });
      const payload = (await response.json()) as { ok?: boolean; id?: string; error?: string };
      if (!response.ok || !payload.ok) {
        setFeedbackMessage(payload.error ?? "No se pudo enviar el comentario.");
        return;
      }
      setFeedbackText("");
      setFeedbackMessage(`Comentario guardado. ID: ${payload.id ?? "sin id"}.`);
    } catch {
      setFeedbackMessage("Error de red al enviar el comentario.");
    } finally {
      setFeedbackBusy(false);
    }
  }

  const hasExecutionStarted = Boolean(
    historicalRun || loading !== null || runId || stage1 || stage2 || stage3 || pipelineStatus
  );
  const isAdminMode = uiMode === "admin";
  const shouldShowOpsDetails = isAdminMode && (hasExecutionStarted || Boolean(error));
  const shouldShowPipelineNotice = Boolean(pipelineStatus && (loading !== null || error || isAdminMode));
  const activeWorkProfileUx = WORK_PROFILE_OPTIONS.find((option) => option.id === workProfile);
  const selectedStageCount = [activeStages.s1, activeStages.s2, activeStages.s3, activeStages.s4].filter(Boolean).length;
  const selectedExecutableStageCount = [activeStages.s1, activeStages.s2, activeStages.s3].filter(Boolean).length;
  const hasStage1Result = Boolean(stage1?.result);
  const hasStage2Result = Boolean(stage2?.result);
  const hasStage3Result = Boolean(stage3?.result || stage3b?.result || stage3c?.result);
  const selectedStagesHaveInputs =
    (!activeStages.s1 || Boolean(file)) &&
    (!activeStages.s2 || activeStages.s1 || hasStage1Result) &&
    (!activeStages.s3 || activeStages.s2 || hasStage2Result);
  const canExecuteSelectedStages = loading === null && selectedExecutableStageCount > 0 && selectedStagesHaveInputs;
  const shouldShowDocumentDropzone = !historicalRun || activeStages.s1 || Boolean(file);
  const documentDropzoneTitle = historicalRun
    ? "Adjunta el archivo para reintentar Etapa 1"
    : "Etapa 0: Arrastra aquí el pliego de la licitación o haz clic para subir";
  const documentDropzoneMeta = file
    ? file.name
    : historicalRun?.fileName
      ? `Archivo histórico: ${historicalRun.fileName}. Vuelve a adjuntarlo para re-ejecutar Etapa 1.`
      : "Formatos soportados: PDF, DOCX, XLSX, CSV o TXT";

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
            <div className="workspaceTopbarLead">
              <button
                type="button"
                className="topbarPanelToggle"
                aria-controls="session-sidebar"
                aria-expanded={sidebarExpanded}
                aria-label={sidebarExpanded ? "Ocultar historial de sesiones" : "Mostrar historial de sesiones"}
                title={sidebarExpanded ? "Ocultar panel de sesiones" : "Abrir panel de sesiones"}
                onClick={() => setSidebarExpanded((open) => !open)}
              >
                <svg className="topbarPanelToggleSvg" viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                    ry="2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path d="M9 3v18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
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
            </div>
            <div className="topbarActions">
              <a
                className="topbarSimulatorLinkButton"
                href="/finanzas"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Simulador Financiero (se abre en una pestaña nueva)"
                title="Abrir aplicación en nueva pestaña"
              >
                <svg className="topbarSimulatorIcon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="4"
                    y="2"
                    width="16"
                    height="20"
                    rx="2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path d="M8 6h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M16 14v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="16" cy="10" r="1" fill="currentColor" />
                  <circle cx="12" cy="10" r="1" fill="currentColor" />
                  <circle cx="8" cy="10" r="1" fill="currentColor" />
                  <circle cx="12" cy="14" r="1" fill="currentColor" />
                  <circle cx="8" cy="14" r="1" fill="currentColor" />
                  <circle cx="12" cy="18" r="1" fill="currentColor" />
                  <circle cx="8" cy="18" r="1" fill="currentColor" />
                  <circle cx="16" cy="18" r="1" fill="currentColor" />
                </svg>
                <span className="topbarSimulatorLabel">Simulador Financiero</span>
                <svg className="topbarSimulatorExternalIcon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M15 3h6v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10 14 21 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </a>
              <span className="badge" title={isAdminMode ? "Modo administrador" : "Modo estandar"}>
                {isAdminMode ? "Admin" : "Estandar"}
              </span>
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
                    <span className="fileLabel">Sesión abierta</span>
                    <InfoTip
                      label="Sesión"
                      text="Puedes reprocesar las etapas con los datos cargados. Para subir otro archivo y el flujo automático completo, inicia un análisis nuevo."
                    />
                  </div>
                  <p className="muted metaOneLine">
                    {formatDateTime(historicalRun.updatedAt)} · {getRunDisplayStatus(historicalRun).label} ·{" "}
                    {shortId(historicalRun.runId)}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary newAnalysisButton"
                  onClick={() => {
                    const ok = window.confirm("Esto descartara la sesion actual y empezara un analisis nuevo. ¿Continuar?");
                    if (ok) startNewRun();
                  }}
                >
                  Nuevo analisis
                </button>
              </div>
            ) : (
              <div className="stageZeroHeader">
                <div>
                  <p className="stageZeroKicker">Etapa 0</p>
                  <h2>Área de preparación</h2>
                  <p className="muted">
                    Define alcance, confirma TRM y carga el pliego antes de lanzar la ejecución.
                  </p>
                </div>
              </div>
            )}

            <div className="stageExecutionPanel" role="group" aria-label="Seleccion multiple de etapas a ejecutar">
              <div className="stageExecutionHeader">
                <div>
                  <strong>Etapas a ejecutar</strong>
                  <span>Marca una o varias etapas y luego ejecuta la seleccion.</span>
                </div>
                <button
                  type="button"
                  className="runProcessButton runProcessButtonPrimary stageExecutionRunButton"
                  onClick={() => void runSelectedStages()}
                  disabled={!canExecuteSelectedStages}
                >
                  {loading === "pipeline"
                    ? "Procesando..."
                    : selectedStageCount > 0
                      ? `Ejecutar ${selectedStageCount} etapa${selectedStageCount === 1 ? "" : "s"} seleccionada${selectedStageCount === 1 ? "" : "s"}`
                      : "Selecciona etapas"}
                </button>
              </div>
              <div className="stageScopeRow stageScopeRowCommand" aria-label="Alcance, TRM y perfil de la corrida">
                <div className="stageChipGroup" role="group" aria-label="Seleccion de etapas">
                  {([1, 2, 3, 4] as const).map((n) => {
                    const key = `s${n}` as keyof ActiveStagesState;
                    const prevEnabled = canSelectStage(n);
                    const checked = activeStages[key];
                    const hints = ["Extraccion", "Tecnico", "Cotizacion", "Simulador"];
                    const hasResult = hasResultForStage(n);
                    const status = hasResult ? "Ejecutada" : checked ? "Marcada" : "No marcada";
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`stageChip${checked ? " stageChipActive" : ""}${hasResult ? " stageChipDone" : ""}`}
                        aria-pressed={checked}
                        disabled={!prevEnabled || loading !== null}
                        onClick={() => toggleStage(n, !checked)}
                      >
                        <span className="stageChipCheck" aria-hidden="true">{checked ? "✓" : ""}</span>
                        <span className="stageChipText">
                          <span className="stageChipName">{n}. {hints[n - 1]}</span>
                          <span className="stageChipStatus">{status}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <label className="stage3RunModePicker" title="Define que variante de Etapa 3 se ejecuta cuando la etapa 3 esta activa.">
                  <span className="stageConfigScopeLabel">Etapa 3</span>
                  <span>Tipo E3</span>
                  <select
                    value={stage3RunMode}
                    disabled={!activeStages.s3 || loading !== null}
                    onChange={(event) => setStage3RunMode(event.target.value as Stage3RunMode)}
                  >
                    <option value="stage3b_manual">3-B manual</option>
                    <option value="stage3b_local">3-B proveedor Codex</option>
                    <option value="stage3c_parallel">3-C paralelo</option>
                    <option value="stage3b_api">3-B API asistida</option>
                    <option value="classic">3 clasica</option>
                  </select>
                </label>
                <div className="stageScopeRowMeta">
                <div className="trmStageZero">
                  {trmClientState.status === "loading" ? (
                    <span>TRM USD/COP consultando…</span>
                  ) : trmClientState.status === "ready" ? (
                    <span>
                      TRM USD/COP <strong>{trmClientState.value.toLocaleString("es-CO")}</strong>
                    </span>
                  ) : (
                    <span>TRM USD/COP no disponible</span>
                  )}
                </div>
                <label className="commandBarProfileLabel commandBarProfileLabelInline">
                  <span className="stageConfigScopeLabel">Global</span>
                  <span className="commandBarProfileLabelText">Perfil</span>
                  <select
                    className="commandBarProfileSelect commandBarProfileSelectCompact"
                    value={workProfile}
                    disabled={profileBusy || loading !== null}
                    aria-busy={profileBusy}
                    aria-label="Perfil de la corrida"
                    title="Perfil de la corrida"
                    onChange={(event) => void applyWorkProfileSelection(event.target.value as WorkProfileId)}
                  >
                    {WORK_PROFILE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} title={opt.description}>
                        {opt.title}
                      </option>
                    ))}
                  </select>
                  <InfoTip
                    label={activeWorkProfileUx?.title ?? "Perfil"}
                    text={
                      activeWorkProfileUx?.description ??
                      "Selecciona un perfil de trabajo. Los valores se guardan en el servidor."
                    }
                  />
                </label>
                </div>
              </div>
            </div>
            {workProfile === "manual" ? (
              <details className="manualStageConfigPanel manualStageConfigPanelBelowCommand" {...(isAdminMode ? { open: true } : {})}>
                <summary className="manualStageConfigSummary">
                  <strong>Configuracion manual de modelos</strong>
                  <span>Proveedor y modelo por etapa.</span>
                </summary>
                <p className="manualStageConfigHint muted">
                  Modo manual: elige proveedor y modelo por etapa. Se aplican al servidor al cambiar cada control.
                </p>
                <ManualStageSelectorsBlock
                  disabled={profileBusy || loading !== null}
                  stageProviders={stageProviders}
                  stageModels={stageModels}
                  geminiModel={geminiModel}
                  deepseekModel={deepseekModel}
                  onProviderChange={handleManualProviderSelection}
                  onModelChange={handleManualModelSelection}
                />
                {stageProviders.stage3 === "deepseek" ? (
                  <p className="notice warningNotice manualStageConfigWarning">
                    Etapa 3 necesita búsqueda web verificable. Selecciona Google para Etapa 3 antes de cotizar.
                  </p>
                ) : null}
              </details>
            ) : null}

            {shouldShowDocumentDropzone ? (
              <>
                <label
                  className={`documentDropzone${isDropzoneActive ? " documentDropzoneActive" : ""}${file ? " documentDropzoneHasFile" : ""}`}
                  htmlFor="document-file"
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDropzoneActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDropzoneActive(true);
                  }}
                  onDragLeave={() => setIsDropzoneActive(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    pickDroppedFile(event.dataTransfer.files);
                  }}
                >
                  <input
                    key={fileInputKey}
                    id="document-file"
                    className="documentDropzoneInput"
                    type="file"
                    accept=".txt,.csv,.xlsx,.docx,.pdf"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                  <span className="documentDropzoneIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M7 3h6.5L19 8.5V21H7V3Zm7 1.8V8h3.2L14 4.8ZM9 11h8v1.6H9V11Zm0 3.5h8v1.6H9v-1.6Zm0 3.5h5v1.6H9V18Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="documentDropzoneTitle">
                    {documentDropzoneTitle}
                  </span>
                  <span className="documentDropzoneMeta">
                    {documentDropzoneMeta}
                  </span>
                </label>
                {activeStages.s1 && !file ? (
                  <p className="notice warningNotice stageFileRequiredNotice">
                    Etapa 1 está marcada: adjunta el archivo para ejecutar la extracción, o desmarca Etapa 1 si solo vas a reprocesar etapas posteriores.
                  </p>
                ) : null}
              </>
            ) : null}

            {trmClientState.status === "ready" && trmClientState.fromOfficialDataset ? (
              <p className="muted trmOfficialLine">
                Fuente TRM: Datos Abiertos Colombia (Superfinanciera) · vigente hasta{" "}
                {formatTrmVigenciaHasta(trmClientState.vigenciahasta)}
              </p>
            ) : trmClientState.status === "unavailable" ? (
              <p className="notice trmOfficialLine">
                {trmClientState.detail ?? "TRM no disponible; las equivalencias en COP quedan omitidas."}
              </p>
            ) : null}

            {lastErrorContext?.retryable ? (
            <div className="runMainRow stageZeroActionRow">
                <button type="button" className="secondary" onClick={retryLastFailedStage} disabled={loading !== null}>
                  Reintentar etapa que falló
                </button>
            </div>
            ) : null}

            {shouldShowOpsDetails ? (
              <ProcessingMonitor
                elapsedMs={elapsedMs}
                progress={progress}
                steps={progressSteps}
                timing={stageTiming}
              />
            ) : null}

            {shouldShowPipelineNotice ? <div className="notice">{pipelineStatus}</div> : null}
            {error ? <div className="error">{error}</div> : null}
            {isAdminMode && runId ? <p className="muted runIdHint">Run: {shortId(runId)}</p> : null}

            {shouldShowOpsDetails ? <details className="logPanel" open={logOpen} onToggle={(e) => setLogOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="logPanelSummary">Log técnico y reporte</summary>
              <div className="logPanelBody">
                <p className="muted logPanelHint">
                  Usa esta sección para ver qué pasó en el pipeline (por etapa) y enviar un comentario para soporte.
                </p>

                <div className="logPanelControls">
                  <label className="logPanelField">
                    <span>Filtrar etapa</span>
                    <select value={logStage} onChange={(e) => setLogStage(e.target.value as typeof logStage)}>
                      <option value="all">Todas</option>
                      <option value="stage1">Etapa 1</option>
                      <option value="stage2">Etapa 2</option>
                      <option value="stage3">Etapa 3</option>
                      <option value="stage3b">Etapa 3-B</option>
                      <option value="stage3c">Etapa 3-C</option>
                    </select>
                  </label>
                  <button type="button" className="secondary" onClick={() => void loadPipelineLog()} disabled={logBusy}>
                    {logBusy ? "Cargando..." : "Cargar log"}
                  </button>
                </div>

                {logMessage ? <div className="notice">{logMessage}</div> : null}
                {logRows.length ? (
                  <div className="logRows">
                    {logRows.map((row, idx) => (
                      <div className="logRow" key={`${row.ts ?? "ts"}-${idx}`}>
                        <div className="logRowTop">
                          <span className="logRowTs">{row.ts ? new Date(row.ts).toLocaleString("es-CO", { timeZone: "America/Bogota", hourCycle: "h23" }) : ""}</span>
                          <span className="logRowTag">{row.stage ?? "stage"}</span>
                          <span className="logRowTag">{row.event ?? "event"}</span>
                          {row.provider || row.model ? (
                            <span className="logRowTag">
                              {[row.provider, row.model].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                          {typeof row.durationMs === "number" ? (
                            <span className="logRowTag">{formatDuration(row.durationMs)}</span>
                          ) : null}
                        </div>
                        {row.error ? (
                          <pre className="logRowPre">{JSON.stringify(row.error, null, 2)}</pre>
                        ) : row.data ? (
                          <pre className="logRowPre">{JSON.stringify(row.data, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="feedbackBox">
                  <label className="logPanelField">
                    <span>Comentario para soporte</span>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Qué archivo probaste, qué esperabas ver, qué pasó realmente, y si es error intermitente o repetible."
                      rows={5}
                    />
                  </label>
                  <div className="feedbackActions">
                    <button type="button" onClick={() => void submitFeedback()} disabled={feedbackBusy}>
                      {feedbackBusy ? "Enviando..." : "Enviar comentario"}
                    </button>
                  </div>
                  {feedbackMessage ? <div className="notice">{feedbackMessage}</div> : null}
                </div>
              </div>
            </details> : null}
          </section>

          {hasExecutionStarted ? (
            <StageResultsWorkspace
              activeTab={resultsTab}
              onTabChange={setResultsTab}
              stage1={stage1}
              stage2={stage2}
              stage3={stage3}
              stage3b={stage3b}
              stage3c={stage3c}
              stage2Experiment={stage2Experiment}
              stage3GoogleExperiment={stage3GoogleExperiment}
              stage3OpenAiExperiment={stage3OpenAiExperiment}
              onSetStage2Experiment={setStage2Experiment}
              onSetStage3GoogleExperiment={setStage3GoogleExperiment}
              onSetStage3OpenAiExperiment={setStage3OpenAiExperiment}
              onSetStage3B={setStage3B}
              onRunStage3B={runStage3B}
              onSetStage3C={setStage3C}
              onRunStage3C={runStage3C}
              stage3RunMode={stage3RunMode}
              onSetStage3RunMode={setStage3RunMode}
              stage3FinancialSource={stage3FinancialSource}
              onSetStage3FinancialSource={setStage3FinancialSource}
              reviewProvider={reviewProvider}
              reviewModel={reviewModel}
              copRate={copRate}
              historicalRun={Boolean(historicalRun)}
              file={file}
              loading={loading}
              stageProviders={stageProviders}
              stageModels={stageModels}
              geminiModel={geminiModel}
              deepseekModel={deepseekModel}
              displayNumberFormat={displayNumberFormat}
              isAdminMode={isAdminMode}
              usageAttempts={usageAttempts}
              onRunSingleStage={(stageNum, provider, model) => void runSingleStage(stageNum, provider, model)}
              enableStage3ReviewSandbox={Boolean(isAdminMode && savedConfig?.enableStage3ReviewTools)}
              openAiService={savedConfig?.providerServices?.find((service) => service.id === "openai") ?? null}
              hasGeminiApiKey={savedConfig?.hasGeminiApiKey}
              onApplyRepairedStage3={(result) => {
                setStage3((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return {
                    ...prev,
                    result: result as StageResult,
                    cleaned: JSON.stringify(result, null, 2)
                  };
                });
                showAppToast("Resultado Etapa 3 actualizado manualmente (sandbox).", "success");
              }}
              onApplyCompletedStage3={(next) => {
                setStage3((prev) => ({
                  ...(prev ?? {}),
                  ...next,
                  result: next.result,
                  cleaned: next.result ? JSON.stringify(next.result, null, 2) : next.cleaned
                }));
                setStage3FinancialSource("stage3");
                appendUsageAttemptFromResponse(setUsageAttempts, "stage3", next);
                if (next.preservation?.preservedPrevious) {
                  showAppToast(getStage3PreservationMessage(next.preservation), "warning");
                } else {
                  showAppToast(next.provider === "openai" ? "Resultado OpenAI experimental cargado en Etapa 3." : "Miniagente de faltantes actualizo Etapa 3.", "success");
                }
                void loadRuns();
              }}
              ingest={{
                stage3Done: Boolean(activeStage3ForFinancial?.result),
                ingest: financialIngestPreview,
                loading: financialPreviewLoading,
                previewError: financialPreviewError,
                financialBusy,
                financialMessage,
                onSend: () => void sendStage3ToFinancialOffer(),
                displayNumberFormat,
                sourceLabel: activeStage3FinancialLabel,
                financialSource: stage3FinancialSource,
                onSetFinancialSource: setStage3FinancialSource,
                sourceOptions: [
                  { id: "stage2", label: "Etapa 2", hint: "Base técnica sin cotizar", available: Boolean(stage2?.result) },
                  { id: "stage3", label: "Etapa 3", hint: "Cotización clásica", available: Boolean(stage3?.result) },
                  { id: "stage3b", label: "Etapa 3-B", hint: "Cotización asistida", available: Boolean(stage3b?.result) },
                  { id: "stage3c", label: "Etapa 3-C", hint: "Paralela", available: Boolean(stage3c?.result) }
                ],
                canSend:
                  Boolean(activeStage3ForFinancial?.result) &&
                  !financialPreviewLoading &&
                  !financialPreviewError &&
                  Boolean(financialIngestPreview?.items?.length)
              }}
            />
          ) : null}
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
                <h3 className="configDrawerSectionTitle">Modo de vista</h3>
                <InfoTip
                  label="Interfaz"
                  text="Estandar muestra solo lo necesario para operar. Administrador muestra JSON crudo, logs y herramientas experimentales."
                />
              </div>
              <div className="configGrid">
                <label>
                  <span>Vista activa</span>
                  <select value={uiMode} onChange={(event) => setUiMode(event.target.value === "admin" ? "admin" : "standard")}> 
                    <option value="standard">Estandar</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
              </div>
            </div>

            {isAdminMode ? (<>
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
                    placeholder={savedConfig?.hasGeminiApiKey ? "Dejar vacío para conservar la guardada" : "Pega tu API key"}
                    onChange={(event) => setGeminiApiKey(event.target.value)}
                  />
                </label>

                <label>
                  <span>API key DeepSeek</span>
                  <input
                    type="password"
                    value={deepseekApiKey}
                    placeholder={savedConfig?.hasDeepSeekApiKey ? "Dejar vacío para conservar la guardada" : "Pega tu API key"}
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
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Proveedor y modelo por etapa</h3>
                <InfoTip
                  label="Perfiles"
                  text="Cada etapa puede usar proveedor y modelo distintos. Etapa 3 no permite DeepSeek porque requiere búsqueda web verificable."
                />
              </div>
              <div className="stageManualWrap">
                <ManualStageSelectorsBlock
                  disabled={configBusy !== null}
                  stageProviders={stageProviders}
                  stageModels={stageModels}
                  geminiModel={geminiModel}
                  deepseekModel={deepseekModel}
                  onProviderChange={handleManualProviderSelection}
                  onModelChange={handleManualModelSelection}
                />
              </div>
              {stageProviders.stage3 === "deepseek" ? (
                <p className="notice warningNotice">
                  Etapa 3 necesita búsqueda web verificable. Selecciona Google para Etapa 3 antes de cotizar.
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



            <div className="configDrawerSection">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Formato regional</h3>
                <InfoTip
                  label="Presentacion"
                  text="Solo cambia como se ven numeros y precios en tablas. El JSON crudo de la IA queda intacto."
                />
              </div>
              <div className="configGrid">
                <label>
                  <span>Numeros en tablas</span>
                  <select
                    value={displayNumberFormat}
                    onChange={(event) => setDisplayNumberFormat(event.target.value === "raw" ? "raw" : "es-CO")}
                    disabled={configBusy !== null}
                  >
                    <option value="es-CO">Colombia: 1.234,56</option>
                    <option value="raw">Crudo: no reformatear</option>
                  </select>
                </label>
              </div>
              <p className="muted configDrawerHint">
                Afecta tablas y vistas de lectura; no modifica lo recibido de la IA ni el historial guardado.
              </p>
            </div>

            <div className="configDrawerSection configDrawerSectionProviderLab">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Proveedores web y Etapa 3-B</h3>
                <InfoTip
                  label="Experimental"
                  text="Llaves y modelos para cotizacion con busqueda web. Etapa 3-B usa OpenAI como cotizador y conserva este selector de modelo."
                />
              </div>
              <p className="muted configDrawerHint">
                OpenAI se usa como cotizador de Etapa 3-B; los demas proveedores quedan disponibles para laboratorios de evidencia.
              </p>
              <div className="providerServicesGrid">
                {(savedConfig?.providerServices ?? []).map((service) => (
                  <label key={service.id} className="providerServiceCard">
                    <span className="providerServiceHeader">
                      <span>
                        <strong>{service.label}</strong>
                        <small>{PROVIDER_SERVICE_ROLE_LABELS[service.role] ?? service.role}</small>
                      </span>
                      <span className={service.hasApiKey ? "providerServiceStatus providerServiceStatusReady" : "providerServiceStatus"}>
                        {service.hasApiKey ? `Lista ${service.maskedApiKey ?? ""}` : "Sin key"}
                      </span>
                    </span>
                    <input
                      type="password"
                      value={providerServiceKeys[service.id] ?? ""}
                      placeholder={service.hasApiKey ? "Dejar vacio para conservar" : service.envKey}
                      onChange={(event) =>
                        setProviderServiceKeys((current) => ({ ...current, [service.id]: event.target.value }))
                      }
                      disabled={configBusy !== null}
                    />
                    {service.modelEnvKey ? (
                      <select
                        value={providerServiceKeys[`${service.id}Model`] || service.model || service.defaultModel || ""}
                        onChange={(event) =>
                          setProviderServiceKeys((current) => ({ ...current, [`${service.id}Model`]: event.target.value }))
                        }
                        disabled={configBusy !== null}
                      >
                        {(service.modelOptions?.length
                          ? service.modelOptions
                          : [{ value: service.model || service.defaultModel || "", label: service.model || service.defaultModel || "Modelo" }]
                        ).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : null}
                    {service.id === "openai" ? (
                      <select
                        value={providerServiceKeys.openaiReasoningEffort || service.reasoningEffort || service.defaultReasoningEffort || "medium"}
                        onChange={(event) =>
                          setProviderServiceKeys((current) => ({ ...current, openaiReasoningEffort: event.target.value }))
                        }
                        disabled={configBusy !== null}
                        aria-label="Razonamiento OpenAI"
                      >
                        <option value="low">Razonamiento bajo</option>
                        <option value="medium">Razonamiento medio</option>
                        <option value="high">Razonamiento alto</option>
                        <option value="xhigh">Razonamiento extra alto</option>
                      </select>
                    ) : null}
                    <span className="providerServiceMeta">
                      {service.services.join(" + ")} - {service.envKey}
                      {service.modelEnvKey ? ` - ${service.modelEnvKey}: ${service.model || service.defaultModel || "sin modelo"}` : ""}
                    </span>
                    <span className="providerServiceNotes">{service.notes}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="configDrawerSection configDrawerSectionSandbox">
              <div className="configDrawerSectionHead">
                <h3 className="configDrawerSectionTitle">Sandbox — revisión Etapa 3</h3>
                <InfoTip
                  label="Experimental"
                  text="Activa el bloque de herramientas bajo el resultado de Etapa 3 y el mini-agente de reparación JSON. Requiere REVIEW_MODEL y la API key del proveedor elegido."
                />
              </div>
              <label className="configSandboxToggle">
                <input
                  type="checkbox"
                  checked={enableStage3ReviewTools}
                  onChange={(e) => setEnableStage3ReviewTools(e.target.checked)}
                  disabled={configBusy !== null}
                />
                <span>Mostrar herramientas de revisión (validar, faltantes, reparar JSON)</span>
              </label>
              <div className="configGrid">
                <label>
                  <span>Proveedor auditor/supervisor</span>
                  <select
                    value={reviewProvider || "gemini"}
                    onChange={(e) => {
                      const nextProvider = e.target.value === "deepseek" ? "deepseek" : "gemini";
                      setReviewProvider(nextProvider);
                      setReviewModel(getProviderDefaultModel(nextProvider, geminiModel, deepseekModel));
                    }}
                    disabled={configBusy !== null}
                  >
                    <option value="gemini">Google</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </label>
                <StageModelPicker
                  label="Modelo auditor/supervisor"
                  pickerProvider={reviewProvider || "gemini"}
                  value={reviewModel}
                  defaultModel={getProviderDefaultModel(reviewProvider || "gemini", geminiModel, deepseekModel)}
                  onChange={setReviewModel}
                />
              </div>
            </div>
            </>
            ) : null}

            <div className="actions">
              <button type="button" onClick={saveConfig} disabled={configBusy !== null}>
                {configBusy === "save" ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>

            {configMessage ? <div className="notice">{configMessage}</div> : null}
          </div>
        </div>
      ) : null}
      {toastPortalReady && toast
        ? createPortal(
            <div className={`appToast appToast--${toast.tone}`} role="status">
              {toast.message}
            </div>,
            document.body
          )
        : null}
    </main>
  );
}

function ManualStageSelectorsBlock({
  disabled,
  stageProviders,
  stageModels,
  geminiModel,
  deepseekModel,
  onProviderChange,
  onModelChange
}: {
  disabled: boolean;
  stageProviders: StageProviders;
  stageModels: StageModels;
  geminiModel: string;
  deepseekModel: string;
  onProviderChange: (stageId: keyof StageProviders, next: AiProvider) => void;
  onModelChange: (stageId: keyof StageModels, model: string) => void;
}) {
  const stages: Array<{ id: keyof StageProviders; label: string }> = [
    { id: "stage1", label: "E1 · Extracción" },
    { id: "stage2", label: "E2 · Técnico" },
    { id: "stage3", label: "E3 · Cotización" }
  ];
  const geminiDefault = geminiModel || getFirstProviderModel("gemini");
  const deepseekDefault = deepseekModel || getFirstProviderModel("deepseek");

  return (
    <div className="manualStageConfigGrid" role="group" aria-label="Proveedor y modelo por etapa">
      {stages.map(({ id, label }) => {
        const selectedProvider =
          id === "stage3" && stageProviders[id] === "deepseek"
            ? "gemini"
            : getCheckedProvider(stageProviders[id]);
        const selectedModel =
          stageModels[id] || getProviderDefaultModel(selectedProvider, geminiDefault, deepseekDefault);
        return (
          <div key={id} className="manualStageConfigCol">
            <div className="manualStageConfigColTitle">{label}</div>
            <label className="manualStageField">
              <span className="manualStageFieldLabel">Proveedor</span>
              <select
                value={selectedProvider}
                disabled={disabled}
                onChange={(event) => onProviderChange(id, event.target.value as AiProvider)}
              >
                <option value="deepseek" disabled={id === "stage3"}>
                  DeepSeek
                </option>
                <option value="gemini">Google</option>
              </select>
            </label>
            <label className="manualStageField">
              <span className="manualStageFieldLabel">Modelo</span>
              <select
                value={selectedModel}
                disabled={disabled}
                onChange={(event) => onModelChange(id, event.target.value)}
              >
                {PROVIDER_MODEL_GROUPS[selectedProvider].map((group) => (
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
        );
      })}
    </div>
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
      aria-label="Listado de sesiones"
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
            aria-label="Abrir listado de sesiones"
            className="sessionsCollapsedTrigger"
            onClick={() => onExpandedChange(true)}
                title="Sesiones"
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

function appendUsageAttemptFromResponse(
  setter: Dispatch<SetStateAction<HistoricalUsageAttempt[]>>,
  stage: "stage1" | "stage2" | "stage3" | "stage3b" | "stage3c",
  response: ApiResponse | null | undefined
) {
  if (!response?.runId) {
    return;
  }

  const attempt = response.usageAttempt;
  const usage = attempt?.usage ?? response.usage;
  const cost = attempt?.cost ?? response.cost;
  if (!usage && !cost) {
    return;
  }

  setter((current) => [
    ...current,
    {
      attemptId: `${response.runId}-${stage}-${Date.now()}`,
      runId: response.runId,
      stage,
      status: "ok",
      provider: attempt?.provider ?? response.provider ?? null,
      model: attempt?.model ?? response.model ?? null,
      durationMs: response.callTrace?.durationMs ?? null,
      itemCount: typeof attempt?.itemCount === "number" ? attempt.itemCount : response.result?.items?.length ?? null,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      thinkingTokens: usage?.thinkingTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      inputUsd: cost?.inputUsd ?? null,
      cachedInputUsd: cost?.cachedInputUsd ?? null,
      outputUsd: cost?.outputUsd ?? null,
      searchUsd: cost?.searchUsd ?? null,
      totalUsd: cost?.totalUsd ?? null,
      createdAt: new Date().toISOString()
    }
  ]);
}

function getStage3PreservationMessage(preservation: Stage3PreservationNotice) {
  const attempted = typeof preservation.attemptedItemCount === "number" ? preservation.attemptedItemCount : null;
  const active = typeof preservation.activeItemCount === "number" ? preservation.activeItemCount : null;
  const suffix = attempted !== null && active !== null ? ` (${attempted}/${active}).` : ".";
  return `Nuevo intento parcial; se conserva el mejor resultado anterior${suffix}`;
}

function stageToApiResponse(run: HistoricalRun, stageName: string): ApiResponse | null {
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
  return provider === "deepseek" || provider === "gemini" || provider === "openai" ? provider : undefined;
}

function getHistoricalRunSummary(run: HistoricalRun) {
  const displayStatus = getRunDisplayStatus(run);
  const stages = (Array.isArray(run.stages) ? run.stages : [])
    .map((stage) => formatStageLabel(stage.stage))
    .join(", ");

  if (displayStatus.label === "3-B disponible") {
    return "Sesion guardada con fallo en una rama, pero Etapa 3-B esta disponible.";
  }

  if (displayStatus.className === "incomplete") {
    return `Sesion guardada incompleta. Se guardo: ${stages || "ninguna etapa"}.`;
  }

  if (displayStatus.className === "failed") {
    return "Sesion guardada con fallo. Podes revisar las etapas guardadas y el mensaje de error.";
  }

  return `Sesion guardada (${displayStatus.label.toLowerCase()}).`;
}
function getRunDisplayStatus(run: HistoricalRun) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  if (run.status === "failed" || stages.some((stage) => stage.status === "failed")) {
    if (stages.some((stage) => stage.stage === "stage3b" && stage.status === "ok")) {
      return { className: "incomplete", label: "3-B disponible" };
    }
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

/** Fecha de vigencia TRM (campo `vigenciahasta` del API de datos.gov.co). */
function formatTrmVigenciaHasta(iso: string): string {
  if (!iso || !iso.trim()) {
    return "—";
  }
  const ymd = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-CO");
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString("es-CO", { timeZone: "America/Bogota" });
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
    timeStyle: "short",
    timeZone: "America/Bogota", hourCycle: "h23"
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

  return `${stageName}: espera prolongada; si falla, se mostrará el motivo y la acción sugerida.`;
}

function buildUserErrorMessage(
  payload: Pick<ApiResponse, "error" | "errorAction" | "errorCode" | "errorTitle">,
  fallback: string
) {
  const message = payload.error ?? fallback;
  const action = payload.errorAction ? ` Qué hacer: ${payload.errorAction}` : "";
  const shortLabel = payload.errorTitle ? ` — ${payload.errorTitle}` : "";
  const codeTag = payload.errorCode ? ` [${payload.errorCode}]` : "";
  return `${message}${action}${shortLabel}${codeTag}`;
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
  geminiDefaultModel: string,
  deepseekDefaultModel: string
) {
  return (stage: keyof StageProviders, nextProvider: AiProvider) => {
    setStageProvidersState((current) => ({ ...current, [stage]: nextProvider }));
    setStageModelsState((current) => ({
      ...current,
      [stage]: getProviderDefaultModel(nextProvider, geminiDefaultModel, deepseekDefaultModel)
    }));
  };
}

function setManualStageModelFactory(
  setStageProvidersState: Dispatch<SetStateAction<StageProviders>>,
  setStageModelsState: Dispatch<SetStateAction<StageModels>>
) {
  return (stage: keyof StageModels, model: string) => {
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
function StageModelPicker({
  label,
  value,
  defaultModel,
  onChange,
  pickerProvider = "gemini"
}: {
  label: string;
  value: string;
  defaultModel: string;
  onChange: (value: string) => void;
  /** Modelos listados en el menú (Google o DeepSeek). */
  pickerProvider?: AiProvider;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const modelGroups = PROVIDER_MODEL_GROUPS[pickerProvider];

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
              {modelGroups.map((group) => (
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

function RunSummary({
  stage1,
  stage2,
  stage3,
  stage3b,
  stage3c,
  usageAttempts,
  copRate
}: {
  stage1: ApiResponse | null;
  stage2: ApiResponse | null;
  stage3: ApiResponse | null;
  stage3b?: ApiResponse | null;
  stage3c?: ApiResponse | null;
  usageAttempts: HistoricalUsageAttempt[];
  copRate: number;
}) {
  const attemptData = usageAttempts
    .filter((attempt) => typeof attempt.totalTokens === "number" || typeof attempt.totalUsd === "number")
    .map((attempt, index) => ({
      key: String(attempt.attemptId ?? `${attempt.runId ?? "run"}-${attempt.stage}-${attempt.createdAt ?? index}`),
      label: getStageShortLabel(String(attempt.stage ?? "")),
      model: attempt.model ?? undefined,
      tokens: Number(attempt.totalTokens ?? 0),
      usd: Number(attempt.totalUsd ?? 0),
      createdAt: attempt.createdAt ?? null
    }));

  const fallbackData = [
    { label: "E1", response: stage1 },
    { label: "E2", response: stage2 },
    { label: "E3", response: stage3 },
    { label: "E3-B", response: stage3b ?? null },
    { label: "E3-C", response: stage3c ?? null }
  ]
    .filter((s) => s.response?.usage || s.response?.cost)
    .map(({ label, response }) => ({
      key: label,
      label,
      model: response?.model,
      tokens: Number(response?.usage?.totalTokens ?? 0),
      usd: Number(response?.cost?.totalUsd ?? 0),
      createdAt: null
    }));

  const rows = attemptData.length ? attemptData : fallbackData;

  if (rows.length === 0) {
    return null;
  }

  const totalUsd = rows.reduce((total, row) => total + row.usd, 0);
  const totalTokens = rows.reduce((total, row) => total + row.tokens, 0);
  const cop = copRate > 0 ? Math.round(totalUsd * copRate) : null;
  const title = attemptData.length ? "Resumen acumulado" : "Resumen de corrida";

  return (
    <div className="runSummary">
      <div className="runSummaryHeader">
        <span className="runSummaryTitle">{title}</span>
        <span className="badge">{rows.length} llamada(s)</span>
        <span className="badge">{totalTokens.toLocaleString("es-CO")} tokens</span>
        <span className="badge">{formatUsd(totalUsd)}</span>
        {cop != null ? <span className="badge">COP {cop.toLocaleString("es-CO")}</span> : null}
      </div>
      <details className="runSummaryDetails">
        <summary>Ver llamadas, modelos y horas</summary>
        <div className="runSummaryRows">
          {rows.map((row) => {
            const stageCop = copRate > 0 ? Math.round(row.usd * copRate) : null;
            return (
              <span key={row.key} className="runSummaryRow">
                <strong>{row.label}</strong>: {getModelDisplayName(row.model)} | {row.tokens.toLocaleString("es-CO")} tok | {formatUsd(row.usd)}
                {stageCop != null ? ` | COP ${stageCop.toLocaleString("es-CO")}` : ""}
                {row.createdAt ? ` | ${new Date(row.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota", hourCycle: "h23" })}` : ""}
              </span>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function getStageShortLabel(stage: string) {
  if (stage === "stage1") return "E1";
  if (stage === "stage2") return "E2";
  if (stage === "stage3") return "E3";
  if (stage === "stage3b") return "E3-B";
  if (stage === "stage3c") return "E3-C";
  return stage || "Etapa";
}

function extractStageResultTableRows(result: StageResult | null | undefined, stageNum?: 1 | 2 | 3): Record<string, unknown>[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const items = result.items;
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const itemRows = items.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === "object" && !Array.isArray(row)
  );

  if (stageNum === 3) {
    return extractStage3VerificationRows(itemRows);
  }

  return itemRows;
}

function extractStage3VerificationRows(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  items.forEach((item, index) => {
    const itemId = textValue(item["No. item"]) || textValue(item["Consecutivo interno"]) || textValue(item.item) || String(index + 1);
    const itemName = getFirstItemText(item, ["Nombre o descripci\u00f3n", "Nombre o descripcion", "Nombre o descripci?n", "name", "nombre"]);
    const itemDescription = getFirstItemText(item, ["Detalles o ficha t\u00e9cnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "description", "descripcion"]);
    const unit = getFirstItemText(item, ["Und de medida", "unit", "unidad"]);
    const quantity = getFirstItemText(item, ["Cant", "quantity", "cantidad"]);
    const ceiling = getFirstItemText(item, ["Precio techo encontrado", "ceiling_unit_price", "precio_techo"]);
    const quotes = Array.isArray(item["Cotizaciones encontradas"])
      ? item["Cotizaciones encontradas"].filter(isRecord)
      : [];

    if (!quotes.length) {
      rows.push({
        "No. item": itemId,
        "Nombre o descripci\u00f3n": itemName,
        "Fuente #": "Sin fuente",
        "Proveedor": "",
        "Producto encontrado": "",
        "Precio fuente": "",
        "Moneda": "",
        "Link fuente": "",
        "Soporte / observaci\u00f3n": getStage3NoSourceReason(item),
        "Estado fuente": "sin_datos",
        "Precio techo": ceiling,
        "Und": unit,
        "Cant": quantity,
        "Ficha t\u00e9cnica": itemDescription
      });
      return;
    }

    quotes.forEach((quote, quoteIndex) => {
      const source = getRecord(quote.fuente);
      const product = getRecord(quote.producto);
      const price = getRecord(quote.precio);
      const defense = getRecord(quote.defensa);
      const sourceUrl = textValue(source.url) || textValue(defense.trazabilidad_fuente);
      const support = [
        textValue(quote.evidencia_corta),
        textValue(defense.evidencia_precio),
        textValue(defense.justificacion),
        textValue(quote.observacion_tsv)
      ].filter(Boolean).join(" | ");

      rows.push({
        "No. item": itemId,
        "Nombre o descripci\u00f3n": itemName,
        "Fuente #": textValue(quote.numero) || String(quoteIndex + 1),
        "Proveedor": textValue(source.nombre) || "Fuente sin nombre",
        "Producto encontrado": textValue(product.titulo),
        "Precio fuente": textValue(price.texto_original) || textValue(price.valor),
        "Moneda": textValue(price.moneda),
        "Link fuente": sourceUrl,
        "Soporte / observaci\u00f3n": support,
        "Estado fuente": textValue(defense.estado_fuente) || textValue(defense.coincidencia_tecnica) || "pendiente_revision",
        "Precio techo": ceiling,
        "Und": unit,
        "Cant": quantity,
        "Ficha t\u00e9cnica": itemDescription
      });
    });
  });

  return rows;
}

function getFirstItemText(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getLooseItemValue(item, key);
    if (hasValue(value)) return textValue(value) || formatScalarForUi(value, { numberFormat: "es-CO" }).toString();
  }
  const original = isRecord(item["Datos originales"]) ? item["Datos originales"] : getRecord(item["datos_originales"]);
  for (const key of keys) {
    const value = getLooseItemValue(original, key);
    if (hasValue(value)) return textValue(value) || formatScalarForUi(value, { numberFormat: "es-CO" }).toString();
  }
  return "";
}

function getLooseItemValue(item: Record<string, unknown>, targetKey: string): unknown {
  if (Object.prototype.hasOwnProperty.call(item, targetKey)) return item[targetKey];
  const wanted = normalizeStageColumnKey(targetKey);
  for (const [key, value] of Object.entries(item)) {
    if (normalizeStageColumnKey(key) === wanted) return value;
  }
  return undefined;
}

function normalizeStageColumnKey(value: string) {
  return value
    .replace(/\u00c3\u0192\u00c2\u00a1/g, "a")
    .replace(/\u00c3\u0192\u00c2\u00a9/g, "e")
    .replace(/\u00c3\u0192\u00c2\u00ad/g, "i")
    .replace(/\u00c3\u0192\u00c2\u00b3/g, "o")
    .replace(/\u00c3\u0192\u00c2\u00ba/g, "u")
    .replace(/\u00c3\u0192\u00c2\u00b1/g, "n")
    .replace(/\u00c3\u00a1/g, "a")
    .replace(/\u00c3\u00a9/g, "e")
    .replace(/\u00c3\u00ad/g, "i")
    .replace(/\u00c3\u00b3/g, "o")
    .replace(/\u00c3\u00ba/g, "u")
    .replace(/\u00c3\u00b1/g, "n")
    .replace(/\u00ef\u00bf\u00bd/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/descripci.n/g, "descripcion")
    .replace(/t.cnica/g, "tecnica")
    .replace(/cotizaci.n/g, "cotizacion")
    .replace(/b.squeda/g, "busqueda")
    .replace(/r.pida/g, "rapida")
    .trim();
}

function getStage3NoSourceReason(item: Record<string, unknown>) {
  const audit = getRecord(item["Auditoria de busqueda"]);
  const reason = textValue(audit.motivo_menos_de_3);
  if (reason) return reason;
  const status = getRecord(item["Estado de cotizacion"]);
  return textValue(status.decision_siguiente_paso) || textValue(status.resultado_busqueda) || "Sin fuentes defendibles reportadas.";
}

function extractStage3ItemSummaryRows(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map((item, index) => {
    const itemId = textValue(item["No. item"]) || textValue(item["Consecutivo interno"]) || textValue(item.item) || String(index + 1);
    const itemName = getFirstItemText(item, ["Nombre o descripción", "Nombre o descripcion", "Nombre o descripci?n", "name", "nombre"]);
    const itemDescription = getFirstItemText(item, ["Detalles o ficha técnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "description", "descripcion"]);
    const unit = getFirstItemText(item, ["Und de medida", "unit", "unidad"]);
    const quantity = getFirstItemText(item, ["Cant", "quantity", "cantidad"]);
    const ceiling = getFirstItemText(item, ["Precio techo encontrado", "ceiling_unit_price", "precio_techo"]);
    const status = getRecord(item["Estado de cotizacion"]);
    const quotes = Array.isArray(item["Cotizaciones encontradas"])
      ? item["Cotizaciones encontradas"].filter(isRecord)
      : [];

    const row: Record<string, unknown> = {
      "No. item": itemId,
      "Nombre o descripción": itemName,
      "Ficha técnica": itemDescription,
      "Und": unit,
      "Cant": quantity,
      "Precio techo": ceiling,
      "Calidad datos": textValue(status.calidad_datos) || "no_evaluable",
      "Estado": textValue(status.resultado_busqueda) || textValue(status.estado_pricing) || "pendiente_revision"
    };

    for (let i = 0; i < 3; i += 1) {
      const quote = quotes[i];
      const source = getRecord(quote?.fuente);
      const product = getRecord(quote?.producto);
      const price = getRecord(quote?.precio);
      const defense = getRecord(quote?.defensa);
      const sourceUrl = textValue(source.url) || textValue(defense.trazabilidad_fuente);
      const support = [
        textValue(quote?.evidencia_corta),
        textValue(defense.evidencia_precio),
        textValue(defense.justificacion),
        textValue(quote?.observacion_tsv)
      ].filter(Boolean).join(" | ");

      row[`Fuente ${i + 1}`] = textValue(source.nombre) || "";
      row[`Link fuente ${i + 1}`] = sourceUrl;
      row[`Precio fuente ${i + 1}`] = textValue(price.texto_original) || textValue(price.valor);
      row[`Producto fuente ${i + 1}`] = textValue(product.titulo);
      row[`Notas fuente ${i + 1}`] = support;
    }

    if (!quotes.length) {
      row["Notas fuente 1"] = getStage3NoSourceReason(item);
    }

    return row;
  });
}

/** Barra de Excel bajo las pestañas (fuera del scroll del panel) para que siempre sea visible. */
function StageExportBanner({
  stageNum,
  response
}: {
  stageNum: 1 | 2 | 3;
  response: ApiResponse | null;
}) {
  const exportTableRows = useMemo(
    () => extractStageResultTableRows(response?.result ?? undefined, stageNum),
    [response?.result, stageNum]
  );
  const hasResult = response?.result != null;

  if (!response) {
    return null;
  }

  return (
    <div className="stageResultsExportBanner" role="region" aria-label={`Exportar etapa ${stageNum} a Excel`}>
      <div className="stageResultsExportBannerLabel">Exportar tabla · Etapa {stageNum}</div>
      <div className="stageTabExportToolbar stageTabExportToolbarBanner">
        <button
          type="button"
          className="stageTabExportExcelBtn"
          disabled={exportTableRows.length === 0}
          title={
            exportTableRows.length === 0
              ? "No hay filas en la tabla para exportar. Si ves datos en JSON crudo, revisa la respuesta de la etapa."
              : "Descargar la tabla como Excel (.xlsx): columnas claras para revisión o para completar la etapa con otro LLM."
          }
          onClick={() => {
            if (!exportTableRows.length || !response.result) {
              return;
            }
            downloadStageItemsExcel({
              filenamePrefix: `etapa-${stageNum}-resultados`,
              mainSheetName: `Etapa ${stageNum}`,
              items: exportTableRows,
              metadata: response.result.metadata,
              controlCalidad: response.result.control_calidad
            });
          }}
        >
          Descargar Excel (.xlsx)
        </button>
        <span className="muted stageTabExportHint">
          {exportTableRows.length === 0
            ? hasResult
              ? "Sin filas exportables en la lista de ítems (tabla vacía o datos solo en JSON crudo)."
              : "Cuando existan filas en la tabla, aquí podrás bajar el Excel."
            : `${exportTableRows.length} fila(s) · misma vista que la tabla siguiente.`}
        </span>
      </div>
    </div>
  );
}

function StageResultsWorkspace({
  activeTab,
  onTabChange,
  stage1,
  stage2,
  stage3,
  stage3b,
  stage3c,
  stage2Experiment,
  stage3GoogleExperiment,
  stage3OpenAiExperiment,
  onSetStage2Experiment,
  onSetStage3GoogleExperiment,
  onSetStage3OpenAiExperiment,
  onSetStage3B,
  onRunStage3B,
  onSetStage3C,
  onRunStage3C,
  stage3RunMode,
  onSetStage3RunMode,
  stage3FinancialSource,
  onSetStage3FinancialSource,
  reviewProvider,
  reviewModel,
  copRate,
  historicalRun,
  file,
  loading,
  stageProviders,
  stageModels,
  geminiModel,
  deepseekModel,
  displayNumberFormat,
  isAdminMode,
  usageAttempts,
  onRunSingleStage,
  enableStage3ReviewSandbox,
  onApplyRepairedStage3,
  onApplyCompletedStage3,
  openAiService,
  hasGeminiApiKey,
  ingest
}: {
  activeTab: ResultsTabId;
  onTabChange: (tab: ResultsTabId) => void;
  stage1: ApiResponse | null;
  stage2: ApiResponse | null;
  stage3: ApiResponse | null;
  stage3b: ApiResponse | null;
  stage3c: ApiResponse | null;
  stage2Experiment: ApiResponse | null;
  stage3GoogleExperiment: ApiResponse | null;
  stage3OpenAiExperiment: ApiResponse | null;
  onSetStage2Experiment: Dispatch<SetStateAction<ApiResponse | null>>;
  onSetStage3GoogleExperiment: Dispatch<SetStateAction<ApiResponse | null>>;
  onSetStage3OpenAiExperiment: Dispatch<SetStateAction<ApiResponse | null>>;
  onSetStage3B: Dispatch<SetStateAction<ApiResponse | null>>;
  onRunStage3B: (options: Stage3BRunOptions) => Promise<ApiResponse | void> | ApiResponse | void;
  onSetStage3C: Dispatch<SetStateAction<ApiResponse | null>>;
  onRunStage3C: (options: Stage3BRunOptions) => Promise<ApiResponse | void> | ApiResponse | void;
  stage3RunMode: Stage3RunMode;
  onSetStage3RunMode: Dispatch<SetStateAction<Stage3RunMode>>;
  stage3FinancialSource: Stage3FinancialSource;
  onSetStage3FinancialSource: Dispatch<SetStateAction<Stage3FinancialSource>>;
  reviewProvider: "" | AiProvider;
  reviewModel: string;
  copRate: number;
  historicalRun: boolean;
  file: File | null;
  loading: LoadingStage;
  stageProviders: StageProviders;
  stageModels: StageModels;
  geminiModel: string;
  deepseekModel: string;
  displayNumberFormat: NumberDisplayFormat;
  isAdminMode: boolean;
  usageAttempts: HistoricalUsageAttempt[];
  onRunSingleStage: (stageNum: 1 | 2 | 3, provider: AiProvider | "", model: string) => void;
  enableStage3ReviewSandbox: boolean;
  onApplyRepairedStage3: (result: Record<string, unknown>) => void;
  onApplyCompletedStage3: (response: ApiResponse) => void;
  openAiService?: ProviderServiceStatus | null;
  hasGeminiApiKey?: boolean;
  ingest: {
    stage3Done: boolean;
    ingest: FinancialIngestPayload | null;
    loading: boolean;
    previewError: string | null;
    financialBusy: boolean;
    financialMessage: string | null;
    onSend: () => void;
    canSend: boolean;
    displayNumberFormat: NumberDisplayFormat;
    sourceLabel?: string;
    financialSource: Stage3FinancialSource;
    onSetFinancialSource: Dispatch<SetStateAction<Stage3FinancialSource>>;
    sourceOptions: Array<{ id: Stage3FinancialSource; label: string; hint: string; available: boolean }>;
  };
}) {
  const tabs: Array<{ id: ResultsTabId; label: string; hint: string }> = [
    { id: "stage1", label: "Etapa 1", hint: "Extracción" },
    { id: "stage2", label: "Etapa 2", hint: "Técnico" },
    { id: "stage3", label: "Etapa 3", hint: "Cotización" },
    { id: "stage3b", label: "Etapa 3-B", hint: "Asistida" },
    { id: "stage3c", label: "Etapa 3-C", hint: "Paralela" },
    { id: "stage4", label: "Etapa 4", hint: "Ingesta financiera" }
  ];
  const canRunTab1 = Boolean(file);
  const canRunTab2 = Boolean(stage1?.result);
  const canRunTab3 = Boolean(stage2?.result) && stageProviders.stage3 !== "deepseek";
  const isUnifiedStage3View = !isAdminMode;
  const normalizedActiveTab: ResultsTabId =
    isUnifiedStage3View && (activeTab === "stage3b" || activeTab === "stage3c") ? "stage3" : activeTab;
  const stage3UnifiedHint =
    stage3RunMode === "stage3c_parallel"
      ? "Paralela"
      : stage3RunMode === "stage3b_local"
        ? "Proveedor Codex"
        : stage3RunMode === "stage3b_manual"
          ? "Manual"
          : stage3RunMode === "stage3b_api"
            ? "API asistida"
            : "Cotizacion";
  const visibleTabs = isUnifiedStage3View
    ? [
        { id: "stage1" as ResultsTabId, label: "Etapa 1", hint: "Extraccion" },
        { id: "stage2" as ResultsTabId, label: "Etapa 2", hint: "Tecnico" },
        { id: "stage3" as ResultsTabId, label: "Etapa 3", hint: stage3UnifiedHint },
        { id: "stage4" as ResultsTabId, label: "Etapa 4", hint: "Ingesta financiera" }
      ]
    : tabs;
  const showClassicStage3 =
    (!isUnifiedStage3View && activeTab === "stage3") ||
    (isUnifiedStage3View && normalizedActiveTab === "stage3" && stage3RunMode === "classic");
  const showStage3B =
    (!isUnifiedStage3View && activeTab === "stage3b") ||
    (isUnifiedStage3View && normalizedActiveTab === "stage3" && stage3RunMode !== "classic" && stage3RunMode !== "stage3c_parallel");
  const showStage3C =
    (!isUnifiedStage3View && activeTab === "stage3c") ||
    (isUnifiedStage3View && normalizedActiveTab === "stage3" && stage3RunMode === "stage3c_parallel");

  return (
    <div className="stageResultsBleed">
      <section className={`panel stageResultsPanel${isUnifiedStage3View ? " stageResultsPanelStandard" : ""}`}>
        <div className="sectionHeader stageResultsPanelHeader">
          <div className="stageResultsPanelTitleRow">
            <h2 className="stageResultsPanelTitle">Resultados por etapa</h2>
            <InfoTip
              label="Tablas"
              text="Una etapa por pestaña. En cada pestaña puedes procesar o reprocesar con proveedor y modelo opcionales. El scroll largo va dentro de la tabla."
            />
          </div>
        </div>

        <RunSummary stage1={stage1} stage2={stage2} stage3={stage3} stage3b={stage3b} stage3c={stage3c} usageAttempts={usageAttempts} copRate={copRate} />

        <div className={`stageTabBar${isUnifiedStage3View ? " stageTabBarStandardHidden" : ""}`} role="tablist" aria-label="Seleccionar etapa de resultados">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={normalizedActiveTab === tab.id}
              className={`stageTab ${normalizedActiveTab === tab.id ? "stageTabActive" : ""}`}
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
              stageNum={1}
              response={stage1}
              historicalRun={historicalRun}
              file={file}
              loading={loading}
              stageProviders={stageProviders}
              stageModels={stageModels}
              geminiModel={geminiModel}
              deepseekModel={deepseekModel}
              displayNumberFormat={displayNumberFormat}
              isAdminMode={isAdminMode}
              copRate={copRate}
              canRun={canRunTab1}
              onRun={onRunSingleStage}
              stage1Response={stage1}
              stage2Response={stage2}
              stage2Experiment={stage2Experiment}
              stage3GoogleExperiment={stage3GoogleExperiment}
              stage3OpenAiExperiment={stage3OpenAiExperiment}
              onSetStage2Experiment={onSetStage2Experiment}
              onSetStage3GoogleExperiment={onSetStage3GoogleExperiment}
              onSetStage3OpenAiExperiment={onSetStage3OpenAiExperiment}
              enableReviewSandbox={enableStage3ReviewSandbox}
              onApplyRepairedStage3={onApplyRepairedStage3}
              onApplyCompletedStage3={onApplyCompletedStage3}
              openAiService={openAiService}
            />
          ) : null}
          {activeTab === "stage2" ? (
            <StageTabPanel
              stageNum={2}
              response={stage2}
              historicalRun={historicalRun}
              file={file}
              loading={loading}
              stageProviders={stageProviders}
              stageModels={stageModels}
              geminiModel={geminiModel}
              deepseekModel={deepseekModel}
              displayNumberFormat={displayNumberFormat}
              isAdminMode={isAdminMode}
              copRate={copRate}
              canRun={canRunTab2}
              onRun={onRunSingleStage}
              stage1Response={stage1}
              stage2Response={stage2}
              stage2Experiment={stage2Experiment}
              stage3GoogleExperiment={stage3GoogleExperiment}
              stage3OpenAiExperiment={stage3OpenAiExperiment}
              onSetStage2Experiment={onSetStage2Experiment}
              onSetStage3GoogleExperiment={onSetStage3GoogleExperiment}
              onSetStage3OpenAiExperiment={onSetStage3OpenAiExperiment}
              enableReviewSandbox={enableStage3ReviewSandbox}
              onApplyRepairedStage3={onApplyRepairedStage3}
              onApplyCompletedStage3={onApplyCompletedStage3}
              openAiService={openAiService}
            />
          ) : null}
          {showClassicStage3 ? (
            <StageTabPanel
              stageNum={3}
              response={stage3}
              historicalRun={historicalRun}
              file={file}
              loading={loading}
              stageProviders={stageProviders}
              stageModels={stageModels}
              geminiModel={geminiModel}
              deepseekModel={deepseekModel}
              displayNumberFormat={displayNumberFormat}
              isAdminMode={isAdminMode}
              copRate={copRate}
              canRun={canRunTab3}
              onRun={onRunSingleStage}
              stage1Response={stage1}
              stage2Response={stage2}
              stage2Experiment={stage2Experiment}
              stage3GoogleExperiment={stage3GoogleExperiment}
              stage3OpenAiExperiment={stage3OpenAiExperiment}
              onSetStage2Experiment={onSetStage2Experiment}
              onSetStage3GoogleExperiment={onSetStage3GoogleExperiment}
              onSetStage3OpenAiExperiment={onSetStage3OpenAiExperiment}
              enableReviewSandbox={enableStage3ReviewSandbox}
              onApplyRepairedStage3={onApplyRepairedStage3}
              onApplyCompletedStage3={onApplyCompletedStage3}
              openAiService={openAiService}
            />
          ) : null}
          {showStage3B ? (
            <Stage3BAssistedPanel
              response={stage3b}
              stage2Response={stage2}
              stage2Experiment={stage2Experiment}
              loading={loading}
              openAiService={openAiService}
              hasGeminiApiKey={hasGeminiApiKey}
              geminiModel={geminiModel}
              reviewProvider={reviewProvider}
              reviewModel={reviewModel}
              displayNumberFormat={displayNumberFormat}
              copRate={copRate}
              isActiveForFinancial={stage3FinancialSource === "stage3b" && Boolean(stage3b?.result)}
              onUseForFinancial={() => onSetStage3FinancialSource("stage3b")}
              onRun={onRunStage3B}
              onSetStage3B={onSetStage3B}
              stage3RunMode={stage3RunMode}
              onSetStage3RunMode={onSetStage3RunMode}
              isAdminMode={isAdminMode}
            />
          ) : null}
          {showStage3C ? (
            <Stage3CParallelPanel
              response={stage3c}
              stage2Response={stage2}
              loading={loading}
              reviewProvider={reviewProvider}
              reviewModel={reviewModel}
              displayNumberFormat={displayNumberFormat}
              copRate={copRate}
              isActiveForFinancial={stage3FinancialSource === "stage3c" && Boolean(stage3c?.result)}
              onUseForFinancial={() => onSetStage3FinancialSource("stage3c")}
              onRun={onRunStage3C}
              onSetStage3C={onSetStage3C}
              isAdminMode={isAdminMode}
            />
          ) : null}
          {normalizedActiveTab === "stage4" ? <IngestStageSection {...ingest} embedded isAdminMode={isAdminMode} /> : null}
        </div>
      </section>
    </div>
  );
}

function buildStage3BManualPackage({
  stage2Result,
  stage3BResponse,
  promptInstruction,
  limit,
  maxAttempts,
  runId
}: {
  stage2Result: StageResult | null;
  stage3BResponse: ApiResponse | null;
  promptInstruction: string;
  limit: number;
  maxAttempts: number;
  runId?: string;
}) {
  const sourceItems = Array.isArray(stage2Result?.items) ? stage2Result.items.filter(isRecord) : [];
  const acceptedKeys = getStage3BAcceptedItemKeys(stage3BResponse);
  const retryNotes = buildStage3BManualRetryNotes(stage3BResponse);
  const attempts = getStage3BAttemptsFromResponse(stage3BResponse);
  const attemptsByKey = new Map<string, number>();
  attempts.forEach((attempt) => {
    const keys = Array.isArray(attempt.requestedItemKeys)
      ? attempt.requestedItemKeys.map((key) => String(key || "").trim()).filter(Boolean)
      : [];
    keys.forEach((key) => attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1));
  });
  const finalItems = Array.isArray(stage3BResponse?.result?.items) ? stage3BResponse.result.items.filter(isRecord) : [];
  finalItems.forEach((item, index) => {
    const key = getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1);
    const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isRecord) : [];
    const state = isRecord(item["Estado de cotizacion"]) ? item["Estado de cotizacion"] : getRecord(item["Estado de cotización"]);
    if (quotes.length || state.etapa3b_aceptado === true) acceptedKeys.add(key);
  });

  const entries = sourceItems.map((item, index) => {
    const key = getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1);
    return { item, key, attempts: attemptsByKey.get(key) ?? 0 };
  });
  const pending = entries.filter(({ key, attempts }) => !acceptedKeys.has(key) && attempts < maxAttempts);
  const retryable = pending.filter(({ attempts }) => attempts > 0);
  const neverSent = pending.filter(({ attempts }) => attempts === 0);
  const exhausted = entries.filter(({ key, attempts }) => !acceptedKeys.has(key) && attempts >= maxAttempts);
  const capacity = limit > 0 ? limit : pending.length;
  const selected = [...retryable, ...neverSent].slice(0, capacity);
  const headers = ["Item", "Nombre", "Descripcion", "Und de medida", "Cant", "Precio techo unitario", "Notas del item"];
  const rows = selected.map(({ item, key, attempts }) => {
    const name = getFirstItemText(item, ["Nombre o descripción", "Nombre o descripcion", "Nombre o descripci?n", "Nombre", "name", "nombre"]);
    const description = getFirstItemText(item, ["Detalles o ficha técnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "Ficha técnica", "Ficha tecnica", "description", "descripcion"]);
    const unit = getFirstItemText(item, ["Und de medida", "Und", "unit", "unidad"]);
    const quantity = getFirstItemText(item, ["Cant", "quantity", "cantidad"]);
    const ceiling = getFirstItemText(item, ["Precio techo encontrado", "Precio techo unitario", "Precio techo", "ceiling_unit_price", "precio_techo"]);
    const notes = [
      getFirstItemText(item, ["Tipo de ficha", "tipo ficha", "tipo_ficha"]),
      getFirstItemText(item, ["Nota tecnica para cotizacion", "nota tecnica", "observacion tecnica", "resumen comprable"]),
      getFirstItemText(item, ["Guia para cotizacion", "guia cotizacion", "busqueda sugerida", "pauta busqueda etapa3"]),
      attempts > 0 ? `Reintento ${attempts + 1} de ${maxAttempts}` : "",
      retryNotes.get(key)
    ].filter(Boolean).join(" | ");
    return [key, name, description, unit, quantity, ceiling, notes].map(escapeMarkdownTableCell);
  });
  const table = [
    `| ${headers.join(" |")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
  const outputColumns = "| Item | Nombre | Descripcion | Und de medida | Cant | Precio techo unitario | Notas del item | Proveedor 1 | Precio proveedor 1 | Moneda proveedor 1 | URL proveedor 1 | Notas proveedor 1 | TRM proveedor 1 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const promptBase = normalizeStage3BPromptForExternalAgent(promptInstruction);
  const promptText = selected.length
    ? `${promptBase}\n\n## Salida requerida\nEntrega solo una tabla Markdown con estas columnas exactas:\n\n${outputColumns}`
    : promptBase;
  const tableText = selected.length ? table : "";
  const localTaskId = `stage3b_${escapeLocalTaskId(runId || "sin_run")}_paquete_${attempts.length + 1}`;
  const localTaskText = selected.length
    ? [
        "---",
        `id: ${localTaskId}`,
        "modo: stage3b_manual_local",
        `runId: ${runId || ""}`,
        `max_intentos: ${maxAttempts}`,
        `items_en_paquete: ${selected.length}`,
        "---",
        table
      ].join("\n")
    : "";
  const text = selected.length
    ? `${promptText}\n\n## Datos a procesar\n${table}`
    : "";
  return {
    text,
    promptText,
    outputColumns,
    tableText,
    localTaskText,
    itemKeys: selected.map((entry) => entry.key),
    totalPending: pending.length,
    retryableCount: retryable.length,
    neverSentCount: neverSent.length,
    exhaustedCount: exhausted.length,
    acceptedCount: acceptedKeys.size,
    packageLimit: capacity,
    maxAttempts
  };
}

function normalizeStage3BPromptForExternalAgent(promptInstruction: string) {
  const repaired = repairStage3BPromptText(promptInstruction || "").trim();
  const systemContentMatch = repaired.match(/system_instruction\s*:\s*\{[\s\S]*?content\s*:\s*`([\s\S]*?)`\s*[,}]/);
  const looksLikePayload = /\bconst\s+payload\b|generation_config|tool_choice|response_mime_type|system_instruction\s*:/.test(repaired);
  const base = (looksLikePayload && systemContentMatch?.[1] ? systemContentMatch[1] : repaired).trim();
  const cleanBase = base
    .replace(/^\s*```(?:json|js|javascript)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const normalizedBase = cleanBase || [
    "Actua como un Auditor de Inteligencia de Mercado de alta precision.",
    "Tu tarea es encontrar una fuente comercial real por item, con precio y URL verificables."
  ].join("\n");
  const guard = [
    "",
    "## Instruccion operativa local",
    "- Responde como auditor de precios, no como programador.",
    "- No devuelvas JSON, codigo, payloads ni explicaciones fuera de la tabla.",
    "- Usa busqueda web real para sustentar cada fuente.",
    "- Si el producto real supera el precio techo, reporta el precio real y anotalo; el techo no invalida la fuente.",
    "- Si una URL directa falla pero encontraste una fuente razonable, conserva proveedor/precio y explica la cautela en notas.",
    "- Las notas deben ser breves pero utiles: indica coincidencia, diferencia critica, presentacion/unidad y si el precio/URL requiere cautela.",
    "- Si no hay fuente defendible, deja vacios proveedor, precio, moneda, URL y TRM."
  ].join("\n");
  return `${normalizedBase}${guard}`.trim();
}

function repairStage3BPromptText(value: string) {
  const replacements: Array<[string, string]> = [
    ["Ã¡", "á"], ["Ã©", "é"], ["Ã­", "í"], ["Ã³", "ó"], ["Ãº", "ú"],
    ["Ã", "Á"], ["Ã‰", "É"], ["Ã", "Í"], ["Ã“", "Ó"], ["Ãš", "Ú"],
    ["Ã±", "ñ"], ["Ã‘", "Ñ"], ["Â¿", "¿"], ["Â¡", "¡"], ["Â·", "·"],
    ["â€œ", "\""], ["â€", "\""], ["â€˜", "'"], ["â€™", "'"], ["â€“", "-"], ["â€”", "-"],
    ["Â", ""]
  ];
  return replacements.reduce((text, [from, to]) => text.split(from).join(to), value);
}

function escapeLocalTaskId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "sin_run";
}

function getLocalProviderCurrentJobId(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return "";
  const active = textValue(snapshot.activeJobId);
  if (active) return active;
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs.filter(isRecord) : [];
  return jobs.length ? textValue(jobs[0].jobId) : "";
}

function getStage3BAcceptedItemKeys(stage3BResponse: ApiResponse | null) {
  const acceptedKeys = new Set<string>();
  const finalItems = Array.isArray(stage3BResponse?.result?.items) ? stage3BResponse.result.items.filter(isRecord) : [];
  finalItems.forEach((item, index) => {
    const key = getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1);
    const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isRecord) : [];
    const state = isRecord(item["Estado de cotizacion"]) ? item["Estado de cotizacion"] : getRecord(item["Estado de cotizaciÃ³n"]);
    if (quotes.length || state.etapa3b_aceptado === true) acceptedKeys.add(key);
  });
  return acceptedKeys;
}

function getStage3BAttemptsFromResponse(response: ApiResponse | null) {
  const persistedAttempts: Record<string, unknown>[] = isRecord(response?.result) && Array.isArray(response.result.stage3b_attempts)
    ? response.result.stage3b_attempts.filter(isRecord)
    : [];
  return Array.isArray(response?.details?.stage3bAttempts)
    ? response.details.stage3bAttempts.filter(isRecord)
    : persistedAttempts;
}

function getStage3BHighConfidenceAcceptedKeys(stage3BResponse: ApiResponse | null, options?: { includeConfirmedCaution?: boolean }) {
  const attempts = getStage3BAttemptsFromResponse(stage3BResponse);
  const latestSupervised = [...attempts].reverse().find((attempt) => textValue(attempt.status) === "supervised");
  if (!latestSupervised) return [];
  const acceptedKeys = getStage3BAcceptedItemKeys(stage3BResponse);
  const rowsByKey = new Map(extractStage3BCandidateRows(latestSupervised).map((row) => [row.itemKey, row]));
  const supervisor = getRecord(latestSupervised.supervisor);
  const decisions = Array.isArray(supervisor.decisions) ? supervisor.decisions.filter(isRecord) : [];
  const keys = decisions
    .filter((decision) => {
      const key = textValue(decision.itemKey);
      const row = rowsByKey.get(key);
      const sourceStates = Array.isArray(decision.sourceStates)
        ? decision.sourceStates.map((state) => normalizeLabel(textValue(state))).filter(Boolean)
        : [];
      const confidence = normalizeLabel(textValue(decision.confidence));
      const status = normalizeLabel(textValue(decision.status));
      const isHighConfidence = confidence.includes("alta");
      const isConfirmedCaution =
        options?.includeConfirmedCaution === true
        && confidence.includes("media")
        && (status.includes("sirve_con_cautela") || status.includes("sirve con cautela"))
        && sourceStates.some((state) => state.includes("precio_confirmado_con_cautela") || state.includes("precio confirmado con cautela"))
        && !sourceStates.some((state) => state.includes("unidad_diferente") || state.includes("unidad diferente"));
      return Boolean(
        key
        && !acceptedKeys.has(key)
        && decision.accepted === true
        && (isHighConfidence || isConfirmedCaution)
        && row?.hasData
      );
    })
    .map((decision) => textValue(decision.itemKey))
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function buildStage3BManualRetryNotes(stage3BResponse: ApiResponse | null) {
  const notes = new Map<string, string>();
  const attempts = getStage3BAttemptsFromResponse(stage3BResponse);
  for (const attempt of attempts) {
    const pricingResult = getRecord(attempt.pricingResult);
    const items = Array.isArray(pricingResult.items) ? pricingResult.items.filter(isRecord) : [];
    const supervisor = getRecord(attempt.supervisor);
    const decisions = Array.isArray(supervisor.decisions) ? supervisor.decisions.filter(isRecord) : [];
    const decisionByKey = new Map(decisions.map((decision) => [textValue(decision.itemKey), decision]));
    const requestedKeys = Array.isArray(attempt.requestedItemKeys) ? attempt.requestedItemKeys.map((key) => String(key || "").trim()).filter(Boolean) : [];

    for (const requestedKey of requestedKeys) {
      if (!notes.has(requestedKey)) notes.set(requestedKey, "Reintento: no quedo aprobado por el usuario.");
    }

    items.forEach((item, index) => {
      const key = getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1);
      const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isRecord) : [];
      const hasCandidate = quotes.some((quote) => {
        const source = getRecord(quote.fuente);
        const price = getRecord(quote.precio);
        return Boolean(cleanStage3BSourceField(source.nombre) || cleanStage3BSourceField(source.url) || cleanStage3BSourceField(price.texto_original) || cleanStage3BSourceField(price.valor));
      });
      const decision = decisionByKey.get(key);
      const status = textValue(decision?.status);
      const confidence = textValue(decision?.confidence);
      const comment = compactStage3BRetryNote(textValue(decision?.comment));
      if (!hasCandidate) {
        notes.set(key, "Reintento: no cotizo fuente usable; buscar otra fuente con precio verificable.");
      } else if (decision?.accepted === true) {
        notes.set(key, "Reintento: hubo fuente sugerida, pero no fue aprobada por el usuario. Revisar soporte y cotizar mejor.");
      } else if (normalizeLabel(confidence).includes("baja") || normalizeLabel(status).includes("sin_fuente") || normalizeLabel(status).includes("no_usable")) {
        notes.set(key, `Reintento: baja confianza. ${comment || "La fuente anterior no tuvo soporte suficiente."}`);
      } else if (comment) {
        notes.set(key, `Reintento: ${comment}`);
      } else {
        notes.set(key, "Reintento: cotizacion previa no fue aprobada; entregar fuente mas verificable.");
      }
    });
  }
  return notes;
}

function compactStage3BRetryNote(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function getUsableQuotePrompt(savedOrDraft: string, fallback: string) {
  const text = savedOrDraft.trim();
  const fallbackText = fallback.trim();
  if (!text) return fallbackText;
  const normalized = text.slice(0, 400).toLowerCase();
  const looksLikeApiPayload =
    normalized.startsWith("const payload") ||
    normalized.includes("generation_config") ||
    normalized.includes("[pega_aqu");
  return looksLikeApiPayload && fallbackText ? fallbackText : text;
}

function escapeMarkdownTableCell(value: unknown) {
  return textValue(value).replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

function Stage3BAssistedPanel({
  response,
  stage2Response,
  stage2Experiment,
  loading,
  openAiService,
  hasGeminiApiKey,
  geminiModel,
  reviewProvider,
  reviewModel,
  displayNumberFormat,
  copRate,
  isActiveForFinancial,
  onUseForFinancial,
  onRun,
  onSetStage3B,
  stage3RunMode,
  onSetStage3RunMode,
  isAdminMode
}: {
  response: ApiResponse | null;
  stage2Response: ApiResponse | null;
  stage2Experiment: ApiResponse | null;
  loading: LoadingStage;
  openAiService?: ProviderServiceStatus | null;
  hasGeminiApiKey?: boolean;
  geminiModel: string;
  reviewProvider: "" | AiProvider;
  reviewModel: string;
  displayNumberFormat: NumberDisplayFormat;
  copRate: number;
  isActiveForFinancial: boolean;
  onUseForFinancial: () => void;
  onRun: (options: Stage3BRunOptions) => Promise<ApiResponse | void> | ApiResponse | void;
  onSetStage3B: Dispatch<SetStateAction<ApiResponse | null>>;
  stage3RunMode: Stage3RunMode;
  onSetStage3RunMode: Dispatch<SetStateAction<Stage3RunMode>>;
  isAdminMode: boolean;
}) {
  const [source, setSource] = useState<"stable" | "experimental">("stable");
  const [provider, setProvider] = useState<"openai" | "google">("openai");
  const [model, setModel] = useState(openAiService?.model || "gpt-5.4-mini");
  const [reasoningEffort, setReasoningEffort] = useState(openAiService?.reasoningEffort || "medium");
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [batchSize, setBatchSize] = useState(20);
  const [searchContextSize, setSearchContextSize] = useState<"low" | "medium" | "high">("low");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptSaved, setPromptSaved] = useState("");
  const [promptDefault, setPromptDefault] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMessage, setPromptMessage] = useState("");
  const [manualBatchSize, setManualBatchSize] = useState(30);
  const [manualRawResponse, setManualRawResponse] = useState("");
  const [manualCopyMessage, setManualCopyMessage] = useState("");
  const [localProviderStatus, setLocalProviderStatus] = useState<"unknown" | "checking" | "connected" | "offline" | "running">("unknown");
  const [localProviderMessage, setLocalProviderMessage] = useState("");
  const [localProviderSnapshot, setLocalProviderSnapshot] = useState<Record<string, unknown> | null>(null);
  const [localProviderLog, setLocalProviderLog] = useState("");
  const [localWorkflow, setLocalWorkflow] = useState<Stage3BLocalWorkflowState>(INITIAL_STAGE3B_LOCAL_WORKFLOW);
  const [quoteProviderId, setQuoteProviderId] = useState<QuoteProviderId>(DEFAULT_QUOTE_PROVIDER_ID);
  const [recentlyApprovedStage3BKeys, setRecentlyApprovedStage3BKeys] = useState<Set<string>>(() => new Set());
  const recentlyApprovedStage3BTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadStage3BPrompt() {
      try {
        const res = await fetch("/api/stage3b/prompt", { cache: "no-store" });
        const data = await res.json() as { quoteInstructionPrompt?: string; defaultQuoteInstructionPrompt?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "No se pudo cargar el prompt 3-B.");
        const saved = typeof data.quoteInstructionPrompt === "string" ? data.quoteInstructionPrompt : "";
        const fallback = typeof data.defaultQuoteInstructionPrompt === "string" ? data.defaultQuoteInstructionPrompt : "";
        setPromptSaved(saved);
        setPromptDraft(getUsableQuotePrompt(saved, fallback));
        setPromptDefault(fallback);
      } catch (error) {
        if (!cancelled) setPromptMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void loadStage3BPrompt();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (recentlyApprovedStage3BTimerRef.current) clearTimeout(recentlyApprovedStage3BTimerRef.current);
    };
  }, []);

  function markStage3BRecentlyApproved(itemKeys: string[]) {
    if (!itemKeys.length) return;
    if (recentlyApprovedStage3BTimerRef.current) clearTimeout(recentlyApprovedStage3BTimerRef.current);
    setRecentlyApprovedStage3BKeys(new Set(itemKeys));
    recentlyApprovedStage3BTimerRef.current = setTimeout(() => {
      setRecentlyApprovedStage3BKeys(new Set());
      recentlyApprovedStage3BTimerRef.current = null;
    }, 2600);
  }

  useEffect(() => {
    if (provider === "google") {
      setModel(geminiModel || getFirstProviderModel("gemini"));
      return;
    }
    setModel(openAiService?.model || "gpt-5.4-mini");
  }, [provider, geminiModel, openAiService?.model]);

  const sourceResponse = source === "experimental" && stage2Experiment?.result ? stage2Experiment : stage2Response;
  const sourceLabel = source === "experimental" && stage2Experiment?.result ? "Etapa 2 experimental" : "Etapa 2 normal";
  const supervisorModel = reviewProvider && reviewModel ? `${reviewProvider}:${reviewModel}` : "deepseek:deepseek-v4-pro";
  const openAiModelOptions = openAiService?.modelOptions?.length
    ? openAiService.modelOptions
    : [
        { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
        { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" }
      ];
  const modelOptions = provider === "google" ? [] : openAiModelOptions;
  const missingProviderKey = provider === "openai" ? openAiService?.hasApiKey === false : hasGeminiApiKey === false;
  const canRun = Boolean(sourceResponse?.result) && loading !== "stage3" && loading !== "pipeline";
  const quality = response?.result?.control_calidad;
  const total = Number(quality?.total_items ?? response?.result?.items?.length ?? 0);
  const accepted = Number(quality?.sirve_directo ?? 0) + Number(quality?.sirve_con_cautela ?? 0);
  const pending = Number(quality?.pendiente_revision ?? Math.max(0, total - accepted));
  const persistedStage3BAttempts: Record<string, unknown>[] = isRecord(response?.result) && Array.isArray(response.result.stage3b_attempts)
    ? response.result.stage3b_attempts.filter(isRecord)
    : [];
  const stage3BAttempts = Array.isArray(response?.details?.stage3bAttempts)
    ? response.details.stage3bAttempts.filter(isRecord)
    : persistedStage3BAttempts;
  const latestAttempt = stage3BAttempts[stage3BAttempts.length - 1];
  const hasUnsupervisedAttempt = Boolean(latestAttempt && textValue(latestAttempt.status) === "quoted");
  const canQuote = canRun && !hasUnsupervisedAttempt;
  const canSupervise = canRun && hasUnsupervisedAttempt;
  const activePromptInstruction = getUsableQuotePrompt(promptDraft.trim() || promptSaved, promptDefault);
  const manualPackage = buildStage3BManualPackage({
    stage2Result: sourceResponse?.result ?? null,
    stage3BResponse: response,
    promptInstruction: activePromptInstruction,
    limit: manualBatchSize,
    maxAttempts,
    runId: sourceResponse?.runId || stage2Response?.runId
  });
  const isManualMode = stage3RunMode === "stage3b_manual";
  const isLocalMode = stage3RunMode === "stage3b_local";
  const isManualLikeMode = isManualMode || isLocalMode;
  const quoteProvider = getQuoteProviderDefinition(quoteProviderId);

  useEffect(() => {
    if (!isLocalMode) return;
    let cancelled = false;
    async function checkLocalProvider() {
      setLocalProviderStatus("checking");
      setLocalProviderMessage("Consultando proveedor local...");
      try {
        const res = await fetch(getQuoteProviderUrl(quoteProviderId, "health"), { cache: "no-store" });
        const data = await res.json() as { ok?: boolean; engine?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setLocalProviderStatus("connected");
        setLocalProviderMessage(`${quoteProvider.shortLabel} conectado${data.engine ? ` - ${data.engine}` : ""}.`);
      } catch (error) {
        if (cancelled) return;
        setLocalProviderStatus("offline");
        setLocalProviderMessage(`${quoteProvider.shortLabel} no conectado. Revisa que el worker del proveedor este activo.`);
      }
    }
    void checkLocalProvider();
    return () => { cancelled = true; };
  }, [isLocalMode, quoteProviderId, quoteProvider.shortLabel]);

  useEffect(() => {
    if (!isLocalMode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function pollLocalProviderStatus() {
      try {
        const res = await fetch(getQuoteProviderUrl(quoteProviderId, "status"), { cache: "no-store" });
        const data = await res.json() as Record<string, unknown> & { ok?: boolean; status?: string; message?: string };
        if (cancelled) return;
        if (!res.ok || !data.ok) throw new Error(textValue(data.error) || `HTTP ${res.status}`);
        setLocalProviderSnapshot(data);
        const status = textValue(data.status);
        if (status === "processing") setLocalProviderStatus("running");
        else if (status === "failed") setLocalProviderStatus("offline");
        else if (status === "completed" || status === "idle") setLocalProviderStatus("connected");
        if (data.message) setLocalProviderMessage(textValue(data.message));
      } catch {
        if (cancelled) return;
        setLocalProviderStatus("offline");
        setLocalProviderSnapshot(null);
      }
    }
    void pollLocalProviderStatus();
    timer = setInterval(() => { void pollLocalProviderStatus(); }, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [isLocalMode, quoteProviderId]);

  useEffect(() => {
    if (!localWorkflow.active || !localWorkflow.startedAt) return;
    const timer = window.setInterval(() => {
      setLocalWorkflow((current) => current.active && current.startedAt
        ? { ...current, elapsedMs: Date.now() - current.startedAt }
        : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [localWorkflow.active, localWorkflow.startedAt]);

  function updateLocalWorkflow(partial: Partial<Stage3BLocalWorkflowState>) {
    setLocalWorkflow((current) => {
      const startedAt = partial.startedAt ?? current.startedAt;
      const active = partial.active ?? current.active;
      return {
        ...current,
        ...partial,
        elapsedMs: typeof partial.elapsedMs === "number"
          ? partial.elapsedMs
          : active && startedAt
            ? Date.now() - startedAt
            : current.elapsedMs
      };
    });
  }

  async function notifyLocalWorkflow(title: string, body: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(title, { body });
      }
    } catch {
      // Browser notifications are best-effort; the in-page status remains the source of truth.
    }
  }

  function prepareLocalWorkflowNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      if (Notification.permission === "default") void Notification.requestPermission();
    } catch {
      // Best-effort only.
    }
  }

  async function checkQuoteProviderHealth() {
    setLocalProviderStatus("unknown");
    setLocalProviderMessage("");
    try {
      const res = await fetch(getQuoteProviderUrl(quoteProviderId, "health"), { cache: "no-store" });
      const data = await res.json() as { ok?: boolean; engine?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLocalProviderStatus("connected");
      setLocalProviderMessage(`${quoteProvider.shortLabel} conectado${data.engine ? ` - ${data.engine}` : ""}.`);
    } catch {
      setLocalProviderStatus("offline");
      setLocalProviderMessage(`${quoteProvider.shortLabel} no conectado. Revisa que el worker del proveedor este activo.`);
    }
  }

  async function copyManualText(text: string, label: string) {
    if (!text) {
      setManualCopyMessage("No hay contenido pendiente para copiar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setManualCopyMessage(`${label} copiado.`);
    } catch {
      setManualCopyMessage("No se pudo copiar automaticamente; selecciona el texto y copialo manualmente.");
    }
  }

  function importManualResponse() {
    const raw = manualRawResponse.trim();
    if (!raw) {
      setManualCopyMessage("Pega primero la tabla Markdown devuelta por la IA.");
      return;
    }
    onRun({
      action: "manual_quote",
      stage2Json: sourceResponse?.result,
      runId: sourceResponse?.runId || stage2Response?.runId,
      provider: "openai",
      model: "manual-copy-paste",
      supervisorModel,
      maxAttempts,
      batchSize: manualBatchSize || manualPackage.itemKeys.length,
      promptInstruction: activePromptInstruction,
      manualRaw: raw,
      manualItemKeys: manualPackage.itemKeys,
      manualPromptFinal: manualPackage.text || `${manualPackage.promptText}\n\n## Datos a procesar\n${manualPackage.tableText}`
    });
  }

  async function loadLatestStage3BForSupervision(nextRunId?: string | null): Promise<ApiResponse | null> {
    if (!nextRunId) return null;
    const response = await fetch(`/api/runs/${encodeURIComponent(nextRunId)}?technical=1`);
    if (!response.ok) return null;
    const payload = await response.json() as { run?: { stages?: unknown[] } };
    const stages = Array.isArray(payload.run?.stages) ? payload.run.stages.filter(isRecord) : [];
    const stage = stages.find((entry) => textValue(entry.stage) === "stage3b");
    if (!stage || !isRecord(stage.result)) return null;
    return {
      runId: nextRunId,
      provider: textValue(stage.provider) || undefined,
      model: textValue(stage.model) || undefined,
      result: stage.result,
      raw: textValue(stage.raw) || undefined,
      details: isRecord(stage.details) ? stage.details : undefined
    } as ApiResponse;
  }

  function waitStage3BLocal(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function recoverLocalProviderRaw(jobId: string, originalError: unknown) {
    let sawProviderJob = false;
    let lastMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const started = Date.now();
    const timeoutMs = 45 * 60 * 1000;

    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(getQuoteProviderUrl(quoteProviderId, "result", `jobId=${encodeURIComponent(jobId)}`), { cache: "no-store" });
        const text = await res.text();
        const data = (text.trim() ? JSON.parse(text) : {}) as {
          ok?: boolean;
          status?: string;
          step?: string;
          message?: string;
          error?: string;
          retryable?: boolean;
          rawResponse?: string;
          manualRaw?: string;
        };
        const raw = (data.rawResponse || data.manualRaw || "").trim();
        if (res.ok && data.ok && raw) return raw;

        const status = textValue(data.status);
        if (status && status !== "missing") sawProviderJob = true;
        lastMessage = textValue(data.message) || textValue(data.error) || lastMessage;
        if (res.status === 404 && !sawProviderJob) break;
        if ((status === "failed" || res.status >= 500) && data.retryable !== true) {
          throw new Error(lastMessage || `${quoteProvider.shortLabel} fallo antes de entregar resultado.`);
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
      }

      await waitStage3BLocal(15000);
    }

    throw new Error(lastMessage || (originalError instanceof Error ? originalError.message : String(originalError)));
  }

  async function executeLocalProvider() {
    if (!manualPackage.tableText || !manualPackage.itemKeys.length) {
      setLocalProviderMessage(`No hay items pendientes para enviar a ${quoteProvider.shortLabel}.`);
      return;
    }
    setLocalProviderStatus("running");
    setLocalProviderMessage(`${quoteProvider.shortLabel} iniciando ciclo automatico 3-B...`);
    prepareLocalWorkflowNotificationPermission();
    setManualCopyMessage("");
    try {
      const targetRunId = sourceResponse?.runId || stage2Response?.runId;
      let currentStage3B: ApiResponse | null = response;
      const maxCycles = Math.min(3, Math.max(1, maxAttempts));
      let lastRaw = "";
      let totalAutoApplied = 0;
      const workflowStartedAt = Date.now();
      updateLocalWorkflow({
        active: true,
        startedAt: workflowStartedAt,
        elapsedMs: 0,
        percent: 3,
        cycle: 0,
        maxCycles,
        sentItems: 0,
        autoApplied: 0,
        pending: manualPackage.totalPending,
        phase: "inicio",
        message: `Preparando paquete para ${quoteProvider.shortLabel}.`,
        completed: false,
        failed: false
      });

      async function applyHighConfidence(supervisedStage3B: ApiResponse, cycleLabel: string, packageSize: number) {
        const highConfidenceKeys = getStage3BHighConfidenceAcceptedKeys(supervisedStage3B);
        if (!highConfidenceKeys.length) return { stage3B: supervisedStage3B, applied: 0 };
        setLocalProviderMessage(`${cycleLabel}: subiendo ${highConfidenceKeys.length} item(s) de alta confianza...`);
        updateLocalWorkflow({
          phase: "subiendo alta confianza",
          message: `${cycleLabel}: subiendo ${highConfidenceKeys.length} item(s) a la tabla maestra.`
        });
        const appliedPayload = await onRun({
          action: "apply",
          stage2Json: sourceResponse?.result,
          currentStage3B: supervisedStage3B,
          runId: targetRunId,
          provider,
          model,
          reasoningEffort,
          supervisorModel,
          maxAttempts,
          batchSize: manualBatchSize || packageSize,
          searchContextSize,
          promptInstruction: activePromptInstruction,
          selectedItemKeys: highConfidenceKeys
        });
        const nextStage3B = appliedPayload && isRecord(appliedPayload) && appliedPayload.result
          ? appliedPayload as ApiResponse
          : await loadLatestStage3BForSupervision(targetRunId) || supervisedStage3B;
        totalAutoApplied += highConfidenceKeys.length;
        updateLocalWorkflow({ autoApplied: totalAutoApplied });
        return { stage3B: nextStage3B, applied: highConfidenceKeys.length };
      }

      for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
        const packageForCycle = buildStage3BManualPackage({
          stage2Result: sourceResponse?.result ?? null,
          stage3BResponse: currentStage3B,
          promptInstruction: activePromptInstruction,
          limit: manualBatchSize,
          maxAttempts,
          runId: targetRunId
        });
        if (!packageForCycle.tableText || !packageForCycle.itemKeys.length) {
          const doneMessage = cycle === 1
            ? `No hay items pendientes para enviar a ${quoteProvider.shortLabel}.`
            : `Ciclo automatico terminado: sin pendientes elegibles. Alta confianza subida: ${totalAutoApplied}.`;
          setLocalProviderMessage(doneMessage);
          updateLocalWorkflow({
            active: false,
            elapsedMs: Date.now() - workflowStartedAt,
            percent: 100,
            cycle: Math.max(0, cycle - 1),
            pending: 0,
            phase: "terminado",
            message: doneMessage,
            completed: true
          });
          void notifyLocalWorkflow("Etapa 3-B local terminada", doneMessage);
          break;
        }

        const jobId = `stage3b_${targetRunId || "sin_run"}_${Date.now()}_c${cycle}`;
        const cycleBasePercent = 5 + ((cycle - 1) / maxCycles) * 88;
        const cycleSpanPercent = 88 / maxCycles;
        setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: ${quoteProvider.shortLabel} cotizando ${packageForCycle.itemKeys.length} item(s)...`);
        updateLocalWorkflow({
          percent: Math.min(94, cycleBasePercent),
          cycle,
          sentItems: packageForCycle.itemKeys.length,
          pending: packageForCycle.totalPending,
          phase: "cotizando",
          message: `Ciclo ${cycle}/${maxCycles}: ${quoteProvider.shortLabel} cotizando ${packageForCycle.itemKeys.length} item(s).`
        });
        let data: { ok?: boolean; rawResponse?: string; manualRaw?: string; summary?: Record<string, unknown>; error?: string } = {};
        let raw = "";
        try {
          const res = await fetch(getQuoteProviderUrl(quoteProviderId, "quote"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              runId: targetRunId,
              promptText: packageForCycle.promptText,
              tableText: packageForCycle.tableText,
              promptFinal: packageForCycle.text || `${packageForCycle.promptText}\n\n## Datos a procesar\n${packageForCycle.tableText}`,
              itemKeys: packageForCycle.itemKeys,
              maxAttempts,
              quoteProviderId
            })
          });
          const text = await res.text();
          data = (text.trim() ? JSON.parse(text) : {}) as typeof data;
          if (!res.ok || !data.ok) throw new Error(data.error || `${quoteProvider.shortLabel} HTTP ${res.status}`);
          raw = (data.rawResponse || data.manualRaw || "").trim();
          if (!raw) throw new Error("El proveedor local termino sin tabla raw.");
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: conexion interrumpida; recuperando resultado de ${quoteProvider.shortLabel} por jobId...`);
          updateLocalWorkflow({
            percent: Math.min(95, cycleBasePercent + cycleSpanPercent * 0.24),
            phase: "recuperando resultado",
            message: `Ciclo ${cycle}/${maxCycles}: recuperando resultado por jobId. ${errorMessage}`
          });
          raw = await recoverLocalProviderRaw(jobId, error);
          data = { ok: true, rawResponse: raw, summary: { itemCount: packageForCycle.itemKeys.length } };
        }
        lastRaw = raw;
        setManualRawResponse(raw);
        const summaryData = isRecord(data.summary) ? data.summary : {};
        const summaryWithData = typeof summaryData.withData === "number"
          ? Number(summaryData.withData)
          : typeof summaryData.conDatos === "number"
            ? Number(summaryData.conDatos)
            : undefined;
        const summaryItems = typeof summaryData.itemCount === "number"
          ? Number(summaryData.itemCount)
          : typeof summaryData.items === "number"
            ? Number(summaryData.items)
            : undefined;
        const conDatos = typeof summaryWithData === "number" ? summaryWithData.toLocaleString("es-CO") : "?";
        const totalItems = typeof summaryItems === "number" ? summaryItems.toLocaleString("es-CO") : packageForCycle.itemKeys.length.toLocaleString("es-CO");

        setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: ${quoteProvider.shortLabel} devolvio ${conDatos}/${totalItems} con datos. Importando raw...`);
        updateLocalWorkflow({
          percent: Math.min(96, cycleBasePercent + cycleSpanPercent * 0.32),
          phase: "importando raw",
          message: `Ciclo ${cycle}/${maxCycles}: ${quoteProvider.shortLabel} devolvio ${conDatos}/${totalItems} con datos.`
        });
        const quotePayload = await onRun({
          action: "manual_quote",
          stage2Json: sourceResponse?.result,
          currentStage3B,
          runId: targetRunId,
          provider: "openai",
          model: quoteProvider.id,
          supervisorModel,
          maxAttempts,
          batchSize: manualBatchSize || packageForCycle.itemKeys.length,
          promptInstruction: activePromptInstruction,
          manualRaw: raw,
          manualItemKeys: packageForCycle.itemKeys,
          manualPromptFinal: packageForCycle.text || `${packageForCycle.promptText}\n\n## Datos a procesar\n${packageForCycle.tableText}`
        });

        let quotedStage3B = quotePayload && isRecord(quotePayload) && quotePayload.result ? quotePayload as ApiResponse : null;
        if (!quotedStage3B?.result) {
          setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: recuperando intento guardado antes de supervisar...`);
          quotedStage3B = await loadLatestStage3BForSupervision(targetRunId);
        }
        if (!quotedStage3B?.result) throw new Error("La app no pudo recuperar el intento cotizado para supervisarlo.");

        const quotedResult = isRecord(quotedStage3B.result) ? quotedStage3B.result : null;
        const quotedAttempts = Array.isArray(quotedResult?.stage3b_attempts) ? quotedResult.stage3b_attempts.filter(isRecord) : [];
        const latestQuotedAttempt = quotedAttempts.length ? quotedAttempts[quotedAttempts.length - 1] : null;
        const latestQuotedStatus = textValue(latestQuotedAttempt?.status);

        let supervisedStage3B = quotedStage3B;
        if (latestQuotedStatus !== "supervised") {
          setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: supervisor revisando resultado local...`);
          updateLocalWorkflow({
            percent: Math.min(97, cycleBasePercent + cycleSpanPercent * 0.58),
            phase: "supervisando",
            message: `Ciclo ${cycle}/${maxCycles}: supervisor revisando resultado local.`
          });
          const supervisedPayload = await onRun({
            action: "supervise",
            stage2Json: sourceResponse?.result,
            currentStage3B: quotedStage3B,
            runId: targetRunId,
            provider,
            model,
            reasoningEffort,
            supervisorModel,
            maxAttempts,
            batchSize: manualBatchSize || packageForCycle.itemKeys.length,
            searchContextSize,
            promptInstruction: activePromptInstruction
          });
          supervisedStage3B = supervisedPayload && isRecord(supervisedPayload) && supervisedPayload.result
            ? supervisedPayload as ApiResponse
            : await loadLatestStage3BForSupervision(targetRunId) || quotedStage3B;
        }

        updateLocalWorkflow({
          percent: Math.min(98, cycleBasePercent + cycleSpanPercent * 0.78),
          phase: "consolidando",
          message: `Ciclo ${cycle}/${maxCycles}: consolidando resultados de alta confianza.`
        });
        const applied = await applyHighConfidence(supervisedStage3B, `Ciclo ${cycle}/${maxCycles}`, packageForCycle.itemKeys.length);
        if (applied.applied) {
          currentStage3B = applied.stage3B;
        } else {
          currentStage3B = supervisedStage3B;
          setLocalProviderMessage(`Ciclo ${cycle}/${maxCycles}: sin items de alta confianza para subir automaticamente.`);
        }

        const nextPackage = buildStage3BManualPackage({
          stage2Result: sourceResponse?.result ?? null,
          stage3BResponse: currentStage3B,
          promptInstruction: activePromptInstruction,
          limit: manualBatchSize,
          maxAttempts,
          runId: targetRunId
        });
        if (!nextPackage.itemKeys.length) {
          const doneMessage = `Ciclo automatico terminado: sin pendientes elegibles. Alta confianza subida: ${totalAutoApplied}.`;
          setLocalProviderMessage(doneMessage);
          updateLocalWorkflow({
            active: false,
            elapsedMs: Date.now() - workflowStartedAt,
            percent: 100,
            cycle,
            pending: 0,
            phase: "terminado",
            message: doneMessage,
            completed: true
          });
          void notifyLocalWorkflow("Etapa 3-B local terminada", doneMessage);
          break;
        }
        if (cycle === maxCycles) {
          if (currentStage3B) {
            const finalApplied = await applyHighConfidence(currentStage3B, "Cierre final", packageForCycle.itemKeys.length);
            if (finalApplied.applied) currentStage3B = finalApplied.stage3B;
          }
          const finalPackage = buildStage3BManualPackage({
            stage2Result: sourceResponse?.result ?? null,
            stage3BResponse: currentStage3B,
            promptInstruction: activePromptInstruction,
            limit: manualBatchSize,
            maxAttempts,
            runId: targetRunId
          });
          const doneMessage = `Ciclo automatico detenido en ${maxCycles} corrida(s). Alta confianza subida: ${totalAutoApplied}. Quedan ${finalPackage.totalPending} pendiente(s).`;
          setLocalProviderMessage(doneMessage);
          updateLocalWorkflow({
            active: false,
            elapsedMs: Date.now() - workflowStartedAt,
            percent: 100,
            cycle,
            pending: finalPackage.totalPending,
            phase: "terminado",
            message: doneMessage,
            completed: true
          });
          void notifyLocalWorkflow("Etapa 3-B local terminada", doneMessage);
        }
      }
      if (lastRaw) setManualRawResponse(lastRaw);
      setLocalProviderStatus("connected");
    } catch (error) {
      setLocalProviderStatus("offline");
      const errorMessage = error instanceof Error ? error.message : String(error);
      setLocalProviderMessage(errorMessage);
      updateLocalWorkflow({
        active: false,
        elapsedMs: localWorkflow.startedAt ? Date.now() - localWorkflow.startedAt : localWorkflow.elapsedMs,
        phase: "fallo",
        message: errorMessage,
        failed: true
      });
      void notifyLocalWorkflow("Etapa 3-B local se detuvo", errorMessage);
    }
  }

  async function loadLocalProviderLog() {
    const jobId = getLocalProviderCurrentJobId(localProviderSnapshot);
    if (!jobId) {
      setLocalProviderLog("Sin job local para consultar.");
      return;
    }
    try {
      const res = await fetch(getQuoteProviderUrl(quoteProviderId, "logs", `jobId=${encodeURIComponent(jobId)}`), { cache: "no-store" });
      const data = await res.json() as { ok?: boolean; log?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLocalProviderLog(data.log || "Log vacio.");
    } catch (error) {
      setLocalProviderLog(error instanceof Error ? error.message : String(error));
    }
  }

  function resetStage3B() {
    const ok = typeof window === "undefined"
      ? true
      : window.confirm("Reiniciar Etapa 3-B borrara intentos, supervision y tabla maestra 3-B. Etapa 1 y Etapa 2 se conservan.");
    if (!ok) return;
    setManualRawResponse("");
    setManualCopyMessage("Etapa 3-B reiniciada. Se conservan Etapa 1 y Etapa 2.");
    onSetStage3B(null);
  }

  async function savePromptDraft() {
    const text = promptDraft.trim();
    if (!text) {
      setPromptMessage("El prompt no puede quedar vacio.");
      return;
    }
    setPromptBusy(true);
    setPromptMessage("");
    try {
      const res = await fetch("/api/stage3b/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteInstructionPrompt: text })
      });
      const data = await res.json() as { quoteInstructionPrompt?: string; defaultQuoteInstructionPrompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el prompt 3-B.");
      const saved = typeof data.quoteInstructionPrompt === "string" ? data.quoteInstructionPrompt : text;
      setPromptSaved(saved);
      setPromptDraft(saved);
      if (typeof data.defaultQuoteInstructionPrompt === "string") setPromptDefault(data.defaultQuoteInstructionPrompt);
      setPromptMessage("Prompt 3-B guardado. Las nuevas cotizaciones lo usaran por defecto.");
    } catch (error) {
      setPromptMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPromptBusy(false);
    }
  }

  const localProviderJobId = getLocalProviderCurrentJobId(localProviderSnapshot);
  const localProviderStep = textValue(localProviderSnapshot?.step);
  const localProviderHeartbeatAt = textValue(localProviderSnapshot?.heartbeatAt);
  const localProviderUpdatedAt = textValue(localProviderSnapshot?.updatedAt);
  const stage3BCotizadorLabel = isLocalMode ? quoteProvider.label : isManualMode ? "Manual externo" : provider === "google" ? "Google" : "OpenAI";
  const localWorkflowPercent = Math.max(0, Math.min(100, Math.round(localWorkflow.percent)));
  const localWorkflowElapsed = localWorkflow.active && localWorkflow.startedAt
    ? Date.now() - localWorkflow.startedAt
    : localWorkflow.elapsedMs;
  const localProviderSnapshotStatus = textValue(localProviderSnapshot?.status);
  const localWorkflowCompleted = localWorkflow.completed || localProviderSnapshotStatus === "completed";
  const localWorkflowDisplayPercent = localWorkflowCompleted ? 100 : localWorkflowPercent;
  const localWorkflowDisplayTime = localWorkflowCompleted && localWorkflowElapsed <= 0 ? "Listo" : formatDuration(localWorkflowElapsed);
  const manualPackageHasWork = Boolean(manualPackage.tableText && manualPackage.itemKeys.length);
  const showManualQueueSummary = isAdminMode || manualPackageHasWork || manualPackage.totalPending > 0;
  const showLocalRunButton = isAdminMode || manualPackageHasWork || localProviderStatus === "running";
  const localRunButtonLabel = localProviderStatus === "running"
    ? "Ejecutando..."
    : manualPackageHasWork
      ? `Ejecutar en ${quoteProvider.shortLabel}`
      : "Sin pendientes";
  const stage3BFlowMeta = `Entrada: ${sourceLabel} - Cotizador: ${stage3BCotizadorLabel} - Supervisor: ${getModelDisplayName(supervisorModel)}`;

  return (
    <div className={`stageTabBody stage3bPanel${isAdminMode ? "" : " standardStage3View"}`}>
      <Stage3BMasterTable
        response={response}
        displayNumberFormat={displayNumberFormat}
        copRate={copRate}
        isAdminMode={isAdminMode}
        title="Tabla maestra"
        recentlyApprovedItemKeys={recentlyApprovedStage3BKeys}
      />

      <Stage3BConversation
        response={response}
        displayNumberFormat={displayNumberFormat}
        copRate={copRate}
        loading={loading}
        stage2Result={sourceResponse?.result ?? stage2Response?.result ?? null}
        isAdminMode={isAdminMode}
        onSuperviseLatest={() => onRun({
          action: "supervise",
          stage2Json: sourceResponse?.result,
          runId: sourceResponse?.runId || stage2Response?.runId,
          provider,
          model,
          reasoningEffort,
          supervisorModel,
          maxAttempts,
          batchSize,
          searchContextSize,
          promptInstruction: activePromptInstruction
        })}
        onApplySelected={async (selectedItemKeys) => {
          await onRun({
            action: "apply",
            stage2Json: sourceResponse?.result,
            runId: sourceResponse?.runId || stage2Response?.runId,
            provider,
            model,
            reasoningEffort,
            supervisorModel,
            maxAttempts,
            batchSize,
            searchContextSize,
            promptInstruction: activePromptInstruction,
            selectedItemKeys
          });
          markStage3BRecentlyApproved(selectedItemKeys);
        }}
        onLoadPromptSuggestion={(prompt) => {
          setPromptDraft(prompt);
          setPromptMessage("Requerimiento sugerido cargado en el editor. Revisalo y guarda si quieres usarlo por defecto.");
        }}
      />

      <section className="stageExperimentLab stage3BChatPanel" aria-label="Control Etapa 3-B asistida">
        <div className="stageExperimentLabHeader">
          <div>
            <h3>{isAdminMode ? "Control 3-B" : "Control de cotizacion"}</h3>
            <p>{isAdminMode ? "Fuente, modelo, lote y accion." : "Estado del proveedor, siguiente accion y ajustes plegados."}</p>
          </div>
          {response?.result ? (
            <div className="stageDataToolbarMeta stageExperimentMeta">
              <span>{accepted.toLocaleString("es-CO")}/{total.toLocaleString("es-CO")} aceptados</span>
              <span>{pending.toLocaleString("es-CO")} pendientes</span>
              {isActiveForFinancial ? <span>Activa para Etapa 4</span> : null}
            </div>
          ) : null}
        </div>

        {isAdminMode ? <div className="stage3BModeSwitch" role="group" aria-label="Modo de Etapa 3-B">
          <button
            type="button"
            className={isManualMode ? "stage3BModeButton stage3BModeButtonActive" : "stage3BModeButton"}
            onClick={() => onSetStage3RunMode("stage3b_manual")}
          >
            Manual copiar/pegar
          </button>
          <button
            type="button"
            className={isLocalMode ? "stage3BModeButton stage3BModeButtonActive" : "stage3BModeButton"}
            onClick={() => onSetStage3RunMode("stage3b_local")}
          >
            Proveedor Codex
          </button>
          <button
            type="button"
            className={stage3RunMode === "stage3b_api" ? "stage3BModeButton stage3BModeButtonActive" : "stage3BModeButton"}
            onClick={() => onSetStage3RunMode("stage3b_api")}
          >
            API asistida
          </button>
        </div> : null}

        <div className={"stage3BNextStep " + (hasUnsupervisedAttempt ? "stage3BNextStepPending" : "")}>
          <strong>Siguiente</strong>
          <span>
            {hasUnsupervisedAttempt
              ? "Verifica el intento actual antes de seguir."
              : isLocalMode
                ? manualPackageHasWork
                  ? `Ejecuta el paquete en ${quoteProvider.shortLabel}; la app importara el resultado.`
                  : response?.result
                    ? "Sin pendientes elegibles para enviar; revisa la tabla maestra o pasa a Etapa 4."
                    : "Cuando Etapa 2 tenga items, se preparara el primer paquete."
              : isManualMode
                ? "Copia el paquete, procesa afuera y pega la respuesta."
              : pending > 0
                ? "Procesa el siguiente lote o los pendientes."
                : response?.result
                  ? "Sin pendientes en la tabla maestra."
                  : "Procesa el primer lote."}
          </span>
        </div>

        <details className="stage3BSettingsDetails">
          <summary><strong>{isAdminMode ? "Configuracion" : "Ajustes"}</strong><span>{isAdminMode ? "Entrada, proveedor, modelo y lote." : "Entrada y tamano de paquete."}</span></summary>

        {!isManualLikeMode ? (
        <div className="stageExperimentControlBox stage3bControlBox">
          <label className="stageExperimentField">
            <span>Entrada</span>
            <select value={source} onChange={(event) => setSource(event.target.value === "experimental" ? "experimental" : "stable")}>
              <option value="stable">Etapa 2 normal</option>
              <option value="experimental" disabled={!stage2Experiment?.result}>Etapa 2 experimental</option>
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Proveedor cotizador</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value === "google" ? "google" : "openai")}>
              <option value="openai">OpenAI web_search</option>
              <option value="google">Google Gemini Grounding</option>
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Modelo cotizador</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {provider === "google" ? geminiModelFlatSelectOptions() : modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Razonamiento</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} disabled={provider === "google"}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Intentos máximos por ítem</span>
            <select value={String(maxAttempts)} onChange={(event) => setMaxAttempts(Number(event.target.value))}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Lote</span>
            <select value={String(batchSize)} onChange={(event) => setBatchSize(Number(event.target.value))}>
              <option value="10">10 items</option>
              <option value="15">15 items</option>
              <option value="20">20 items</option>
            </select>
          </label>
          <label className="stageExperimentField">
            <span>Búsqueda</span>
            <select value={searchContextSize} onChange={(event) => setSearchContextSize(event.target.value as "low" | "medium" | "high")} disabled={provider === "google"}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        ) : (
          <div className="stageExperimentControlBox stage3bControlBox">
            <label className="stageExperimentField">
              <span>Entrada</span>
              <select value={source} onChange={(event) => setSource(event.target.value === "experimental" ? "experimental" : "stable")}>
                <option value="stable">Etapa 2 normal</option>
                <option value="experimental" disabled={!stage2Experiment?.result}>Etapa 2 experimental</option>
              </select>
            </label>
            {isLocalMode ? (
              <label className="stageExperimentField">
                <span>Proveedor</span>
                <select value={quoteProviderId} onChange={(event) => setQuoteProviderId(event.target.value as QuoteProviderId)} disabled={localProviderStatus === "running"}>
                  {QUOTE_PROVIDER_DEFINITIONS.map((definition) => (
                    <option key={definition.id} value={definition.id}>{definition.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="stageExperimentField">
              <span>Paquete local</span>
              <select value={String(manualBatchSize)} onChange={(event) => setManualBatchSize(Number(event.target.value))}>
                <option value="30">Auto: hasta 30 items</option>
                <option value="20">Hasta 20 items</option>
                <option value="10">Hasta 10 items</option>
                <option value="0">Todos los pendientes</option>
              </select>
            </label>
            <label className="stageExperimentField">
              <span>Intentos por item</span>
              <select value={String(maxAttempts)} onChange={(event) => setMaxAttempts(Number(event.target.value))}>
                <option value="1">1 intento</option>
                <option value="2">2 intentos</option>
                <option value="3">3 intentos</option>
              </select>
            </label>
          </div>
        )}

        <details className="stage3BPromptEditor">
          <summary>
            <div>
              <strong>Prompt base editable del cotizador</strong>
              <span>Se guarda para nuevas corridas. Cada intento conserva el prompt enviado.</span>
            </div>
          </summary>
          <textarea
            className="stage3BPromptTextarea"
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            spellCheck={false}
          />
          <div className="stage3BPromptEditorFooter">
            <span className="muted">{activePromptInstruction.length.toLocaleString("es-CO")} caracteres. Se agregan solo los ítems del lote.</span>
            <div className="stage3BPromptEditorActions">
              <button type="button" className="secondary miniButton" disabled={promptBusy || !promptSaved} onClick={() => setPromptDraft(promptSaved)}>Restaurar guardado</button>
              <button type="button" className="secondary miniButton" disabled={promptBusy || !promptDefault} onClick={() => setPromptDraft(promptDefault)}>Ver predeterminado</button>
              <button type="button" className="stageTabExportExcelBtn" disabled={promptBusy} onClick={() => void savePromptDraft()}>
                {promptBusy ? "Guardando..." : "Guardar prompt"}
              </button>
            </div>
          </div>
          {promptMessage ? <div className="stage3BPromptMessage">{promptMessage}</div> : null}
        </details>
        </details>

        {isManualLikeMode ? (
          <div className="stage3BManualBox">
            {showManualQueueSummary && isAdminMode ? <div className="stage3BManualQueueSummary" aria-label="Resumen de cola manual 3-B">
              <span><strong>{manualPackage.itemKeys.length.toLocaleString("es-CO")}</strong> en este paquete</span>
              <span><strong>{manualPackage.retryableCount.toLocaleString("es-CO")}</strong> reintento(s) primero</span>
              <span><strong>{manualPackage.neverSentCount.toLocaleString("es-CO")}</strong> nuevo(s) en cola</span>
              <span><strong>{manualPackage.totalPending.toLocaleString("es-CO")}</strong> pendiente(s)</span>
              {manualPackage.exhaustedCount ? <span className="stage3BManualQueueWarn"><strong>{manualPackage.exhaustedCount.toLocaleString("es-CO")}</strong> agotado(s)</span> : null}
            </div> : null}
            {isLocalMode ? (<>
              <div className={`stage3BLocalProviderStatus stage3BLocalProviderStatus-${localProviderStatus}${localWorkflowCompleted ? " stage3BLocalProviderStatus-completed" : ""}`}>
                <div className={`stage3BLocalWorkflowDonut${localWorkflowCompleted ? " stage3BLocalWorkflowDonutDone" : ""}`} style={{ "--local-progress": `${localWorkflowDisplayPercent}%` } as CSSProperties}>
                  <div>
                    <strong>{localWorkflowCompleted ? "100%" : `${localWorkflowDisplayPercent}%`}</strong>
                    <span>{localWorkflowDisplayTime}</span>
                  </div>
                </div>
                <div className="stage3BLocalProviderText">
                  <strong>{quoteProvider.label}</strong>
                  <span>{localProviderMessage || "Abre el servidor local para recibir paquetes 3-B."}</span>
                  {isAdminMode ? <div className="stage3BLocalProviderMeta">
                    <small>Subidos alta: {localWorkflow.autoApplied.toLocaleString("es-CO")}</small>
                    {localWorkflow.pending ? <small>Pendientes: {localWorkflow.pending.toLocaleString("es-CO")}</small> : null}
                    <small>Estado: {localProviderSnapshotStatus || localProviderStatus}</small>
                  </div> : null}
                  <details className="stage3BLocalConnectionDetails">
                    <summary>Log de conexion</summary>
                    <div className="stage3BLocalProviderMeta stage3BLocalProviderMetaTechnical">
                      <small>Ciclo: {localWorkflow.cycle || 0}/{localWorkflow.maxCycles || maxAttempts}</small>
                      <small>Fase: {localWorkflow.phase}</small>
                      {localProviderStep ? <small>Paso: {localProviderStep}</small> : null}
                      {localProviderJobId ? <small>Job: {localProviderJobId}</small> : null}
                      {localProviderHeartbeatAt ? <small>Heartbeat: {localProviderHeartbeatAt}</small> : localProviderUpdatedAt ? <small>Actualizado: {localProviderUpdatedAt}</small> : null}
                    </div>
                  </details>
                </div>
                <div className={`stage3BLocalProviderActions${isAdminMode ? "" : " stage3BLocalProviderActionsCompact"}`}>
                  {showLocalRunButton ? (
                    <button type="button" className="stageTabExportExcelBtn" disabled={!canRun || hasUnsupervisedAttempt || loading !== null || localProviderStatus === "running" || !manualPackageHasWork} onClick={() => void executeLocalProvider()}>
                      {localRunButtonLabel}
                    </button>
                  ) : null}
                  {isAdminMode ? (
                    <>
                      <label className="stage3BProviderInlinePicker">
                        <span>Proveedor</span>
                        <select value={quoteProviderId} onChange={(event) => setQuoteProviderId(event.target.value as QuoteProviderId)} disabled={localProviderStatus === "running"}>
                          {QUOTE_PROVIDER_DEFINITIONS.map((definition) => (
                            <option key={definition.id} value={definition.id}>{definition.label}</option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="secondary miniButton" disabled={localProviderStatus === "running"} onClick={() => void checkQuoteProviderHealth()}>
                        Probar conexion
                      </button>
                      <button type="button" className="secondary miniButton" disabled={!localProviderJobId} onClick={() => void loadLocalProviderLog()}>
                        Ver log
                      </button>
                    </>
                  ) : (
                    <details className="stage3BLocalConfigDetails">
                      <summary>Conexion y ajustes</summary>
                      <div className="stage3BLocalConfigPanel">
                        <label className="stage3BProviderInlinePicker">
                          <span>Proveedor</span>
                          <select value={quoteProviderId} onChange={(event) => setQuoteProviderId(event.target.value as QuoteProviderId)} disabled={localProviderStatus === "running"}>
                            {QUOTE_PROVIDER_DEFINITIONS.map((definition) => (
                              <option key={definition.id} value={definition.id}>{definition.label}</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="secondary miniButton" disabled={localProviderStatus === "running"} onClick={() => void checkQuoteProviderHealth()}>
                          Probar conexion
                        </button>
                        <button type="button" className="secondary miniButton" disabled={!localProviderJobId} onClick={() => void loadLocalProviderLog()}>
                          Ver log
                        </button>
                        <div className="stage3BManualQueueSummary stage3BManualQueueSummaryInside" aria-label="Detalle de cola 3-B">
                          <span><strong>{manualPackage.itemKeys.length.toLocaleString("es-CO")}</strong> en paquete</span>
                          <span><strong>{manualPackage.totalPending.toLocaleString("es-CO")}</strong> pendiente(s)</span>
                          {manualPackage.retryableCount ? <span><strong>{manualPackage.retryableCount.toLocaleString("es-CO")}</strong> reintento(s)</span> : null}
                          {manualPackage.neverSentCount ? <span><strong>{manualPackage.neverSentCount.toLocaleString("es-CO")}</strong> nuevo(s)</span> : null}
                          {manualPackage.exhaustedCount ? <span className="stage3BManualQueueWarn"><strong>{manualPackage.exhaustedCount.toLocaleString("es-CO")}</strong> agotado(s)</span> : null}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </div>
              {localProviderLog ? (
                <details className="stage3BLocalProviderLog">
                  <summary>Log del proveedor local</summary>
                  <pre>{localProviderLog}</pre>
                </details>
              ) : null}
            </>) : null}
            {(isManualMode || isAdminMode) ? <div className="stage3BManualGrid">
              <section className="stage3BManualSubBox">
                <div className="stage3BManualHeader">
                  <div>
                    <strong>Prompt para IA externa</strong>
                    <span>Instrucciones solamente. Copialas una vez por intento.</span>
                  </div>
                  <button type="button" className="stageTabExportExcelBtn" disabled={!manualPackage.promptText || loading === "stage3"} onClick={() => void copyManualText(manualPackage.promptText, "Prompt")}>
                    Copiar prompt
                  </button>
                </div>
                <textarea
                  className="stage3BManualTextarea stage3BManualPromptOnly"
                  value={manualPackage.promptText}
                  readOnly
                  spellCheck={false}
                  aria-label="Prompt para copiar"
                />
              </section>
              <section className="stage3BManualSubBox">
                <div className="stage3BManualHeader">
                  <div>
                    <strong>{stage3BAttempts.length ? "Tabla MD para siguiente paquete" : "Tabla MD para primer paquete"}</strong>
                    <span>Incluye pendientes/reintentos primero y completa cupo con items nuevos.</span>
                  </div>
                  <button type="button" className="stageTabExportExcelBtn" disabled={!manualPackage.tableText || loading === "stage3"} onClick={() => void copyManualText(manualPackage.tableText, "Tabla Markdown")}>
                    Copiar tabla MD
                  </button>
                </div>
                <textarea
                  className="stage3BManualTextarea"
                  value={manualPackage.tableText || "Sin items pendientes para reintentar."}
                  readOnly
                  spellCheck={false}
                  aria-label="Tabla Markdown para copiar"
                />
              </section>
            </div> : null}
            {isManualMode ? <section className="stage3BManualSubBox stage3BManualLocalTaskBox">
              <div className="stage3BManualHeader">
                <div>
                  <strong>Tarea local para Codex watcher</strong>
                  <span>Copiala como archivo .md en la carpeta entrada/ del agente local.</span>
                </div>
                <button type="button" className="stageTabExportExcelBtn" disabled={!manualPackage.localTaskText || loading === "stage3"} onClick={() => void copyManualText(manualPackage.localTaskText, "Tarea local")}>
                  Copiar tarea local
                </button>
              </div>
              <textarea
                className="stage3BManualTextarea stage3BManualLocalTask"
                value={manualPackage.localTaskText || "Sin items pendientes para enviar al agente local."}
                readOnly
                spellCheck={false}
                aria-label="Tarea local para Codex watcher"
              />
            </section> : null}
            {(isManualMode || isAdminMode) ? <label className="stage3BManualPaste">
              <span>Pega aquí la tabla Markdown devuelta por tu IA</span>
              <textarea
                value={manualRawResponse}
                onChange={(event) => setManualRawResponse(event.target.value)}
                spellCheck={false}
                placeholder="Pega la tabla Markdown cruda con columnas Item | Nombre | ... | Proveedor 1 | Precio proveedor 1 | URL proveedor 1..."
              />
            </label> : null}
            {(isManualMode || isAdminMode) ? <div className="stage3BManualActions">
              <button type="button" className="stageTabExportExcelBtn" disabled={!canRun || loading !== null || !manualRawResponse.trim()} onClick={importManualResponse}>
                Importar respuesta como intento
              </button>
              <span className="muted">{manualCopyMessage || (isLocalMode ? `La app enviara el paquete a ${quoteProvider.shortLabel}, importara la respuesta y supervisara.` : "La app no llama al cotizador: solo importa, verifica y supervisa.")}</span>
            </div> : null}
          </div>
        ) : null}

        <div className={`stageExperimentAuditBar stage3bActionBar stage3BMessageActions${isAdminMode ? "" : " stage3BStandardActions"}`}>
          {isAdminMode ? <span className="muted">{stage3BFlowMeta}</span> : null}
          {!isManualLikeMode ? <button
            type="button"
            className="stageTabExportExcelBtn"
            disabled={!canQuote || missingProviderKey}
            onClick={() => onRun({
              action: "quote",
              stage2Json: sourceResponse?.result,
              runId: sourceResponse?.runId || stage2Response?.runId,
              provider,
              model,
              reasoningEffort,
              supervisorModel,
              maxAttempts,
              batchSize,
              searchContextSize,
              promptInstruction: activePromptInstruction
            })}
          >
            {loading === "stage3"
              ? "Procesando..."
              : hasUnsupervisedAttempt
                ? "Verifica intento actual"
                : response?.result
                  ? `Procesar pendientes (${Math.min(batchSize, pending).toLocaleString("es-CO")} de ${pending.toLocaleString("es-CO")})`
                  : "Procesar primer lote"}
          </button> : null}
          {isAdminMode ? <button
            type="button"
            className="secondary miniButton"
            disabled={!canSupervise}
            onClick={() => onRun({
              action: "supervise",
              stage2Json: sourceResponse?.result,
              runId: sourceResponse?.runId || stage2Response?.runId,
              provider,
              model,
              reasoningEffort,
              supervisorModel,
              maxAttempts,
              batchSize,
              searchContextSize,
              promptInstruction: activePromptInstruction
            })}
          >
            {loading === "stage3" ? "Procesando..." : "Verificar e integrar"}
          </button> : null}
          {response?.result && !isActiveForFinancial ? (
            <button type="button" className="secondary miniButton" onClick={onUseForFinancial}>
              Usar 3-B en Etapa 4
            </button>
          ) : null}
          {response?.result && isActiveForFinancial ? <span className="stage3BStatusPill">Activa en Etapa 4</span> : null}
          {isAdminMode && stage3BAttempts.length ? (
            <button
              type="button"
              className="secondary miniButton"
              disabled={loading === "stage3"}
              onClick={() => onRun({
                action: "discard_last_attempt",
                stage2Json: sourceResponse?.result,
                runId: sourceResponse?.runId || stage2Response?.runId,
                provider,
                model,
                reasoningEffort,
                supervisorModel,
                maxAttempts,
                batchSize,
                searchContextSize,
                promptInstruction: activePromptInstruction
              })}
            >
              Descartar ultimo intento
            </button>
          ) : null}
          {isAdminMode && response ? (
            <button type="button" className="secondary miniButton stage3BResetButton" onClick={resetStage3B} disabled={loading === "stage3"}>
              Reiniciar 3-B
            </button>
          ) : null}
          {!isAdminMode ? (
            <details className="stage3BAdvancedActions">
              <summary>Mas acciones</summary>
              <div>
                <span className="muted">{stage3BFlowMeta}</span>
                {canSupervise ? (
                  <button
                    type="button"
                    className="secondary miniButton"
                    disabled={!canSupervise}
                    onClick={() => onRun({
                      action: "supervise",
                      stage2Json: sourceResponse?.result,
                      runId: sourceResponse?.runId || stage2Response?.runId,
                      provider,
                      model,
                      reasoningEffort,
                      supervisorModel,
                      maxAttempts,
                      batchSize,
                      searchContextSize,
                      promptInstruction: activePromptInstruction
                    })}
                  >
                    Verificar e integrar
                  </button>
                ) : null}
                {stage3BAttempts.length ? (
                  <button
                    type="button"
                    className="secondary miniButton"
                    disabled={loading === "stage3"}
                    onClick={() => onRun({
                      action: "discard_last_attempt",
                      stage2Json: sourceResponse?.result,
                      runId: sourceResponse?.runId || stage2Response?.runId,
                      provider,
                      model,
                      reasoningEffort,
                      supervisorModel,
                      maxAttempts,
                      batchSize,
                      searchContextSize,
                      promptInstruction: activePromptInstruction
                    })}
                  >
                    Descartar ultimo intento
                  </button>
                ) : null}
                {response ? (
                  <button type="button" className="secondary miniButton stage3BResetButton" onClick={resetStage3B} disabled={loading === "stage3"}>
                    Reiniciar 3-B
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        {!isManualMode && missingProviderKey ? (
          <div className="error stageExperimentError">
            {provider === "openai" ? "Configura OPENAI_API_KEY para ejecutar Etapa 3-B con OpenAI." : "Configura API key Google/Gemini para ejecutar Etapa 3-B con Google."}
          </div>
        ) : null}
      </section>


    </div>
  );
}

function Stage3BMasterTable({
  response,
  displayNumberFormat,
  copRate,
  isAdminMode = false,
  title = "Tabla maestra",
  subtitle = "Datos originales y fuentes aprobadas.",
  emptyLabel = "Sin resultados 3-B.",
  recentlyApprovedItemKeys
}: {
  response: ApiResponse | null;
  displayNumberFormat: NumberDisplayFormat;
  copRate: number;
  isAdminMode?: boolean;
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
  recentlyApprovedItemKeys?: Set<string>;
}) {
  const [filter, setFilter] = useState<"all" | "withSource" | "pending">("all");
  const items = Array.isArray(response?.result?.items)
    ? response.result.items.filter(isRecord)
    : [];
  const rows = items.map((item, index) => buildStage3BMasterRow(item, index, displayNumberFormat));
  const stage3BCumulative = getRecord(isRecord(response?.result) ? response.result.stage3b_cumulative : null);
  const stage3BCumulativeUsage = getRecord(stage3BCumulative.usage);
  const stage3BCumulativeCost = getRecord(stage3BCumulative.cost);
  const acceptedRows = rows.filter((row) => row.hasSource).length;
  const pendingRows = Math.max(0, rows.length - acceptedRows);
  const visibleRows = filter === "withSource"
    ? rows.filter((row) => row.hasSource)
    : filter === "pending"
      ? rows.filter((row) => !row.hasSource)
      : rows;

  return (
    <article className="stageExperimentBox stage3BMasterBox">
      <div className="stageExperimentBoxHeader">
        <div>
          <h4>{title}</h4>
          <p className="muted">{subtitle}</p>
        </div>
        {response?.result ? (
          <div className="stageDataToolbarMeta stageExperimentMeta">
            <span>{acceptedRows.toLocaleString("es-CO")}/{items.length.toLocaleString("es-CO")} con fuente</span>
            {isAdminMode && typeof stage3BCumulativeUsage.totalTokens === "number" ? <span>{stage3BCumulativeUsage.totalTokens.toLocaleString("es-CO")} tokens</span> : null}
            {isAdminMode && typeof stage3BCumulativeCost.totalUsd === "number" ? <span>{formatUsd(stage3BCumulativeCost.totalUsd)}{copRate > 0 ? " / COP " + Math.round(stage3BCumulativeCost.totalUsd * copRate).toLocaleString("es-CO") : ""}</span> : null}
          </div>
        ) : null}
      </div>

      {items.length ? (
        <div className="stage3BMasterFocusBar" role="group" aria-label="Filtrar tabla maestra 3-B">
          <button type="button" className={filter === "all" ? "stage3BFocusChip stage3BFocusChipActive" : "stage3BFocusChip"} onClick={() => setFilter("all")}>
            Todos <strong>{rows.length.toLocaleString("es-CO")}</strong>
          </button>
          <button type="button" className={filter === "withSource" ? "stage3BFocusChip stage3BFocusChipActive" : "stage3BFocusChip"} onClick={() => setFilter("withSource")}>
            Con fuente <strong>{acceptedRows.toLocaleString("es-CO")}</strong>
          </button>
          <button type="button" className={filter === "pending" ? "stage3BFocusChip stage3BFocusChipActive stage3BFocusChipWarn" : "stage3BFocusChip stage3BFocusChipWarn"} onClick={() => setFilter("pending")}>
            Pendientes <strong>{pendingRows.toLocaleString("es-CO")}</strong>
          </button>
        </div>
      ) : null}

      {!items.length ? (
        <p className="muted stageExperimentEmpty">{emptyLabel}</p>
      ) : (
        <div className="stage3BMasterTableWrap">
          <table className="stage3BMasterTable">
            <thead>
              <tr>
                <th>Item</th>
                <th>Nombre</th>
                <th>Ficha técnica</th>
                <th>Und</th>
                <th>Cant</th>
                <th>Precio techo</th>
                <th>Fuente aprobada</th>
                <th>Precio fuente</th>
                <th>URL</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const rowClass = [
                  row.hasSource ? "stage3BMasterRowAccepted" : "",
                  recentlyApprovedItemKeys?.has(row.itemKey) ? "stage3BMasterRowJustApproved" : ""
                ].filter(Boolean).join(" ");
                const statusBadge = getStage3BMasterStatusBadge(row.status, row.hasSource);
                return (
                  <tr key={`${row.itemKey}-${index}`} className={rowClass}>
                    <td>{row.itemKey}</td>
                    <td title={row.name}>{row.name || <span className="muted">Sin nombre</span>}</td>
                    <td title={row.description}>{row.description || <span className="muted">Sin ficha</span>}</td>
                    <td>{row.unit}</td>
                    <td>{row.quantity}</td>
                    <td>{row.ceiling}</td>
                    <td>{row.provider}</td>
                    <td>{row.price}</td>
                    <td>{row.url ? <a href={row.url} target="_blank" rel="noreferrer">Abrir</a> : ""}</td>
                    <td>
                      <span className={`stage3BMasterStatusBadge stage3BMasterStatus${statusBadge.tone}`} title={row.status || statusBadge.label}>
                        {statusBadge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!visibleRows.length ? (
                <tr>
                  <td colSpan={10}><span className="muted">Sin filas para este filtro.</span></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function buildStage3BMasterRow(item: Record<string, unknown>, index: number, numberFormat: NumberDisplayFormat) {
  const itemKey = getFirstItemText(item, ["No. item", "Consecutivo interno", "item"]) || String(index + 1);
  const name = getFirstItemText(item, ["Nombre o descripción", "Nombre o descripcion", "Nombre o descripci?n", "Nombre", "name", "nombre"]);
  const description = getFirstItemText(item, ["Detalles o ficha técnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "Ficha técnica", "Ficha tecnica", "description", "descripcion"]);
  const unit = getFirstItemText(item, ["Und de medida", "Und", "unit", "unidad"]);
  const quantity = getFirstItemText(item, ["Cant", "quantity", "cantidad"]);
  const ceiling = getFirstItemText(item, ["Precio techo encontrado", "Precio techo unitario", "Precio techo", "ceiling_unit_price", "precio_techo"]);
  const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isRecord) : [];
  const quote = quotes[0] || {};
  const source = getRecord(quote.fuente);
  const price = getRecord(quote.precio);
  const defense = getRecord(quote.defensa);
  const state = isRecord(item["Estado de cotizacion"]) ? item["Estado de cotizacion"] : getRecord(item["Estado de cotización"]);
  const hasSource = Boolean(quotes.length);
  return {
    itemKey,
    name,
    description,
    unit,
    quantity,
    ceiling: ceiling ? formatScalarForUi(ceiling, { numberFormat }).toString() : "",
    provider: hasSource ? textValue(source.nombre) : "",
    price: hasSource ? (textValue(price.texto_original) || textValue(price.valor)) : "",
    url: hasSource ? (textValue(source.url) || textValue(defense.trazabilidad_fuente)) : "",
    status: hasSource
      ? (textValue(state.etapa3b_estado) || "con fuente")
      : (textValue(state.etapa3b_estado) || "pendiente"),
    hasSource
  };
}

function getStage3BMasterStatusBadge(status: string, hasSource: boolean) {
  const raw = status.trim();
  const normalized = normalizeLabel(raw).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!raw) return { label: hasSource ? "Con fuente" : "Pendiente", tone: hasSource ? "Sirve" : "Pendiente" };
  if (normalized.includes("sin_fuente_usable") || normalized.includes("no_usar") || normalized.includes("rechazar") || normalized.includes("descartar")) {
    return { label: "Sin fuente usable", tone: "NoUsar" };
  }
  if (normalized.includes("sin_datos") || normalized.includes("sin_fuente")) {
    return { label: "Sin datos", tone: "SinDatos" };
  }
  if (normalized.includes("rescatable")) {
    return { label: "Rescatable", tone: "Rescatable" };
  }
  if (normalized.includes("cautela") || normalized.includes("revision") || normalized.includes("media") || normalized.includes("precio_dudoso")) {
    return { label: "Con cautela", tone: "Cautela" };
  }
  if (
    normalized.includes("sirve")
    || normalized.includes("confirmado")
    || normalized.includes("con_fuente")
    || normalized.includes("aceptar")
    || normalized === "ok"
  ) {
    return { label: "Con fuente", tone: "Sirve" };
  }
  if (normalized.includes("pendiente")) {
    return { label: "Pendiente", tone: "Pendiente" };
  }
  return { label: humanizeStage3BStatus(raw), tone: hasSource ? "Cautela" : "Pendiente" };
}

function humanizeStage3BStatus(status: string) {
  const words = status
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Pendiente";
}

function Stage3CParallelPanel({
  response,
  stage2Response,
  loading,
  reviewProvider,
  reviewModel,
  displayNumberFormat,
  copRate,
  isActiveForFinancial,
  onUseForFinancial,
  onRun,
  onSetStage3C,
  isAdminMode
}: {
  response: ApiResponse | null;
  stage2Response: ApiResponse | null;
  loading: LoadingStage;
  reviewProvider: "" | AiProvider;
  reviewModel: string;
  displayNumberFormat: NumberDisplayFormat;
  copRate: number;
  isActiveForFinancial: boolean;
  onUseForFinancial: () => void;
  onRun: (options: Stage3BRunOptions) => Promise<ApiResponse | void> | ApiResponse | void;
  onSetStage3C: Dispatch<SetStateAction<ApiResponse | null>>;
  isAdminMode: boolean;
}) {
  const [shardSize, setShardSize] = useState(30);
  const [concurrency, setConcurrency] = useState(2);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptDefault, setPromptDefault] = useState("");
  const [promptMessage, setPromptMessage] = useState("");
  const [shards, setShards] = useState<Stage3CShardState[]>([]);
  const [localStatus, setLocalStatus] = useState<"unknown" | "checking" | "connected" | "offline" | "running">("unknown");
  const [localMessage, setLocalMessage] = useState("Sin conexion comprobada.");
  const [quoteProviderId, setQuoteProviderId] = useState<QuoteProviderId>(DEFAULT_QUOTE_PROVIDER_ID);
  const [workflow, setWorkflow] = useState({
    active: false,
    startedAt: null as number | null,
    elapsedMs: 0,
    percent: 0,
    phase: "idle",
    message: "Sin ejecucion 3-C activa.",
    totalItems: 0,
    approved: 0,
    completedShards: 0,
    failedShards: 0
  });

  const stage2Result = stage2Response?.result ?? null;
  const sourceItems = Array.isArray(stage2Result?.items) ? stage2Result.items.filter(isRecord) : [];
  const totalItems = sourceItems.length;
  const acceptedKeys = getStage3BAcceptedItemKeys(response);
  const approvedCount = acceptedKeys.size;
  const pendingCount = Math.max(0, totalItems - approvedCount);
  const supervisorModel = reviewProvider && reviewModel ? `${reviewProvider}:${reviewModel}` : "deepseek:deepseek-v4-pro";
  const activePromptInstruction = getUsableQuotePrompt(promptDraft, promptDefault) || [
    "Actua como un auditor de precios. Busca una fuente comercial real por item.",
    "Entrega solo la tabla Markdown solicitada, con proveedor, precio, moneda, URL y notas breves.",
    "Si no encuentras fuente defendible, deja proveedor, precio, moneda, URL y TRM vacios."
  ].join("\n");
  const plannedShardCount = Math.ceil(totalItems / Math.max(1, shardSize));
  const workflowPercent = Math.max(0, Math.min(100, Math.round(workflow.percent)));
  const elapsed = workflow.active && workflow.startedAt ? Date.now() - workflow.startedAt : workflow.elapsedMs;
  const quoteProvider = getQuoteProviderDefinition(quoteProviderId);

  useEffect(() => {
    let cancelled = false;
    async function loadPrompt() {
      try {
        const res = await fetch("/api/stage3b/prompt", { cache: "no-store" });
        const data = await res.json() as { quoteInstructionPrompt?: string; defaultQuoteInstructionPrompt?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "No se pudo cargar el prompt base.");
        const saved = typeof data.quoteInstructionPrompt === "string" ? data.quoteInstructionPrompt : "";
        const fallback = typeof data.defaultQuoteInstructionPrompt === "string" ? data.defaultQuoteInstructionPrompt : "";
        setPromptDraft(getUsableQuotePrompt(saved, fallback));
        setPromptDefault(fallback);
      } catch (error) {
        if (!cancelled) setPromptMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void loadPrompt();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workflow.active || !workflow.startedAt) return;
    const timer = window.setInterval(() => {
      setWorkflow((current) => current.active && current.startedAt
        ? { ...current, elapsedMs: Date.now() - current.startedAt }
        : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [workflow.active, workflow.startedAt]);

  async function notifyStage3C(title: string, body: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      if (permission === "granted") new Notification(title, { body });
    } catch {
      // Best effort only.
    }
  }

  async function checkLocalProvider() {
    setLocalStatus("checking");
    setLocalMessage(`Consultando ${quoteProvider.shortLabel}...`);
    try {
      const res = await fetch(getQuoteProviderUrl(quoteProviderId, "health"), { cache: "no-store" });
      const data = await res.json() as { ok?: boolean; engine?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLocalStatus("connected");
      setLocalMessage(`${quoteProvider.shortLabel} conectado${data.engine ? ` - ${data.engine}` : ""}.`);
    } catch (error) {
      setLocalStatus("offline");
      setLocalMessage(error instanceof Error ? error.message : `${quoteProvider.shortLabel} no conectado.`);
    }
  }

  function makeInitialShards(): Stage3CShardState[] {
    const entries = sourceItems.map((item, index) => ({
      key: getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1),
      item
    }));
    const chunks: Stage3CShardState[] = [];
    for (let start = 0; start < entries.length; start += shardSize) {
      const part = entries.slice(start, start + shardSize);
      const first = part[0]?.key || String(start + 1);
      const last = part[part.length - 1]?.key || String(start + part.length);
      chunks.push({
        id: `carril-${chunks.length + 1}`,
        label: `${first}-${last}`,
        itemKeys: part.map((entry) => entry.key),
        attempt: 0,
        status: "pending",
        approved: [],
        pending: part.map((entry) => entry.key),
        message: "Pendiente",
      });
    }
    return chunks;
  }

  function getShardAcceptedKeys(shard: Stage3CShardState, stage3CResponse: ApiResponse | null) {
    const accepted = getStage3BAcceptedItemKeys(stage3CResponse);
    return shard.itemKeys.filter((key) => accepted.has(key));
  }

  function getShardPackage(shard: Stage3CShardState, stage3CResponse: ApiResponse | null) {
    const shardSubset = buildStage2Subset(shard.itemKeys);
    return buildStage3BManualPackage({
      stage2Result: shardSubset,
      stage3BResponse: stage3CResponse,
      promptInstruction: activePromptInstruction,
      limit: 0,
      maxAttempts,
      runId: stage2Response?.runId
    });
  }

  function normalizeStage3CShardsForCurrentItems(currentShards: Stage3CShardState[], stage3CResponse: ApiResponse | null) {
    if (!currentShards.length) return makeInitialShards();
    const sourceKeySet = new Set(sourceItems.map((item, index) => getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1)));
    const covered = new Set(currentShards.flatMap((shard) => shard.itemKeys));
    const reusable =
      currentShards.every((shard) => shard.itemKeys.length && shard.itemKeys.every((key) => sourceKeySet.has(key)))
      && covered.size === sourceKeySet.size;
    if (!reusable) return makeInitialShards();

    return currentShards.map((shard) => {
      const approved = getShardAcceptedKeys(shard, stage3CResponse);
      const nextPackage = getShardPackage(shard, stage3CResponse);
      const pending = nextPackage.itemKeys;
      const staleRunning = shard.status === "quoting" || shard.status === "integrating";
      const status: Stage3CShardStatus = !pending.length
        ? "done"
        : staleRunning
          ? "pending"
          : shard.status;
      const message = !pending.length
        ? "Sin pendientes elegibles."
        : staleRunning
          ? "Pendiente de reintento tras interrupcion."
          : shard.message;
      return {
        ...shard,
        approved,
        pending,
        status,
        message
      };
    });
  }

  function isStage3CShardRunnable(shard: Stage3CShardState) {
    return shard.pending.length > 0;
  }

  function buildStage2Subset(itemKeys: string[]): StageResult {
    const allowed = new Set(itemKeys);
    return {
      ...(stage2Result ?? {}),
      items: sourceItems.filter((item, index) => {
        const key = getFirstItemText(item, ["Consecutivo interno", "No. item", "item"]) || String(index + 1);
        return allowed.has(key);
      })
    } as StageResult;
  }

  function updateShardState(id: string, patch: Partial<Stage3CShardState>, mutable: Stage3CShardState[]) {
    const next = mutable.map((shard) => shard.id === id ? { ...shard, ...patch } : shard);
    mutable.splice(0, mutable.length, ...next);
    setShards([...next]);
  }

  function setWorkflowProgress(partial: Partial<typeof workflow>) {
    setWorkflow((current) => ({
      ...current,
      ...partial,
      elapsedMs: typeof partial.elapsedMs === "number"
        ? partial.elapsedMs
        : current.active && current.startedAt
          ? Date.now() - current.startedAt
          : current.elapsedMs
    }));
  }

  function waitStage3C(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function recoverQuoteRawFromProvider(jobId: string, originalError: unknown) {
    let sawProviderJob = false;
    let lastMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const started = Date.now();
    const timeoutMs = 45 * 60 * 1000;

    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(getQuoteProviderUrl(quoteProviderId, "result", `jobId=${encodeURIComponent(jobId)}`), { cache: "no-store" });
        const text = await res.text();
        const data = (text.trim() ? JSON.parse(text) : {}) as {
          ok?: boolean;
          status?: string;
          step?: string;
          message?: string;
          error?: string;
          retryable?: boolean;
          rawResponse?: string;
          manualRaw?: string;
        };
        const raw = (data.rawResponse || data.manualRaw || "").trim();
        if (res.ok && data.ok && raw) return raw;

        const status = textValue(data.status);
        if (status && status !== "missing") sawProviderJob = true;
        lastMessage = textValue(data.message) || textValue(data.error) || lastMessage;
        if (res.status === 404 && !sawProviderJob) break;
        if ((status === "failed" || res.status >= 500) && data.retryable !== true) {
          throw new Error(lastMessage || `${quoteProvider.shortLabel} fallo antes de entregar resultado.`);
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
      }

      await waitStage3C(15000);
    }

    throw new Error(lastMessage || (originalError instanceof Error ? originalError.message : String(originalError)));
  }

  async function executeStage3CParallel() {
    if (!stage2Result || !sourceItems.length) {
      setLocalMessage("Etapa 3-C necesita items de Etapa 2.");
      return;
    }
    const preparedShards = normalizeStage3CShardsForCurrentItems(shards, response);
    if (!preparedShards.length) {
      setLocalMessage("Sin items para procesar.");
      return;
    }
    const runnableShards = preparedShards.filter(isStage3CShardRunnable);
    if (!runnableShards.length) {
      setShards(preparedShards);
      setLocalStatus("connected");
      setLocalMessage("Sin carriles pendientes o fallidos para reintentar.");
      setWorkflowProgress({
        active: false,
        percent: 100,
        phase: "sin_pendientes",
        message: "Sin carriles pendientes o fallidos para reintentar.",
        totalItems,
        approved: approvedCount,
        completedShards: preparedShards.filter((shard) => shard.status === "done").length,
        failedShards: preparedShards.filter((shard) => shard.status === "failed").length
      });
      return;
    }

    setShards(preparedShards);
    setLocalStatus("running");
    setLocalMessage(`Etapa 3-C iniciando ${runnableShards.length} carril(es) pendiente(s)...`);
    const startedAt = Date.now();
    setWorkflow({
      active: true,
      startedAt,
      elapsedMs: 0,
      percent: 2,
      phase: "inicio",
      message: `Preparando ${runnableShards.length} carril(es) pendientes/fallidos.`,
      totalItems,
      approved: approvedCount,
      completedShards: 0,
      failedShards: 0
    });

    let mutableStage3C: ApiResponse | null = response;
    let mutableShards = [...preparedShards];
    let nextShardIndex = 0;
    let completedShards = 0;
    let failedShards = 0;
    let integrationLock: Promise<void> = Promise.resolve();
    const targetRunId = stage2Response?.runId;

    function enqueueIntegration<T>(fn: () => Promise<T>): Promise<T> {
      const run = integrationLock.then(fn, fn);
      integrationLock = run.then(() => undefined, () => undefined);
      return run;
    }

    async function integrateRaw(shard: Stage3CShardState, packageForAttempt: ReturnType<typeof buildStage3BManualPackage>, raw: string) {
      return enqueueIntegration(async () => {
        updateShardState(shard.id, { status: "integrating", message: "Importando raw y supervisando..." }, mutableShards);
        const quotePayload = await onRun({
          action: "manual_quote",
          stage2Json: stage2Result,
          currentStage3B: mutableStage3C,
          runId: targetRunId,
          provider: "openai",
          model: quoteProvider.id,
          supervisorModel,
          maxAttempts,
          batchSize: packageForAttempt.itemKeys.length || shardSize,
          promptInstruction: activePromptInstruction,
          manualRaw: raw,
          manualItemKeys: packageForAttempt.itemKeys,
          manualPromptFinal: packageForAttempt.text || `${packageForAttempt.promptText}\n\n## Datos a procesar\n${packageForAttempt.tableText}`
        });
        if (!quotePayload || !isRecord(quotePayload) || !quotePayload.result) {
          throw new Error(textValue((quotePayload as ApiResponse | undefined)?.error) || "La app no importo el raw del carril.");
        }
        mutableStage3C = quotePayload as ApiResponse;

        const supervisedPayload = await onRun({
          action: "supervise",
          stage2Json: stage2Result,
          currentStage3B: mutableStage3C,
          runId: targetRunId,
          provider: "openai",
          model: quoteProvider.id,
          reasoningEffort: "medium",
          supervisorModel,
          maxAttempts,
          batchSize: packageForAttempt.itemKeys.length || shardSize,
          searchContextSize: "low",
          promptInstruction: activePromptInstruction
        });
        if (!supervisedPayload || !isRecord(supervisedPayload) || !supervisedPayload.result) {
          throw new Error(textValue((supervisedPayload as ApiResponse | undefined)?.error) || "El supervisor no devolvio resultado.");
        }
        mutableStage3C = supervisedPayload as ApiResponse;

        const allowed = new Set(packageForAttempt.itemKeys);
        const highConfidenceKeys = getStage3BHighConfidenceAcceptedKeys(mutableStage3C, { includeConfirmedCaution: true }).filter((key) => allowed.has(key));
        if (highConfidenceKeys.length) {
          const appliedPayload = await onRun({
            action: "apply",
            stage2Json: stage2Result,
            currentStage3B: mutableStage3C,
            runId: targetRunId,
            provider: "openai",
            model: quoteProvider.id,
            supervisorModel,
            maxAttempts,
            batchSize: packageForAttempt.itemKeys.length || shardSize,
            promptInstruction: activePromptInstruction,
            selectedItemKeys: highConfidenceKeys
          });
          if (appliedPayload && isRecord(appliedPayload) && appliedPayload.result) {
            mutableStage3C = appliedPayload as ApiResponse;
          }
        }

        const shardSubset = buildStage2Subset(shard.itemKeys);
        const nextPackage = buildStage3BManualPackage({
          stage2Result: shardSubset,
          stage3BResponse: mutableStage3C,
          promptInstruction: activePromptInstruction,
          limit: 0,
          maxAttempts,
          runId: targetRunId
        });
        const acceptedNow = Array.from(getStage3BAcceptedItemKeys(mutableStage3C)).filter((key) => shard.itemKeys.includes(key));
        updateShardState(shard.id, {
          approved: acceptedNow,
          pending: nextPackage.itemKeys,
          message: highConfidenceKeys.length
            ? `${highConfidenceKeys.length} alta confianza subida(s).`
            : "Sin altas nuevas en este intento."
        }, mutableShards);
      });
    }

    async function runOneShard(baseShard: Stage3CShardState, workerIndex: number) {
      let shard = baseShard;
      const firstAttempt = Math.max(1, Math.min(maxAttempts, (Number(baseShard.attempt) || 0) + 1));
      for (let attempt = firstAttempt; attempt <= maxAttempts; attempt += 1) {
        const shardSubset = buildStage2Subset(shard.itemKeys);
        const packageForAttempt = buildStage3BManualPackage({
          stage2Result: shardSubset,
          stage3BResponse: mutableStage3C,
          promptInstruction: activePromptInstruction,
          limit: 0,
          maxAttempts,
          runId: targetRunId
        });
        if (!packageForAttempt.itemKeys.length || !packageForAttempt.tableText) {
          updateShardState(shard.id, {
            status: "done",
            attempt: attempt - 1,
            pending: [],
            message: "Sin pendientes elegibles."
          }, mutableShards);
          return;
        }

        const jobId = `stage3c_${targetRunId || "sin_run"}_${shard.id}_a${attempt}_${Date.now()}`;
        updateShardState(shard.id, {
          status: "quoting",
          attempt,
          pending: packageForAttempt.itemKeys,
          jobId,
          message: `Worker ${workerIndex + 1}: cotizando ${packageForAttempt.itemKeys.length} item(s).`
        }, mutableShards);
        setWorkflowProgress({
          phase: "cotizando",
          message: `${shard.label}: intento ${attempt}/${maxAttempts}.`,
          percent: Math.min(94, 5 + ((completedShards + failedShards) / Math.max(1, runnableShards.length)) * 80)
        });

        let raw = "";
        try {
          const res = await fetch(getQuoteProviderUrl(quoteProviderId, "quote"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              runId: targetRunId,
              promptText: packageForAttempt.promptText,
              tableText: packageForAttempt.tableText,
              promptFinal: packageForAttempt.text || `${packageForAttempt.promptText}\n\n## Datos a procesar\n${packageForAttempt.tableText}`,
              itemKeys: packageForAttempt.itemKeys,
              maxAttempts,
              quoteProviderId
            })
          });
          const text = await res.text();
          const data = (text.trim() ? JSON.parse(text) : {}) as { ok?: boolean; rawResponse?: string; manualRaw?: string; error?: string };
          if (!res.ok || !data.ok) throw new Error(data.error || `${quoteProvider.shortLabel} HTTP ${res.status}`);
          raw = (data.rawResponse || data.manualRaw || "").trim();
        } catch (error) {
          updateShardState(shard.id, {
            message: `Conexion interrumpida; recuperando resultado de ${quoteProvider.shortLabel} por jobId...`,
            lastError: error instanceof Error ? error.message : String(error)
          }, mutableShards);
          raw = await recoverQuoteRawFromProvider(jobId, error);
          updateShardState(shard.id, {
            message: `Resultado recuperado de ${quoteProvider.shortLabel}; integrando...`,
            lastError: undefined
          }, mutableShards);
        }
        if (!raw) throw new Error(`${quoteProvider.shortLabel} no devolvio tabla Markdown.`);

        await integrateRaw(shard, packageForAttempt, raw);
        shard = mutableShards.find((entry) => entry.id === shard.id) || shard;
        if (!shard.pending.length) {
          updateShardState(shard.id, { status: "done", message: "Carril completo." }, mutableShards);
          return;
        }
      }
      updateShardState(shard.id, { status: "done", message: `${shard.pending.length} item(s) agotaron ${maxAttempts} intento(s).` }, mutableShards);
    }

    async function worker(workerIndex: number) {
      while (nextShardIndex < runnableShards.length) {
        const shard = runnableShards[nextShardIndex];
        nextShardIndex += 1;
        try {
          await runOneShard(shard, workerIndex);
          completedShards += 1;
        } catch (error) {
          failedShards += 1;
          updateShardState(shard.id, {
            status: "failed",
            lastError: error instanceof Error ? error.message : String(error),
            message: error instanceof Error ? error.message : "Fallo el carril."
          }, mutableShards);
        } finally {
          const currentAccepted = mutableStage3C ? getStage3BAcceptedItemKeys(mutableStage3C).size : approvedCount;
          setWorkflowProgress({
            approved: currentAccepted,
            completedShards,
            failedShards,
            percent: Math.min(99, 8 + ((completedShards + failedShards) / Math.max(1, runnableShards.length)) * 88),
            message: `${completedShards}/${runnableShards.length} carril(es) procesados en esta corrida; ${failedShards} con fallo.`
          });
        }
      }
    }

    try {
      await checkLocalProvider();
      await Promise.all(Array.from({ length: Math.min(concurrency, runnableShards.length) }, (_, index) => worker(index)));
      const finalAccepted = mutableStage3C ? getStage3BAcceptedItemKeys(mutableStage3C).size : approvedCount;
      const finalMessage = failedShards
        ? `Etapa 3-C cerrada con ${failedShards} carril(es) fallidos: ${finalAccepted}/${totalItems} con fuente aprobada.`
        : `Etapa 3-C terminada: ${finalAccepted}/${totalItems} con fuente aprobada.`;
      setLocalStatus("connected");
      setLocalMessage(finalMessage);
      setWorkflowProgress({
        active: false,
        elapsedMs: Date.now() - startedAt,
        percent: 100,
        phase: "terminado",
        message: finalMessage,
        approved: finalAccepted,
        completedShards,
        failedShards
      });
      if (mutableStage3C) onSetStage3C(mutableStage3C);
      void notifyStage3C(failedShards ? "Etapa 3-C con carriles fallidos" : "Etapa 3-C terminada", finalMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalStatus("offline");
      setLocalMessage(message);
      setWorkflowProgress({
        active: false,
        elapsedMs: Date.now() - startedAt,
        phase: "fallo",
        message,
        failedShards: Math.max(failedShards, 1)
      });
      void notifyStage3C("Etapa 3-C se detuvo", message);
    }
  }

  function resetStage3C() {
    if (workflow.active) return;
    setShards([]);
    onSetStage3C(null);
    setLocalMessage("Etapa 3-C reiniciada. Se conserva Etapa 2.");
    setWorkflow({
      active: false,
      startedAt: null,
      elapsedMs: 0,
      percent: 0,
      phase: "idle",
      message: "Sin ejecucion 3-C activa.",
      totalItems,
      approved: 0,
      completedShards: 0,
      failedShards: 0
    });
  }

  const resumableShardCount = shards.length
    ? normalizeStage3CShardsForCurrentItems(shards, response).filter(isStage3CShardRunnable).length
    : 0;
  const executeStage3CLabel = workflow.active
    ? "Ejecutando..."
    : shards.length && resumableShardCount > 0
      ? `Reintentar ${resumableShardCount} carril(es)`
      : shards.length
        ? "Sin carriles pendientes"
        : "Ejecutar 3-C";

  return (
    <div className={`stageTabBody stage3cPanel${isAdminMode ? "" : " standardStage3View"}`}>
      <Stage3BMasterTable
        response={response}
        displayNumberFormat={displayNumberFormat}
        copRate={copRate}
        isAdminMode={isAdminMode}
        title={isAdminMode ? "Tabla maestra 3-C" : "Tabla maestra"}
        subtitle="Carriles paralelos consolidados. Solo suben fuentes de alta confianza."
        emptyLabel="Sin resultados 3-C."
      />

      <section className="stage3CControl">
        <div className="stage3CHeader">
          <div className="stage3CProgressDonut" style={{ "--local-progress": `${workflowPercent}%` } as CSSProperties}>
            <div>
              <strong>{workflowPercent}%</strong>
              <span>{formatDuration(elapsed)}</span>
            </div>
          </div>
          <div>
            <h3>{isAdminMode ? "Etapa 3-C paralela" : "Control paralelo"}</h3>
            <p>{workflow.message}</p>
            <div className="stage3CMeta">
              <span>{totalItems.toLocaleString("es-CO")} item(s)</span>
              <span>{approvedCount.toLocaleString("es-CO")} aprobado(s)</span>
              <span>{pendingCount.toLocaleString("es-CO")} pendiente(s)</span>
              <span>{plannedShardCount.toLocaleString("es-CO")} carril(es)</span>
              {isActiveForFinancial ? <span>Activa en Etapa 4</span> : null}
            </div>
          </div>
        </div>

        <div className="stage3CControls">
          <label>
            <span>Proveedor</span>
            <select value={quoteProviderId} disabled={workflow.active} onChange={(event) => setQuoteProviderId(event.target.value as QuoteProviderId)}>
              {QUOTE_PROVIDER_DEFINITIONS.map((definition) => (
                <option key={definition.id} value={definition.id}>{definition.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Tamano de carril</span>
            <select value={String(shardSize)} disabled={workflow.active} onChange={(event) => setShardSize(Number(event.target.value))}>
              <option value="20">20 items</option>
              <option value="30">30 items</option>
              <option value="40">40 items</option>
              <option value="50">50 items</option>
            </select>
          </label>
          <label>
            <span>Paralelos</span>
            <select value={String(concurrency)} disabled={workflow.active} onChange={(event) => setConcurrency(Number(event.target.value))}>
              <option value="1">1 carril</option>
              <option value="2">2 carriles</option>
              <option value="3">3 carriles</option>
              <option value="4">4 carriles</option>
            </select>
          </label>
          <label>
            <span>Intentos por item</span>
            <select value={String(maxAttempts)} disabled={workflow.active} onChange={(event) => setMaxAttempts(Number(event.target.value))}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <button type="button" className="secondary miniButton" disabled={workflow.active} onClick={() => void checkLocalProvider()}>
            Probar proveedor
          </button>
          <button type="button" className="stageTabExportExcelBtn" disabled={!stage2Result || workflow.active || loading !== null || (shards.length > 0 && resumableShardCount === 0)} onClick={() => void executeStage3CParallel()}>
            {executeStage3CLabel}
          </button>
          {response?.result ? (
            <button type="button" className="secondary miniButton" disabled={isActiveForFinancial} onClick={onUseForFinancial}>
              {isActiveForFinancial ? "Activa en Etapa 4" : "Usar 3-C en Etapa 4"}
            </button>
          ) : null}
          <button type="button" className="secondary miniButton" disabled={workflow.active && localStatus === "running"} onClick={resetStage3C}>
            Limpiar 3-C
          </button>
        </div>

        <div className={`stage3CLocalStatus stage3CLocalStatus-${localStatus}`}>
          <strong>{quoteProvider.label}</strong>
          <span>{localMessage}</span>
        </div>

        {isAdminMode ? <details className="stage3CPromptDetails">
          <summary>Prompt base para carriles</summary>
          <textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} spellCheck={false} />
          {promptMessage ? <p className="muted">{promptMessage}</p> : null}
        </details> : null}
      </section>

      <section className="stage3CShardBoard" aria-label="Carriles Etapa 3-C">
        <div className="stage3CShardBoardHeader">
          <h4>{isAdminMode ? "Carriles fijos" : "Carriles fijos"}</h4>
          <p>Los reintentos nunca toman items de otro carril.</p>
        </div>
        {!shards.length ? (
          <p className="muted stageExperimentEmpty">Sin carriles ejecutados. Con {totalItems.toLocaleString("es-CO")} item(s), se crearan {plannedShardCount.toLocaleString("es-CO")} carril(es).</p>
        ) : (
          <div className="stage3CShardGrid">
            {shards.map((shard) => (
              <article key={shard.id} className={`stage3CShardCard stage3CShardCard-${shard.status}`}>
                <div className="stage3CShardTop">
                  <strong>{shard.label}</strong>
                  <span>{formatStage3CShardStatus(shard.status)}</span>
                </div>
                <div className="stage3CShardStats">
                  <span>{shard.itemKeys.length} item(s)</span>
                  <span>{shard.approved.length} aprob.</span>
                  <span>{shard.pending.length} pend.</span>
                  <span>Intento {shard.attempt}/{maxAttempts}</span>
                </div>
                <p>{shard.message}</p>
                {shard.jobId ? <small>{shard.jobId}</small> : null}
                {shard.lastError ? <small className="stage3CShardError">{shard.lastError}</small> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatStage3CShardStatus(status: Stage3CShardStatus) {
  if (status === "pending") return "Pendiente";
  if (status === "quoting") return "Cotizando";
  if (status === "integrating") return "Integrando";
  if (status === "done") return "Cerrado";
  if (status === "failed") return "Fallo";
  return status;
}

function Stage3BConversation({
  response,
  displayNumberFormat,
  copRate,
  loading,
  stage2Result,
  isAdminMode,
  onSuperviseLatest,
  onApplySelected,
  onLoadPromptSuggestion
}: {
  response: ApiResponse | null;
  displayNumberFormat: NumberDisplayFormat;
  copRate: number;
  loading: LoadingStage;
  stage2Result?: StageResult | null;
  isAdminMode: boolean;
  onSuperviseLatest?: () => void;
  onApplySelected?: (selectedItemKeys: string[]) => void;
  onLoadPromptSuggestion?: (prompt: string) => void;
}) {
  const attempts = getStage3BAttemptsFromResponse(response);
  const acceptedItemKeys = getStage3BAcceptedItemKeys(response);
  const cumulativeFromResult = getRecord(isRecord(response?.result) ? response.result.stage3b_cumulative : null);
  const detailCost = getRecord(response?.details?.cumulativeCost);
  const detailUsage = getRecord(response?.details?.cumulativeUsage);
  const cumulativeCost = Object.keys(detailCost).length ? detailCost : getRecord(cumulativeFromResult.cost);
  const cumulativeUsage = Object.keys(detailUsage).length ? detailUsage : getRecord(cumulativeFromResult.usage);
  const [selectedManualItems, setSelectedManualItems] = useState<Record<string, boolean>>({});
  const attemptKeys = attempts.map((attempt, index) => getStage3BAttemptKey(attempt, index));
  const attemptKeySignature = attemptKeys.join("|");
  const [activeAttemptKey, setActiveAttemptKey] = useState("");

  useEffect(() => {
    if (!attemptKeys.length) {
      if (activeAttemptKey) setActiveAttemptKey("");
      return;
    }
    if (!activeAttemptKey || !attemptKeys.includes(activeAttemptKey)) {
      setActiveAttemptKey(attemptKeys[attemptKeys.length - 1]);
    }
  }, [attemptKeySignature, activeAttemptKey]);

  function setManualSelection(itemKey: string, selected: boolean) {
    setSelectedManualItems((current) => ({ ...current, [itemKey]: selected }));
  }

  function selectManualCandidates(rows: Stage3BCandidateRow[], selected: boolean) {
    setSelectedManualItems((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (row.hasData) next[row.itemKey] = selected;
      }
      return next;
    });
  }
  if (!attempts.length) {
    return (
      <section className="stage3BConversation stage3BConversationEmpty" aria-label="Intentos Etapa 3-B">
        <h4>Intentos</h4>
        <p className="muted">Sin intentos.</p>
      </section>
    );
  }

  return (
    <section className="stage3BConversation" aria-label="Intentos Etapa 3-B">
      <div className="stage3BConversationHeader">
        <div>
          <h4>Intentos</h4>
          <p className="muted">Revisa un intento a la vez.</p>
        </div>
        <div className="stageDataToolbarMeta stageExperimentMeta">
          <span>{attempts.length.toLocaleString("es-CO")} intento(s)</span>
          {isAdminMode && typeof cumulativeUsage.totalTokens === "number" ? <span>{cumulativeUsage.totalTokens.toLocaleString("es-CO")} tokens acum.</span> : null}
          {isAdminMode && typeof cumulativeCost.totalUsd === "number" ? <span>{formatUsd(cumulativeCost.totalUsd)}{copRate > 0 ? ` / COP ${Math.round(cumulativeCost.totalUsd * copRate).toLocaleString("es-CO")}` : ""}</span> : null}
        </div>
      </div>
      <div className="stage3BAttemptTabs" role="tablist" aria-label="Intentos Etapa 3-B">
        {attempts.map((attempt, index) => {
          const attemptKey = attemptKeys[index];
          const usage = getRecord(attempt.pricingUsage);
          const status = textValue(attempt.status) || "pendiente";
          const requestedKeys = Array.isArray(attempt.requestedItemKeys) ? attempt.requestedItemKeys : [];
          const attemptRows = extractStage3BCandidateRows(attempt);
          const attemptRowsWithData = attemptRows.filter((row) => row.hasData).length;
          const attemptSuggestedRows = attemptRows.filter((row) => row.recommended && row.hasData).length;
          const active = attemptKey === activeAttemptKey;
          return (
            <button
              key={attemptKey}
              type="button"
              role="tab"
              aria-selected={active}
              className={`stage3BAttemptTab${active ? " stage3BAttemptTabActive" : ""}`}
              onClick={() => setActiveAttemptKey(attemptKey)}
            >
              <strong>Intento {textValue(attempt.attempt) || index + 1}</strong>
              <span>{formatStage3BAttemptStatus(status)}</span>
              <small>
                {requestedKeys.length.toLocaleString("es-CO")} item(s) - {attemptRowsWithData.toLocaleString("es-CO")} con datos
                {attemptSuggestedRows ? ` - ${attemptSuggestedRows.toLocaleString("es-CO")} sugerido(s)` : ""}
                {isAdminMode && typeof usage.totalTokens === "number" ? ` - ${usage.totalTokens.toLocaleString("es-CO")} tok` : ""}
              </small>
            </button>
          );
        })}
      </div>
      <div className="stage3BAttemptPane">
        {attempts.map((attempt, index) => {
          const attemptKey = attemptKeys[index];
          if (attemptKey !== activeAttemptKey) return null;
          const pricingDetails = getRecord(attempt.pricingDetails);
          const promptText = textValue(attempt.promptFinal) || textValue(pricingDetails.promptText) || textValue(attempt.promptInstruction);
          const rawText = textValue(attempt.raw);
          const markdownRows = parseMarkdownTableForUi(rawText);
          const supervisor = getRecord(attempt.supervisor);
          const decisions = Array.isArray(supervisor.decisions) ? supervisor.decisions.filter(isRecord) : [];
          const decisionRows = decisions.map((decision) => ({
            Item: textValue(decision.itemKey),
            Estado: textValue(decision.status),
            Aceptado: decision.accepted === true ? "Si" : "No",
            Confianza: textValue(decision.confidence),
            Accion: textValue(decision.nextAction),
            Comentario: textValue(decision.comment)
          }));
          const candidateRows = extractStage3BCandidateRows(attempt);
          const selectedCount = candidateRows.filter((row) => row.hasData && selectedManualItems[row.itemKey]).length;
          const usage = getRecord(attempt.pricingUsage);
          const cost = getRecord(attempt.pricingCost);
          const status = textValue(attempt.status) || "pendiente";
          const isLatestAttempt = index === attempts.length - 1;
          const nextPromptInstruction = textValue(supervisor.nextPromptInstruction);
          const requestedKeys = Array.isArray(attempt.requestedItemKeys) ? attempt.requestedItemKeys : [];
          const technicalDetails = (
            <>
              <details className="jsonDetails stage3BDetails">
                <summary className="stage3BCompactSummary">
                  <span>Prompt</span>
                  <span>{promptText ? `${promptText.length.toLocaleString("es-CO")} caracteres` : "sin prompt"}</span>
                </summary>
                <pre className="stage3ReviewPre">{promptText || "Prompt no disponible en este intento."}</pre>
              </details>

              <details className="jsonDetails stage3BDetails">
                <summary className="stage3BCompactSummary">
                  <span>Respuesta cruda</span>
                  <span>{rawText ? `${rawText.length.toLocaleString("es-CO")} caracteres` : "sin raw"}</span>
                </summary>
                <pre className="stage3ReviewPre">{truncateTextForUi(rawText || "Sin raw guardado.")}</pre>
              </details>

              <details className="jsonDetails stage3BDetails stage3BParsedResultStep">
                <summary className="stage3BCompactSummary">
                  <span>Tabla interpretada</span>
                  <span>{markdownRows.length ? `${markdownRows.length.toLocaleString("es-CO")} fila(s)` : "sin tabla clara"}</span>
                </summary>
                {markdownRows.length ? (
                  <div className="stage3BMarkdownPreview">
                    <DynamicTable items={markdownRows} numberFormat={displayNumberFormat} />
                  </div>
                ) : (
                  <p className="muted">Sin tabla Markdown clara.</p>
                )}
              </details>

              <Stage3BAttemptTools
                attempt={attempt}
                stage2Result={stage2Result ?? null}
                runId={response?.runId ?? null}
                loading={loading}
                displayNumberFormat={displayNumberFormat}
                onSuperviseLatest={status === "quoted" && isLatestAttempt ? onSuperviseLatest : undefined}
              />

              {nextPromptInstruction ? (
                <details className="jsonDetails stage3BDetails stage3BNextPromptDetails">
                  <summary className="stage3BCompactSummary">
                    <span>Siguiente prompt</span>
                    <span>{nextPromptInstruction.length.toLocaleString("es-CO")} caracteres</span>
                  </summary>
                  <pre className="stage3ReviewPre">{nextPromptInstruction}</pre>
                  {onLoadPromptSuggestion ? (
                    <button type="button" className="secondary miniButton" onClick={() => onLoadPromptSuggestion(nextPromptInstruction)}>
                      Cargar prompt
                    </button>
                  ) : null}
                </details>
              ) : null}

              <details className="jsonDetails stage3BDetails stage3BSupervisorDetails">
                <summary className="stage3BCompactSummary">
                  <span>Supervisor: detalle técnico</span>
                  <span>{decisionRows.length ? `${decisionRows.length.toLocaleString("es-CO")} decision(es)` : "sin supervisor"}</span>
                </summary>
                {textValue(attempt.supervisorError) ? <div className="error stageExperimentError">{textValue(attempt.supervisorError)}</div> : null}
                {decisionRows.length ? <DynamicTable items={decisionRows} numberFormat={displayNumberFormat} /> : <p className="muted">Sin supervisor guardado.</p>}
                {textValue(supervisor.raw) ? <pre className="stage3ReviewPre">{truncateTextForUi(textValue(supervisor.raw))}</pre> : null}
              </details>
            </>
          );
          return (
            <article className="stage3BAttempt stage3BAttemptActivePane" key={attemptKey}>
              <div className="stage3BAttemptHeader">
                <div>
                  <strong>Intento {textValue(attempt.attempt) || index + 1}</strong>
                  <span className={`stage3BAttemptStatus stage3BAttemptStatus-${normalizeLabel(status)}`}>{formatStage3BAttemptStatus(status)}</span>
                </div>
                <div className="stageDataToolbarMeta stageExperimentMeta">
                  <span>{requestedKeys.length.toLocaleString("es-CO")} item(s)</span>
                  <span>{getModelDisplayName(textValue(attempt.model))}</span>
                  {isAdminMode && typeof usage.totalTokens === "number" ? <span>{usage.totalTokens.toLocaleString("es-CO")} tokens</span> : null}
                  {isAdminMode && typeof cost.totalUsd === "number" ? <span>{formatUsd(cost.totalUsd)}</span> : null}
                </div>
              </div>
              {status === "quoted" && isLatestAttempt ? (
                <div className="stage3BAttemptNextAction">
                  <strong>Pendiente</strong>
                  <span>Verifica este intento antes de continuar.</span>
                </div>
              ) : null}
              {!isAdminMode && status === "quoted" && isLatestAttempt && onSuperviseLatest ? (
                <div className="stage3BAttemptPrimaryAction stage3BAttemptPrimaryActionVisible">
                  <button
                    type="button"
                    className="stageTabExportExcelBtn"
                    disabled={loading === "stage3"}
                    onClick={onSuperviseLatest}
                  >
                    {loading === "stage3" ? "Procesando..." : "Supervisar e integrar"}
                  </button>
                  <span className="muted">El supervisor revisa este intento y actualiza la tabla maestra.</span>
                </div>
              ) : null}
              {isAdminMode ? <>
              <details className="jsonDetails stage3BDetails">
                <summary className="stage3BCompactSummary">
                  <span>Prompt</span>
                  <span>{promptText ? `${promptText.length.toLocaleString("es-CO")} caracteres` : "sin prompt"}</span>
                </summary>
                <pre className="stage3ReviewPre">{promptText || "Prompt no disponible en este intento."}</pre>
              </details>

              <details className="jsonDetails stage3BDetails">
                <summary className="stage3BCompactSummary">
                  <span>Respuesta cruda</span>
                  <span>{rawText ? `${rawText.length.toLocaleString("es-CO")} caracteres` : "sin raw"}</span>
                </summary>
                <pre className="stage3ReviewPre">{truncateTextForUi(rawText || "Sin raw guardado.")}</pre>
              </details>

              <details className="jsonDetails stage3BDetails stage3BParsedResultStep">
                <summary className="stage3BCompactSummary">
                  <span>Tabla interpretada</span>
                  <span>{markdownRows.length ? `${markdownRows.length.toLocaleString("es-CO")} fila(s)` : "sin tabla clara"}</span>
                </summary>
                {markdownRows.length ? (
                  <div className="stage3BMarkdownPreview">
                    <DynamicTable items={markdownRows} numberFormat={displayNumberFormat} />
                  </div>
                ) : (
                  <p className="muted">Sin tabla Markdown clara.</p>
                )}
              </details>

              <Stage3BAttemptTools
                attempt={attempt}
                stage2Result={stage2Result ?? null}
                runId={response?.runId ?? null}
                loading={loading}
                displayNumberFormat={displayNumberFormat}
                onSuperviseLatest={status === "quoted" && isLatestAttempt ? onSuperviseLatest : undefined}
              />
              </> : null}

              {candidateRows.length ? (
                <Stage3BAttemptReviewTable
                  rows={candidateRows}
                  acceptedItemKeys={acceptedItemKeys}
                  selectedManualItems={selectedManualItems}
                  selectedCount={selectedCount}
                  loading={loading}
                  onSelectRow={setManualSelection}
                  onSelectRows={selectManualCandidates}
                  onApplySelected={onApplySelected}
                />
              ) : null}

              {!isAdminMode ? (
                <details className="stage3BStandardTechnicalGroup">
                  <summary className="stage3BCompactSummary">
                    <span>Detalles tecnicos del intento</span>
                    <span>prompt, raw, tabla interpretada, herramientas y JSON</span>
                  </summary>
                  {technicalDetails}
                </details>
              ) : null}

              {isAdminMode ? <>
              {nextPromptInstruction ? (
                <details className="jsonDetails stage3BDetails stage3BNextPromptDetails">
                  <summary className="stage3BCompactSummary">
                    <span>Siguiente prompt</span>
                    <span>{nextPromptInstruction.length.toLocaleString("es-CO")} caracteres</span>
                  </summary>
                  <pre className="stage3ReviewPre">{nextPromptInstruction}</pre>
                  {onLoadPromptSuggestion ? (
                    <button type="button" className="secondary miniButton" onClick={() => onLoadPromptSuggestion(nextPromptInstruction)}>
                      Cargar prompt
                    </button>
                  ) : null}
                </details>
              ) : null}

              <details className="jsonDetails stage3BDetails stage3BSupervisorDetails">
                <summary className="stage3BCompactSummary">
                  <span>Supervisor: detalle técnico</span>
                  <span>{decisionRows.length ? `${decisionRows.length.toLocaleString("es-CO")} decision(es)` : "sin supervisor"}</span>
                </summary>
                {textValue(attempt.supervisorError) ? <div className="error stageExperimentError">{textValue(attempt.supervisorError)}</div> : null}
                {decisionRows.length ? <DynamicTable items={decisionRows} numberFormat={displayNumberFormat} /> : <p className="muted">Sin supervisor guardado.</p>}
                {textValue(supervisor.raw) ? <pre className="stage3ReviewPre">{truncateTextForUi(textValue(supervisor.raw))}</pre> : null}
              </details>
              </> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getStage3BAttemptKey(attempt: Record<string, unknown>, index: number) {
  return textValue(attempt.id) || `${textValue(attempt.attempt) || index + 1}-${index}`;
}

type Stage3BAuditAction = "domains" | "evidence" | "googleUrl" | "supervisor";

const STAGE3B_AUDIT_TOOLS: Array<{ action: Stage3BAuditAction; label: string; description: string }> = [
  { action: "domains", label: "Dominios", description: "Si/no: el dominio existe." },
  { action: "evidence", label: "Links", description: "Si/no: el link abre." },
  { action: "googleUrl", label: "URL Context", description: "Si/no: Google pudo leer la URL." },
  { action: "supervisor", label: "Supervisor", description: "Resume confianza y decisión." }
];

function Stage3BAttemptTools({
  attempt,
  stage2Result,
  runId,
  loading,
  displayNumberFormat,
  onSuperviseLatest
}: {
  attempt: Record<string, unknown>;
  stage2Result?: StageResult | null;
  runId?: string | null;
  loading: LoadingStage;
  displayNumberFormat: NumberDisplayFormat;
  onSuperviseLatest?: () => void;
}) {
  const [auditBusy, setAuditBusy] = useState<Stage3BAuditAction | null>(null);
  const [auditResults, setAuditResults] = useState<Partial<Record<Stage3BAuditAction, Record<string, unknown>>>>({});
  const [auditErrors, setAuditErrors] = useState<Partial<Record<Stage3BAuditAction, string>>>({});
  const pricingResult = getRecord(attempt.pricingResult);
  const rawText = textValue(attempt.raw);
  const hasPricingResult = Object.keys(pricingResult).length > 0;
  const storedSupervisor = getRecord(attempt.supervisor);
  const storedSupervision = getRecord(storedSupervisor.supervision);
  const storedEvidence = Array.isArray(storedSupervisor.evidence) ? storedSupervisor.evidence.filter(isRecord) : [];
  const storedEvidenceSummary = getRecord(storedSupervisor.evidenceSummary);
  const storedUrlContext = getRecord(storedSupervisor.urlContextResult);
  const requestedKeysForAudit = Array.isArray(attempt.requestedItemKeys) ? attempt.requestedItemKeys : [];
  const candidateRowsForAudit = extractStage3BCandidateRows(attempt);
  const auditMaxSources = Math.min(
    Math.max(requestedKeysForAudit.length, candidateRowsForAudit.filter((row) => row.hasData).length, 4),
    120
  );

  useEffect(() => {
    if (!Object.keys(storedSupervision).length && !storedEvidence.length) return;
    setAuditResults((current) => ({
      ...current,
      evidence: current.evidence ?? {
        action: "evidence",
        ok: true,
        evidence: storedEvidence,
        summary: getRecord(storedEvidenceSummary.source) || storedEvidenceSummary,
        evidenceSummary: storedEvidenceSummary
      },
      googleUrl: current.googleUrl ?? (Object.keys(storedUrlContext).length ? {
        action: "googleUrl",
        ok: true,
        result: storedUrlContext
      } : undefined),
      supervisor: current.supervisor ?? {
        action: "supervisor",
        ok: true,
        evidence: storedEvidence,
        evidenceSummary: storedEvidenceSummary,
        supervision: storedSupervision,
        rawPreview: textValue(storedSupervisor.raw)
      }
    }));
  }, [attempt, storedEvidence.length, storedEvidenceSummary, storedSupervision, storedSupervisor.raw, storedUrlContext]);

  async function runAttemptAudit(action: Stage3BAuditAction) {
    if (!hasPricingResult && !rawText) {
      setAuditErrors((current) => ({ ...current, [action]: "Este intento no tiene resultado crudo suficiente para verificar." }));
      return;
    }
    setAuditBusy(action);
    setAuditErrors((current) => ({ ...current, [action]: undefined }));
    try {
      const apiAction = action === "domains" ? "domainEvidence" : action === "evidence" ? "linkEvidence" : action === "googleUrl" ? "googleUrlContext" : "sourceSupervisor";
      const linkEvidence = auditResults.evidence && Array.isArray(auditResults.evidence.evidence) ? auditResults.evidence.evidence : undefined;
      const domainEvidence = auditResults.domains && Array.isArray(auditResults.domains.evidence) ? auditResults.domains.evidence : undefined;
      const existingEvidence = linkEvidence ?? domainEvidence;
      const urlContextResult = auditResults.googleUrl?.result ?? auditResults.googleUrl;
      const res = await fetch("/api/stage3-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apiAction,
          stage2Json: stage2Result ?? null,
          stage3Result: hasPricingResult ? pricingResult : null,
          rawText,
          evidence: action === "supervisor" ? existingEvidence : undefined,
          urlContextResult: action === "supervisor" ? urlContextResult : undefined,
          maxSources: action === "googleUrl" ? Math.min(auditMaxSources, 80) : auditMaxSources,
          model: action === "googleUrl" ? "gemini:gemini-2.5-pro" : action === "supervisor" ? "deepseek:deepseek-v4-pro" : undefined,
          runId: runId ?? null
        })
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setAuditErrors((current) => ({ ...current, [action]: typeof data.error === "string" ? data.error : "Verificacion fallo (HTTP " + res.status + ")." }));
        return;
      }
      setAuditResults((current) => ({ ...current, [action]: { action, ...data } }));
      setAuditErrors((current) => ({ ...current, [action]: undefined }));
    } catch (error) {
      setAuditErrors((current) => ({ ...current, [action]: error instanceof Error ? error.message : "Fallo inesperado verificando este intento." }));
    } finally {
      setAuditBusy(null);
    }
  }

  const matrixRows = STAGE3B_AUDIT_TOOLS.map((tool) => {
    const result = auditResults[tool.action];
    const stats = summarizeStage3BAuditToolResult(result);
    const error = auditErrors[tool.action];
    return {
      "Paso": tool.label,
      "Pregunta": stats.question,
      "Estado": auditBusy === tool.action ? "en curso" : error ? "error" : result ? "listo" : "pendiente",
      "Revisadas": stats.inspected,
      "Si": stats.yes,
      "No": stats.no,
      "No eval.": stats.unknown
    };
  });
  const hasAnyAuditResult = STAGE3B_AUDIT_TOOLS.some((tool) => Boolean(auditResults[tool.action] || auditErrors[tool.action]));
  const toolsCompleted = matrixRows.filter((row) => row.Estado === "listo").length;
  const toolsYes = matrixRows.reduce((total, row) => total + (Number(row.Si) || 0), 0);
  const toolsNo = matrixRows.reduce((total, row) => total + (Number(row.No) || 0), 0);
  const toolsMeta = auditBusy
    ? `corriendo ${STAGE3B_AUDIT_TOOLS.find((tool) => tool.action === auditBusy)?.label ?? "herramienta"}`
    : hasAnyAuditResult
      ? `${toolsCompleted}/${STAGE3B_AUDIT_TOOLS.length} listas · ${toolsYes} si · ${toolsNo} no`
      : onSuperviseLatest
        ? "pendiente de verificacion"
        : "sin acciones manuales";

  return (
    <details className="stage3BAttemptStep stage3BAttemptTools" aria-label="Herramientas del intento 3-B">
      <summary className="stage3BCompactSummary">
        <span>Verificación</span>
        <span>{toolsMeta}</span>
      </summary>
      <div className="stage3BStepHeader">
        <strong>Verificación</strong>
        <span>Señales binarias para que el supervisor decida.</span>
      </div>
      {onSuperviseLatest ? (
        <div className="stage3BAttemptPrimaryAction">
          <button
            type="button"
            className="stageTabExportExcelBtn"
            disabled={auditBusy !== null || loading === "stage3"}
            onClick={onSuperviseLatest}
          >
            {loading === "stage3" ? "Procesando..." : "Verificar e integrar"}
          </button>
          <span className="muted">Guarda la decisión en la tabla maestra.</span>
        </div>
      ) : null}
      <details className="jsonDetails stage3BDetails">
        <summary>Herramientas manuales</summary>
        <div className="stage3BAttemptToolsBar">
          <span className="muted">Diagnóstico puntual:</span>
          {STAGE3B_AUDIT_TOOLS.map((tool) => (
            <button
              key={tool.action}
              type="button"
              className={tool.action === "supervisor" ? "stageTabExportExcelBtn" : "secondary miniButton"}
              disabled={auditBusy !== null || loading === "stage3"}
              onClick={() => void runAttemptAudit(tool.action)}
              title={tool.description}
            >
              {auditBusy === tool.action ? "Procesando..." : tool.label}
            </button>
          ))}
        </div>
      </details>
      {auditBusy ? <p className="muted stage3BAttemptToolsStatus">Ejecutando {STAGE3B_AUDIT_TOOLS.find((tool) => tool.action === auditBusy)?.label}...</p> : null}
      {hasAnyAuditResult || auditBusy ? (
        <div className="stage3BAuditMatrix">
          <DynamicTable items={matrixRows} numberFormat={displayNumberFormat} />
        </div>
      ) : null}
      <div className="stage3BAuditResultStack">
        {STAGE3B_AUDIT_TOOLS.map((tool) => {
          const result = auditResults[tool.action];
          const error = auditErrors[tool.action];
          if (!result && !error) return null;
          const stats = summarizeStage3BAuditToolResult(result);
          return (
            <details className="jsonDetails stage3BDetails" key={tool.action}>
              <summary className="stage3BCompactSummary">
                <span>{tool.label}: resultado</span>
                <span>{error ? "error" : `${stats.inspected} rev. · ${stats.yes} si · ${stats.no} no`}</span>
              </summary>
              {error ? <div className="error stageExperimentError">{error}</div> : null}
              {result ? <AuditHumanSummary data={result} /> : null}
              {result ? (
                <details className="jsonDetails stage3BDetails">
                  <summary>JSON tecnico de esta verificacion</summary>
                  <pre className="stage3ReviewPre">{JSON.stringify(result, null, 2)}</pre>
                </details>
              ) : null}
            </details>
          );
        })}
      </div>
    </details>
  );
}

function summarizeStage3BAuditToolResult(result?: Record<string, unknown>) {
  if (!result) return { inspected: "-", yes: "-", no: "-", unknown: "-", question: "-", comment: "" };
  const action = textValue(result.action);
  const resultRecord = getRecord(result.result);
  const summary = getRecord(result.summary) || getRecord(result.evidenceSummary) || getRecord(resultRecord.resumen) || getRecord(getRecord(result.supervision).resumen);
  const supervision = getRecord(result.supervision);
  const supervisorSummary = getRecord(supervision.resumen);
  const evidence = Array.isArray(result.evidence) ? result.evidence.filter(isRecord) : [];
  const sourceRows = buildAuditSourceRows(result);
  const fallbackInspected = evidence.length || sourceRows.length;
  const inspected = Number(summary.inspectedSources ?? summary.fuentes_validadas ?? supervisorSummary.fuentes_evaluadas ?? fallbackInspected) || fallbackInspected;
  let question = "Senal principal";
  let counts = { yes: 0, no: 0, unknown: 0 };
  if (action === "domains") {
    question = "Dominio resuelve";
    counts = countEvidenceSignal(evidence, "dominio_resuelve");
  } else if (action === "evidence") {
    question = "Link abre";
    counts = countEvidenceSignal(evidence, "link_abre");
  } else if (action === "googleUrl") {
    question = "Google lee URL";
    const googleSources = Array.isArray(resultRecord.fuentes) ? resultRecord.fuentes.filter(isRecord) : [];
    counts = countRecordSignal(googleSources, "url_leida");
  } else if (action === "supervisor") {
    question = "Precio sustentado";
    const supervisorSources = Array.isArray(supervision.fuentes) ? supervision.fuentes.filter(isRecord) : [];
    counts = countSupervisorSupport(supervisorSources);
  }
  const comment = textValue(supervisorSummary.comentario) || buildAuditComment(action, summary, evidence);
  return {
    inspected: inspected ? inspected.toLocaleString("es-CO") : "0",
    yes: counts.yes ? counts.yes.toLocaleString("es-CO") : "0",
    no: counts.no ? counts.no.toLocaleString("es-CO") : "0",
    unknown: counts.unknown ? counts.unknown.toLocaleString("es-CO") : "0",
    question,
    comment
  };
}

function countEvidenceSignal(evidence: Record<string, unknown>[], key: string) {
  const rows = evidence.map((item) => getRecord(item.toolSignals)).filter((signals) => Object.keys(signals).length > 0);
  return countRecordSignal(rows, key);
}

function countRecordSignal(rows: Record<string, unknown>[], key: string) {
  let yes = 0;
  let no = 0;
  let unknown = 0;
  for (const row of rows) {
    const value = textValue(row[key]).toLowerCase();
    if (value === "si" || value === "true" || value === "verificada") yes += 1;
    else if (value === "no" || value === "false" || value === "error" || value === "bloqueada") no += 1;
    else unknown += 1;
  }
  return { yes, no, unknown };
}

function countSupervisorSupport(rows: Record<string, unknown>[]) {
  let yes = 0;
  let no = 0;
  let unknown = 0;
  for (const row of rows) {
    const state = textValue(row.estado);
    if (state === "precio_confirmado" || state === "precio_confirmado_url_corregida" || state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica" || state === "ok" || state === "benchmark_util") yes += 1;
    else if (state === "producto_no_corresponde" || state === "sin_fuente" || state === "no_corresponde") no += 1;
    else unknown += 1;
  }
  return { yes, no, unknown };
}

type Stage3BCandidateRow = {
  itemKey: string;
  name: string;
  description: string;
  unit: string;
  quantity: string;
  ceiling: string;
  provider: string;
  price: string;
  currency: string;
  url: string;
  notes: string;
  systemSignals: string[];
  supervisorStatus: string;
  supervisorConfidence: string;
  supervisorComment: string;
  supervisorAction: string;
  recommended: boolean;
  hasData: boolean;
};

type Stage3BLocalWorkflowState = {
  active: boolean;
  startedAt: number | null;
  elapsedMs: number;
  percent: number;
  cycle: number;
  maxCycles: number;
  sentItems: number;
  autoApplied: number;
  pending: number;
  phase: string;
  message: string;
  completed: boolean;
  failed: boolean;
};

const INITIAL_STAGE3B_LOCAL_WORKFLOW: Stage3BLocalWorkflowState = {
  active: false,
  startedAt: null,
  elapsedMs: 0,
  percent: 0,
  cycle: 0,
  maxCycles: 3,
  sentItems: 0,
  autoApplied: 0,
  pending: 0,
  phase: "idle",
  message: "Sin ejecucion local activa.",
  completed: false,
  failed: false
};

function formatStage3BAttemptStatus(status: string) {
  const normalized = normalizeLabel(status);
  if (normalized === "quoted") return "Cotizado";
  if (normalized === "supervised") return "Verificado";
  if (normalized === "supervisor_failed") return "Supervisor falló";
  if (normalized === "failed") return "Falló";
  if (normalized === "pending") return "Pendiente";
  return status || "Pendiente";
}

function cleanStage3BSourceField(value: unknown) {
  const text = textValue(value).trim();
  if (!text) return "";
  const normalized = normalizeLabel(text).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (/^-+(\s+-+)*$/.test(text)) return "";
  if (
    normalized === "sin_proveedor"
    || normalized === "sin_precio"
    || normalized === "sin_url"
    || normalized === "sin_fuente"
    || normalized === "sin_datos"
    || normalized === "no_aplica"
    || normalized === "n_a"
    || normalized === "na"
  ) {
    return "";
  }
  return text;
}

function getStage3BConfidenceLabel(row: Stage3BCandidateRow) {
  if (!row.hasData) return "Sin datos";
  const signal = normalizeLabel([row.supervisorConfidence, row.supervisorStatus, row.supervisorAction].filter(Boolean).join(" "));
  if (!signal && !row.supervisorComment) return "Sin datos";
  if ((signal.includes("sin_fuente") || signal.includes("sin_datos")) && !row.provider && !row.price && !row.url) return "Sin datos";
  if (
    signal.includes("baja")
    || signal.includes("rescatable")
    || signal.includes("precio_sin_confirmar")
    || signal.includes("fuente_sin_url")
    || signal.includes("url_no_verificable")
    || signal.includes("referencia_tecnica")
    || signal.includes("dudoso")
    || signal.includes("no_corresponde")
    || signal.includes("error")
    || signal.includes("rechazar")
    || signal.includes("descartar")
  ) return "Baja";
  if (signal.includes("cautela") || signal.includes("fuente_real_url_no_canonica") || signal.includes("benchmark") || signal.includes("media")) return "Media";
  if (signal.includes("alta") || signal.includes("precio_confirmado") || signal.includes("ok") || signal.includes("aceptar")) return "Alta";
  return "Baja";
}

function getStage3BConfidenceTone(label: string) {
  const normalized = normalizeLabel(label);
  if (normalized.includes("alta")) return "Alta";
  if (normalized.includes("media")) return "Media";
  if (normalized.includes("baja")) return "Baja";
  return "SinDatos";
}

function getStage3BDecisionLabel(row: Stage3BCandidateRow, confidenceLabel: string) {
  if (!row.hasData) return "Sin datos";
  if (confidenceLabel === "Baja") return "No usar";
  if (row.recommended) return "Sirve";
  if (confidenceLabel === "Alta") return "Sirve";
  if (confidenceLabel === "Media") return "Revisar";
  return "Revisar";
}

function getStage3BDecisionTone(label: string) {
  const normalized = normalizeLabel(label);
  if (normalized.includes("sirve")) return "Sirve";
  if (normalized.includes("no_usar")) return "NoUsar";
  if (normalized.includes("sin_datos")) return "SinDatos";
  return "Revisar";
}

function extractStage3BCandidateRows(attempt: Record<string, unknown>): Stage3BCandidateRow[] {
  const pricingResult = getRecord(attempt.pricingResult);
  const items = Array.isArray(pricingResult.items) ? pricingResult.items.filter(isRecord) : [];
  const supervisor = getRecord(attempt.supervisor);
  const decisions = Array.isArray(supervisor.decisions) ? supervisor.decisions.filter(isRecord) : [];
  const decisionsByKey = new Map(decisions.map((decision) => [textValue(decision.itemKey), decision]));
  const supervision = getRecord(supervisor.supervision);
  const supervisedSources = Array.isArray(supervision.fuentes) ? supervision.fuentes.filter(isRecord) : [];
  const supervisedByKey = new Map<string, Record<string, unknown>>();
  for (const source of supervisedSources) {
    const sourceId = textValue(source.sourceId);
    const sourceItemKey = textValue(source.itemKey);
    if (sourceId) supervisedByKey.set(sourceId, source);
    if (sourceItemKey) supervisedByKey.set(sourceItemKey, source);
  }
  const evidenceRows = Array.isArray(supervisor.evidence) ? supervisor.evidence.filter(isRecord) : [];
  const evidenceByKey = new Map<string, Record<string, unknown>>();
  for (const evidence of evidenceRows) {
    const sourceId = textValue(evidence.sourceId);
    const sourceItemKey = textValue(evidence.itemKey);
    if (sourceId) evidenceByKey.set(sourceId, evidence);
    if (sourceItemKey) evidenceByKey.set(sourceItemKey, evidence);
  }
  return items.map((item, index) => {
    const itemKey = textValue(item["Consecutivo interno"]) || textValue(item["No. item"]) || String(index + 1);
    const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isRecord) : [];
    const quote = quotes[0] || {};
    const fuente = getRecord(quote.fuente);
    const precio = getRecord(quote.precio);
    const defensa = getRecord(quote.defensa);
    const sourceId = `${itemKey}#1`;
    const decision = decisionsByKey.get(itemKey);
    const supervised = supervisedByKey.get(sourceId) || supervisedByKey.get(itemKey) || {};
    const evidence = evidenceByKey.get(sourceId) || evidenceByKey.get(itemKey) || {};
    const provider = cleanStage3BSourceField(fuente.nombre);
    const url = cleanStage3BSourceField(fuente.url);
    const price = cleanStage3BSourceField(precio.texto_original) || cleanStage3BSourceField(precio.valor);
    const currency = cleanStage3BSourceField(precio.moneda);
    const notes = textValue(quote.evidencia_corta) || textValue(defensa.justificacion) || textValue(item["Notas del item"]) || textValue(item["Resumen de cotizacion"]);
    const name = textValue(item["Nombre o descripcion"]) || textValue(item["Nombre o descripción"]) || textValue(item["Nombre"]) || textValue(getRecord(item["Datos originales"])["Nombre o descripcion"]) || textValue(getRecord(item["Datos originales"])["Nombre o descripción"]);
    const displayName = name || getFirstItemText(item, ["Nombre o descripción", "Nombre o descripcion", "Nombre o descripci?n", "Nombre", "name", "nombre"]);
    return {
      itemKey,
      name: displayName,
      description: getFirstItemText(item, ["Detalles o ficha técnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "Ficha técnica", "Ficha tecnica", "description", "descripcion"]),
      unit: getFirstItemText(item, ["Und de medida", "Und", "unit", "unidad"]),
      quantity: getFirstItemText(item, ["Cant", "quantity", "cantidad"]),
      ceiling: getFirstItemText(item, ["Precio techo encontrado", "Precio techo unitario", "Precio techo", "ceiling_unit_price", "precio_techo"]),
      provider,
      price,
      currency,
      url,
      notes,
      systemSignals: buildStage3BSignalNotes(evidence),
      supervisorStatus: textValue(decision?.status) || textValue(supervised.estado),
      supervisorConfidence: textValue(decision?.confidence) || textValue(supervised.confianza),
      supervisorComment: textValue(supervised.comentario) || textValue(decision?.comment),
      supervisorAction: textValue(decision?.nextAction) || textValue(supervised.accion_sugerida),
      recommended: decision?.accepted === true,
      hasData: Boolean(provider || url || price)
    };
  });
}

function buildStage3BSignalNotes(evidence: Record<string, unknown>): string[] {
  const signals = getRecord(evidence.toolSignals);
  const rescue = getRecord(evidence.rescueSearch);
  const parts: string[] = [];
  const domain = textValue(signals.dominio_resuelve || signals.domainResolved);
  const link = textValue(signals.link_abre || signals.urlOpened);
  const price = textValue(signals.precio_visible || signals.priceFoundInPage);
  const product = textValue(signals.producto_en_pagina || signals.technicalTokenHit);
  if (domain) parts.push(`Dominio: ${formatSignalValue(domain)}`);
  if (link) parts.push(`Link: ${formatSignalValue(link)}`);
  if (price) parts.push(`Precio visible: ${formatSignalValue(price)}`);
  if (product) parts.push(`Producto: ${formatSignalValue(product)}`);
  if (rescue.attempted === true) parts.push(`Rescate URL: ${rescue.urlOpened ? "sí" : "no"}`);
  if (!parts.length && Object.keys(evidence).length) {
    const status = textValue(evidence.status);
    if (status) parts.push(`Lectura: ${status}`);
  }
  return parts;
}

function formatSignalValue(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "si" || normalized === "sí" || normalized === "ok") return "sí";
  if (normalized === "false" || normalized === "no" || normalized === "error") return "no";
  if (normalized === "no_evaluable" || normalized === "not_evaluable" || normalized === "n/a") return "no verificable";
  if (normalized === "missing_url") return "sin enlace";
  return value;
}

function Stage3BAttemptReviewTable({
  rows,
  acceptedItemKeys,
  selectedManualItems,
  selectedCount,
  loading,
  onSelectRow,
  onSelectRows,
  onApplySelected
}: {
  rows: Stage3BCandidateRow[];
  acceptedItemKeys: Set<string>;
  selectedManualItems: Record<string, boolean>;
  selectedCount: number;
  loading: LoadingStage;
  onSelectRow: (itemKey: string, selected: boolean) => void;
  onSelectRows: (rows: Stage3BCandidateRow[], selected: boolean) => void;
  onApplySelected?: (selectedItemKeys: string[]) => void;
}) {
  const visibleRows = rows.filter((row) => !acceptedItemKeys.has(row.itemKey));
  const hiddenAppliedRows = rows.length - visibleRows.length;
  const rowsWithData = visibleRows.filter((row) => row.hasData);
  const recommendedRows = visibleRows.filter((row) => row.recommended && row.hasData);
  const visibleSelectedCount = visibleRows.filter((row) => row.hasData && selectedManualItems[row.itemKey]).length;
  const selectedRows = visibleRows.filter((row) => row.hasData && selectedManualItems[row.itemKey]);
  const highConfidenceRows = visibleRows.filter((row) => getStage3BConfidenceLabel(row) === "Alta" && row.hasData).length;
  const mediumConfidenceRows = visibleRows.filter((row) => getStage3BConfidenceLabel(row) === "Media" && row.hasData).length;
  const noDataRows = visibleRows.filter((row) => !row.hasData).length;
  const attemptContextTitle = hiddenAppliedRows
    ? `${hiddenAppliedRows.toLocaleString("es-CO")} de ${rows.length.toLocaleString("es-CO")} ya aprobados`
    : `${rowsWithData.length.toLocaleString("es-CO")} con candidata para revisar`;
  const attemptContextDetail = hiddenAppliedRows
    ? `${visibleRows.length.toLocaleString("es-CO")} quedan visibles: ${rowsWithData.length.toLocaleString("es-CO")} con candidata y ${noDataRows.toLocaleString("es-CO")} sin candidata en este intento.`
    : `${recommendedRows.length.toLocaleString("es-CO")} sugeridos, ${highConfidenceRows.toLocaleString("es-CO")} de confianza alta y ${noDataRows.toLocaleString("es-CO")} sin candidata.`;

  return (
    <section className="stage3BAttemptStep stage3BReviewDecisionBox" aria-label="Revision y decision del intento">
      <div className="stage3BStepHeader">
        <strong>Decisión del intento</strong>
        <span>Confianza, fuente y acción por ítem.</span>
      </div>
      <div className="stage3BAttemptContextSummary">
        <strong>{attemptContextTitle}</strong>
        <span>{attemptContextDetail}</span>
      </div>
      <div className="stage3BDecisionSummary">
        <span><strong>{rowsWithData.length.toLocaleString("es-CO")}</strong> con datos</span>
        <span><strong>{recommendedRows.length.toLocaleString("es-CO")}</strong> sugeridos</span>
        <span><strong>{highConfidenceRows.toLocaleString("es-CO")}</strong> alta</span>
        <span><strong>{mediumConfidenceRows.toLocaleString("es-CO")}</strong> media</span>
        {noDataRows ? <span className="stage3BDecisionSummaryWarn"><strong>{noDataRows.toLocaleString("es-CO")}</strong> sin datos</span> : null}
      </div>
      <div className="stage3BManualApplyBar" aria-label="Acciones de aprobacion por lote">
        <div className="stage3BSelectionCounter" aria-live="polite">
          <strong>{visibleSelectedCount.toLocaleString("es-CO")}</strong>
          <span>de {rowsWithData.length.toLocaleString("es-CO")} con datos marcados</span>
          {hiddenAppliedRows ? <small>{hiddenAppliedRows.toLocaleString("es-CO")} ya aprobado(s) oculto(s)</small> : null}
        </div>
        {hiddenAppliedRows ? <span className="muted">{hiddenAppliedRows.toLocaleString("es-CO")} ya subido(s) oculto(s)</span> : null}
        <span className="muted">{rowsWithData.length.toLocaleString("es-CO")} con datos · {selectedCount.toLocaleString("es-CO")} marcado(s)</span>
        <button
          type="button"
          className="secondary miniButton stage3BSelectSuggestedButton"
          disabled={!rowsWithData.length}
          onClick={() => onSelectRows(recommendedRows.length ? recommendedRows : rowsWithData, true)}
        >
          Seleccionar sugeridos
        </button>
        <button type="button" className="secondary miniButton stage3BClearSelectionButton" onClick={() => onSelectRows(visibleRows, false)}>Limpiar seleccion</button>
        <button
          type="button"
          className="stageTabExportExcelBtn stage3BApproveButton"
          disabled={!onApplySelected || loading === "stage3" || visibleSelectedCount === 0}
          onClick={() => onApplySelected?.(selectedRows.map((row) => row.itemKey))}
        >
          Aprobar {visibleSelectedCount > 0 ? visibleSelectedCount.toLocaleString("es-CO") + " " : ""}marcado(s)
        </button>
      </div>
      <div className="stage3BReviewTableWrap">
        <table className="stage3BReviewTable">
          <thead>
            <tr>
              <th>Aprobar</th>
              <th>Item</th>
              <th>Datos originales</th>
              <th>Fuente candidata</th>
              <th>Señales sistema</th>
              <th>Supervisor</th>
              <th>Decisión</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const selected = Boolean(selectedManualItems[row.itemKey]) && row.hasData;
              const confidenceLabel = getStage3BConfidenceLabel(row);
              const confidenceTone = getStage3BConfidenceTone(confidenceLabel);
              const decisionLabel = getStage3BDecisionLabel(row, confidenceLabel);
              const decisionTone = getStage3BDecisionTone(decisionLabel);
              const supervisorDetails = [
                row.supervisorStatus ? `Estado: ${row.supervisorStatus}` : "",
                row.supervisorAction ? `Acción: ${row.supervisorAction}` : "",
                row.supervisorComment
              ].filter(Boolean);
              const rowClass = row.recommended ? "stage3BReviewRowRecommended" : row.hasData ? "stage3BReviewRowWithData" : "stage3BReviewRowEmpty";
              return (
                <tr key={row.itemKey} className={rowClass}>
                  <td className="stage3BReviewSelectCell">
                    <label className={`stage3BReviewCheckboxWrap${!row.hasData ? " stage3BReviewCheckboxDisabled" : ""}`}>
                      <input
                        type="checkbox"
                        disabled={!row.hasData}
                        checked={selected}
                        onChange={(event) => onSelectRow(row.itemKey, event.target.checked)}
                        aria-label={`Aprobar item ${row.itemKey}`}
                      />
                    </label>
                  </td>
                  <td>{row.itemKey}</td>
                  <td>
                    <div className="stage3BReviewCellStack">
                      <strong>{row.name || "Sin nombre"}</strong>
                      <span>{row.description || "Sin ficha técnica"}</span>
                      <small>{[row.unit, row.quantity ? `Cant ${row.quantity}` : "", row.ceiling ? `Techo ${row.ceiling}` : ""].filter(Boolean).join(" · ")}</small>
                    </div>
                  </td>
                  <td>
                    <div className="stage3BReviewCellStack">
                      <strong>{row.provider || "Sin proveedor"}</strong>
                      <span>{row.price ? `${row.price}${row.currency ? ` ${row.currency}` : ""}` : "Sin precio"}</span>
                      {row.url ? <a href={row.url} target="_blank" rel="noreferrer">Abrir URL</a> : <small>Sin URL</small>}
                      {row.notes ? <small>{row.notes}</small> : null}
                    </div>
                  </td>
                  <td>
                    <div className="stage3BSignalList">
                      {row.systemSignals.length ? row.systemSignals.map((signal) => <span key={signal}>{signal}</span>) : <span>Sin señales corridas</span>}
                    </div>
                  </td>
                  <td>
                    <div className="stage3BReviewCellStack">
                      <span className={`stage3BConfidenceBadge stage3BConfidence${confidenceTone}`}>Confianza: {confidenceLabel}</span>
                      {supervisorDetails.length ? (
                        <details className="stage3BInlineDetails">
                          <summary>Detalle</summary>
                          {supervisorDetails.map((detail, detailIndex) => <p key={`${row.itemKey}-detail-${detailIndex}`}>{detail}</p>)}
                        </details>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="stage3BReviewCellStack">
                      <span className={`stage3BDecisionLabel stage3BDecision${decisionTone}`}>{decisionLabel}</span>
                      {row.recommended ? <small>Sugerido</small> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visibleRows.length ? (
              <tr>
                <td colSpan={7}>
                  <p className="muted">Los items de este intento que ya subiste a la tabla principal quedan ocultos aqui.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function parseMarkdownTableForUi(raw: string): Record<string, unknown>[] {
  if (!raw || !raw.includes("|")) return [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes("|"));
  const headerIndex = lines.findIndex((line, index) => {
    const next = lines[index + 1] || "";
    return splitMarkdownLineForUi(line).length >= 3 && /^\|?\s*:?-{3,}/.test(next);
  });
  if (headerIndex < 0) return [];
  const headers = splitMarkdownLineForUi(lines[headerIndex]).map((header) => header.trim()).filter(Boolean);
  if (headers.length < 3) return [];
  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (/^\|?\s*:?-{3,}/.test(line)) continue;
    const cells = splitMarkdownLineForUi(line);
    if (cells.length < Math.min(3, headers.length)) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((header, cellIndex) => {
      row[header || `Col ${cellIndex + 1}`] = (cells[cellIndex] ?? "").trim();
    });
    rows.push(row);
    if (rows.length >= 200) break;
  }
  return rows;
}

function splitMarkdownLineForUi(line: string) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}


function StageTabPanel({
  stageNum,
  response,
  historicalRun,
  file,
  loading,
  stageProviders,
  stageModels,
  geminiModel,
  deepseekModel,
  displayNumberFormat,
  isAdminMode,
  copRate,
  canRun,
  onRun,
  stage1Response,
  stage2Response,
  stage2Experiment,
  stage3GoogleExperiment,
  stage3OpenAiExperiment,
  onSetStage2Experiment,
  onSetStage3GoogleExperiment,
  onSetStage3OpenAiExperiment,
  enableReviewSandbox,
  onApplyRepairedStage3,
  onApplyCompletedStage3,
  openAiService
}: {
  stageNum: 1 | 2 | 3;
  response: ApiResponse | null;
  historicalRun: boolean;
  file: File | null;
  loading: LoadingStage;
  stageProviders: StageProviders;
  stageModels: StageModels;
  geminiModel: string;
  deepseekModel: string;
  displayNumberFormat: NumberDisplayFormat;
  isAdminMode: boolean;
  copRate: number;
  canRun: boolean;
  onRun: (stageNum: 1 | 2 | 3, provider: AiProvider | "", model: string) => void;
  stage1Response: ApiResponse | null;
  stage2Response: ApiResponse | null;
  stage2Experiment: ApiResponse | null;
  stage3GoogleExperiment: ApiResponse | null;
  stage3OpenAiExperiment: ApiResponse | null;
  onSetStage2Experiment: Dispatch<SetStateAction<ApiResponse | null>>;
  onSetStage3GoogleExperiment: Dispatch<SetStateAction<ApiResponse | null>>;
  onSetStage3OpenAiExperiment: Dispatch<SetStateAction<ApiResponse | null>>;
  enableReviewSandbox: boolean;
  onApplyRepairedStage3: (result: Record<string, unknown>) => void;
  onApplyCompletedStage3: (response: ApiResponse) => void;
  openAiService?: ProviderServiceStatus | null;
}) {
  const [overrideProvider, setOverrideProvider] = useState<AiProvider | "">("");
  const [overrideModel, setOverrideModel] = useState("");
  const [completionBusy, setCompletionBusy] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [adminToolsTab, setAdminToolsTab] = useState<"json" | "sandbox">("json");
  const [experimentBusy, setExperimentBusy] = useState<"stage2" | "google" | "openai" | null>(null);
  const [experimentError, setExperimentError] = useState<string | null>(null);
  const [stage3LabInputSource, setStage3LabInputSource] = useState<"stable" | "experimental">("stable");
  const [googleLabModel, setGoogleLabModel] = useState(getFirstProviderModel("gemini"));
  const [openAiLabModel, setOpenAiLabModel] = useState(openAiService?.model || "gpt-5.4-mini");
  const [openAiLabReasoning, setOpenAiLabReasoning] = useState(openAiService?.reasoningEffort || "medium");
  const stageKey = `stage${stageNum}` as keyof StageModels;
  const defaultProvider = getCheckedProvider(stageProviders[stageKey]);
  const defaultModel =
    stageModels[stageKey] || getProviderDefaultModel(defaultProvider, geminiModel, deepseekModel);

  const exportTableRows = useMemo(
    () => extractStageResultTableRows(response?.result ?? undefined, stageNum),
    [response?.result]
  );
  const itemCount = response?.result?.items?.length ?? 0;
  const hasResult = response?.result != null;
  const hasError = Boolean(response?.error);
  const canRender = hasResult || hasError;
  const isRunning = loading === (`stage${stageNum}` as LoadingStage);
  const effectiveProvider = (overrideProvider || defaultProvider) as AiProvider;
  const tabCanRun =
    !loading &&
    (stageNum === 1
      ? Boolean(file)
      : canRun && (stageNum !== 3 || effectiveProvider !== "deepseek"));
  const btnLabel = isRunning ? "Procesando…" : hasResult || hasError ? "Reprocesar" : "Procesar";
  const disabledTitle =
    stageNum === 1 && historicalRun && !file
      ? "Adjunta de nuevo el archivo para reintentar la Etapa 1."
      : stageNum === 1 && !file
        ? "Carga un archivo primero"
        : !canRun
          ? `Requiere resultado de Etapa ${stageNum - 1}`
          : stageNum === 3 && stageProviders.stage3 === "deepseek"
            ? "Etapa 3 requiere Google (búsqueda)."
            : undefined;

  const canExportStage = exportTableRows.length > 0 && Boolean(response?.result);
  const displayedItemCount = exportTableRows.length || itemCount;
  const displayedModel = response?.model || overrideModel || defaultModel;

  function downloadStageExcel() {
    if (!canExportStage || !response?.result) {
      return;
    }

    downloadStageItemsExcel({
      filenamePrefix: `etapa-${stageNum}-resultados`,
      mainSheetName: `Etapa ${stageNum}`,
      items: exportTableRows,
      metadata: response.result.metadata,
      controlCalidad: response.result.control_calidad
    });
  }


  const stage3LabSourceResponse =
    stage3LabInputSource === "experimental" && stage2Experiment?.result ? stage2Experiment : stage2Response;
  const stage3LabSourceLabel =
    stage3LabInputSource === "experimental" && stage2Experiment?.result ? "Etapa 2 experimental" : "Etapa 2 normal";

  async function runStage2ExperimentalLab() {
    if (!stage1Response?.result) {
      setExperimentError("Ejecuta primero Etapa 1 para probar Etapa 2 experimental.");
      return;
    }
    setExperimentBusy("stage2");
    setExperimentError(null);
    try {
      const selectedModel = overrideModel || defaultModel;
      const res = await fetch("/api/stage2/experimental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage1Json: stage1Response.result, model: selectedModel, runId: stage1Response.runId })
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.result) {
        setExperimentError(data.error ?? `Etapa 2 experimental fallo (HTTP ${res.status}).`);
        return;
      }
      onSetStage2Experiment(data);
    } catch (error) {
      setExperimentError(error instanceof Error ? error.message : "Fallo inesperado en Etapa 2 experimental.");
    } finally {
      setExperimentBusy(null);
    }
  }

  async function runGoogleStage3ExperimentalLab() {
    if (!stage3LabSourceResponse?.result) {
      setExperimentError("Selecciona una fuente de Etapa 2 disponible para probar Google experimental.");
      return;
    }
    setExperimentBusy("google");
    setExperimentError(null);
    try {
      const selectedModel = googleLabModel || overrideModel || defaultModel;
      const res = await fetch("/api/stage3/google-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage2Json: stage3LabSourceResponse.result,
          model: selectedModel,
          runId: stage3LabSourceResponse.runId || stage2Response?.runId || stage1Response?.runId
        })
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.result) {
        setExperimentError(data.error ?? `Google experimental fallo (HTTP ${res.status}).`);
        return;
      }
      onSetStage3GoogleExperiment(data);
    } catch (error) {
      setExperimentError(error instanceof Error ? error.message : "Fallo inesperado en Google experimental.");
    } finally {
      setExperimentBusy(null);
    }
  }

  async function runOpenAiStage3ExperimentalLab() {
    if (!stage3LabSourceResponse?.result) {
      setExperimentError("Selecciona una fuente de Etapa 2 disponible para probar OpenAI experimental.");
      return;
    }
    setExperimentBusy("openai");
    setExperimentError(null);
    try {
      const res = await fetch("/api/stage3/openai-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage2Json: stage3LabSourceResponse.result,
          model: openAiLabModel,
          reasoningEffort: openAiLabReasoning,
          runId: stage3LabSourceResponse.runId || stage2Response?.runId || stage1Response?.runId
        })
      });
      const text = await res.text();
      let data: ApiResponse = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as ApiResponse;
        } catch {
          setExperimentError(`OpenAI respondio ${res.status}, pero el cuerpo no es JSON. Primeros 600 caracteres: ${text.slice(0, 600)}`);
          return;
        }
      }
      if (!res.ok || !data.result) {
        setExperimentError(data.error ?? `OpenAI experimental fallo (HTTP ${res.status}).`);
        return;
      }
      onSetStage3OpenAiExperiment(data);
    } catch (error) {
      setExperimentError(error instanceof Error ? error.message : "Fallo inesperado en OpenAI experimental.");
    } finally {
      setExperimentBusy(null);
    }
  }

  const stageExperimentLab = isAdminMode && (stageNum === 2 || stageNum === 3) ? (
    <details className="stageExperimentLab stageExperimentArchive" aria-label={`Herramientas heredadas etapa ${stageNum}`}>
      <summary className="stage3BCompactSummary">
        <span>Herramientas experimentales heredadas</span>
        <span>plegado</span>
      </summary>
      <div className="stageExperimentLabHeader">
        <div>
          <h3>Herramientas heredadas</h3>
          <p className="muted">Pruebas antiguas de laboratorio. La ruta principal ahora es Etapa 3-B.</p>
        </div>
        {stageNum === 2 ? (
          <div className="stageExperimentLabActions">
            <button type="button" className="secondary miniButton" disabled={experimentBusy !== null || !stage1Response?.result} onClick={() => void runStage2ExperimentalLab()}>
              {experimentBusy === "stage2" ? "Procesando..." : "Probar Etapa 2 compacta"}
            </button>
          </div>
        ) : null}
      </div>

      {stageNum === 3 ? (
        <div className="stageExperimentControlBox">
          <label className="stageExperimentField">
            <span>Fuente para los experimentos de cotizacion</span>
            <select value={stage3LabInputSource} onChange={(event) => setStage3LabInputSource(event.target.value === "experimental" ? "experimental" : "stable")}>
              <option value="stable">Etapa 2 normal{stage2Response?.result ? "" : " (no disponible)"}</option>
              <option value="experimental">Etapa 2 experimental{stage2Experiment?.result ? "" : " (no disponible)"}</option>
            </select>
          </label>
          <span className="muted">Usando: {stage3LabSourceLabel}</span>
          <div className="stageExperimentLabActions stageExperimentProviderActions">
            <select value={googleLabModel} onChange={(event) => setGoogleLabModel(event.target.value)} disabled={experimentBusy !== null} title="Modelo Google para el experimento">
              {AI_MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" className="secondary miniButton" disabled={experimentBusy !== null || !stage3LabSourceResponse?.result} onClick={() => void runGoogleStage3ExperimentalLab()}>
              {experimentBusy === "google" ? "Cotizando..." : "Probar Google experimental"}
            </button>
            <select value={openAiLabModel} onChange={(event) => setOpenAiLabModel(event.target.value)} disabled={experimentBusy !== null}>
              {(openAiService?.modelOptions?.length
                ? openAiService.modelOptions
                : [
                    { value: "gpt-5.5", label: "GPT-5.5" },
                    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
                    { value: "gpt-5.4", label: "GPT-5.4" },
                    { value: "gpt-5.4-mini", label: "GPT-5.4 mini" }
                  ]
              ).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={openAiLabReasoning} onChange={(event) => setOpenAiLabReasoning(event.target.value)} disabled={experimentBusy !== null}>
              <option value="low">Razonamiento bajo</option>
              <option value="medium">Razonamiento medio</option>
              <option value="high">Razonamiento alto</option>
              <option value="xhigh">Razonamiento extra alto</option>
            </select>
            <button type="button" className="secondary miniButton" disabled={experimentBusy !== null || !stage3LabSourceResponse?.result || openAiService?.hasApiKey === false} onClick={() => void runOpenAiStage3ExperimentalLab()}>
              {experimentBusy === "openai" ? "Cotizando..." : "Probar OpenAI experimental"}
            </button>
          </div>
        </div>
      ) : null}

      {experimentError ? <div className="error stageExperimentError">{experimentError}</div> : null}

      {stageNum === 2 ? (
        <ExperimentResultBox
          title="Caja Etapa 2 experimental"
          response={stage2Experiment}
          stageNum={2}
          displayNumberFormat={displayNumberFormat}
          copRate={copRate}
          emptyText="Aun no hay resultado experimental de Etapa 2."
        />
      ) : null}

      {stageNum === 3 ? (
        <div className="stageExperimentGrid">
          <ExperimentResultBox
            title="Caja Google experimental"
            subtitle={`Entrada: ${stage3LabSourceLabel}`}
            response={stage3GoogleExperiment}
            stageNum={3}
            displayNumberFormat={displayNumberFormat}
            copRate={copRate}
            canAudit
            auditStage2Result={stage3LabSourceResponse?.result ?? null}
            emptyText="Aun no hay resultado experimental de Google."
          />
          <ExperimentResultBox
            title="Caja OpenAI experimental"
            subtitle={`Entrada: ${stage3LabSourceLabel}`}
            response={stage3OpenAiExperiment}
            stageNum={3}
            displayNumberFormat={displayNumberFormat}
            copRate={copRate}
            canAudit
            auditStage2Result={stage3LabSourceResponse?.result ?? null}
            emptyText="Aun no hay resultado experimental de OpenAI."
          />
        </div>
      ) : null}
    </details>
  ) : null;

  const stageToolbar = (
    <div className="stageDataToolbar">
      <div className="stageDataToolbarLeft">
        <div className="stageDataToolbarMeta" aria-label={`Resumen etapa ${stageNum}`}>
          <span>{displayedItemCount.toLocaleString("es-CO")} items</span>
          <span>Motor IA: {getModelDisplayName(displayedModel)}</span>
          {response?.usage ? <span>Tokens: {response.usage.totalTokens.toLocaleString("es-CO")}</span> : null}
          {response?.cost ? (
            <span>
              Costo est.: {formatUsd(response.cost.totalUsd)}
              {copRate > 0 ? ` / COP ${Math.round(response.cost.totalUsd * copRate).toLocaleString("es-CO")}` : ""}
            </span>
          ) : null}
        </div>
        <div className="stageDataToolbarAiControls" aria-label="Controles IA de la etapa">
          <select
            className="stageTabProviderSelect"
            value={overrideProvider}
            onChange={(e) => {
              setOverrideProvider(e.target.value as AiProvider | "");
              setOverrideModel("");
            }}
          >
            <option value="">Perfil global ({PROVIDER_LABELS[defaultProvider]})</option>
            <option value="gemini">Google Gemini</option>
            <option value="deepseek" disabled={stageNum === 3}>
              DeepSeek
            </option>
          </select>
          <StageModelPicker
            label="Modelo"
            pickerProvider={effectiveProvider}
            value={overrideModel}
            defaultModel={defaultModel}
            onChange={setOverrideModel}
          />
        </div>
      </div>
      <div className="stageDataToolbarActions" aria-label="Acciones de tabla">
        <button
          type="button"
          className="secondary miniButton stageToolbarButton"
          disabled={!canExportStage}
          title={
            canExportStage
              ? "Descargar la tabla visible como Excel (.xlsx)."
              : "No hay filas exportables en esta etapa."
          }
          onClick={downloadStageExcel}
        >
          Descargar Excel
        </button>
        <button
          type="button"
          className={hasResult || hasError ? "secondary miniButton stageToolbarButton" : "miniButton stageToolbarButton"}
          disabled={!tabCanRun}
          title={disabledTitle}
          onClick={() => onRun(stageNum, overrideProvider, overrideModel)}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );

  if (!response) {
    return (
      <div className="stageTabBody">
        {stageToolbar}
        {stageExperimentLab}
        {stageNum === 1 && !file ? (
          <p className="muted stageTabPlaceholder">Carga un archivo para comenzar la Etapa 1.</p>
        ) : stageNum > 1 && !canRun ? (
          <p className="muted stageTabPlaceholder">Requiere que la Etapa {stageNum - 1} esté completada.</p>
        ) : (
          <p className="muted stageTabPlaceholder">Sin datos aún. Usa «Procesar» arriba o este botón.</p>
        )}
      </div>
    );
  }

  if (!canRender) {
    return (
      <div className="stageTabBody">
        {stageToolbar}
        <p className="muted stageTabPlaceholder">Sin resultado aún.</p>
      </div>
    );
  }

  const fullModelRawText =
    stageNum === 3
      ? (typeof response.raw === "string" && response.raw.trim()
          ? response.raw
          : typeof response.cleaned === "string" && response.cleaned.trim()
            ? response.cleaned
            : null)
      : null;
  const modelRawText = fullModelRawText ? truncateTextForUi(fullModelRawText) : null;
  const modelRawWasTruncated = Boolean(fullModelRawText && fullModelRawText.length > RAW_TEXT_PREVIEW_LIMIT);
  const stage3Coverage = stageNum === 3 ? getStage3CoverageSummary(response.result) : null;
  const canAskMiniAgentForMissing = Boolean(
    stageNum === 3 &&
      stage2Response?.result &&
      response.result &&
      (!stage3Coverage || stage3Coverage.faltantes > 0)
  );
  const hasSandboxTools = Boolean(isAdminMode && stageNum === 3 && enableReviewSandbox);
  const activeAdminToolsTab = adminToolsTab === "sandbox" && hasSandboxTools ? "sandbox" : "json";

  async function completeMissingWithMiniAgent() {
    if (!stage2Response?.result || !response?.result) {
      setCompletionMessage("Falta Etapa 2 o Etapa 3 para completar faltantes.");
      return;
    }

    setCompletionBusy(true);
    setCompletionMessage("Miniagente activo: pidiendo a la IA los bloques faltantes...");
    try {
      const selectedModel = overrideModel || defaultModel;
      const res = await fetch("/api/stage3/complete-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage2Json: stage2Response.result,
          stage3Result: response.result,
          runId: response.runId,
          model: selectedModel,
          blockSize: 10
        })
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          setCompletionMessage(
            `El servidor respondio ${res.status}, pero no devolvio JSON. Primeros 500 caracteres: ${text.slice(0, 500)}`
          );
          return;
        }
      }

      if (!res.ok) {
        setCompletionMessage(
          typeof data.error === "string" ? data.error : `No se pudo completar faltantes (HTTP ${res.status}).`
        );
        return;
      }

      if (!isRecord(data.result)) {
        setCompletionMessage("El miniagente respondio, pero no entrego un resultado fusionable.");
        return;
      }

      const nextResponse: ApiResponse = {
        ...response,
        runId: typeof data.runId === "string" ? data.runId : response.runId,
        result: data.result as StageResult,
        raw: typeof data.raw === "string" ? data.raw : response.raw,
        model: typeof data.model === "string" ? data.model : response.model,
        groundingMetadata: data.groundingMetadata ?? response.groundingMetadata,
        usage: isRecord(data.usage) ? (data.usage as UsageSummary) : response.usage,
        cost: isRecord(data.cost) ? (data.cost as CostSummary) : response.cost,
        preservation: isRecord(data.preservation) ? (data.preservation as Stage3PreservationNotice) : undefined,
        usageAttempt: isRecord(data.usageAttempt) ? (data.usageAttempt as ApiUsageAttemptPayload) : undefined
      };
      onApplyCompletedStage3(nextResponse);

      const rounds = Array.isArray(data.rounds) ? data.rounds.length : 0;
      const nextCoverage = getStage3CoverageSummary(nextResponse.result);
      const remaining = nextCoverage?.faltantes ?? 0;
      setCompletionMessage(
        remaining > 0
          ? `Miniagente termino ${rounds} bloque(s). Quedan ${remaining} item(s) por revisar o intentar de nuevo.`
          : `Miniagente termino ${rounds} bloque(s). No se detectan faltantes contra Etapa 2.`
      );
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : "Fallo inesperado completando faltantes.");
    } finally {
      setCompletionBusy(false);
    }
  }

  return (
    <div className="stageTabBody">
      {stageToolbar}
      {response.error ? <div className="error">{response.error}</div> : null}

      <section className="stageDataZone" aria-label={`Datos principales etapa ${stageNum}`}>
        {stageNum === 3 && response.preservation?.preservedPrevious ? (
          <div className="notice stagePreservationNotice">
            {getStage3PreservationMessage(response.preservation)} El intento nuevo quedo guardado en el historial para auditoria.
          </div>
        ) : null}

        <DynamicTable items={exportTableRows.length ? exportTableRows : (response.result?.items ?? [])} numberFormat={displayNumberFormat} />
      </section>

      {stageExperimentLab}

      {isAdminMode ? (
        <section className="adminToolsConsole" aria-label="Herramientas de Administrador">
          <div className="adminToolsHeader">
            <div>
              <h3>Herramientas de Administrador</h3>
              <p className="muted">Consola tecnica al fondo: inspeccion, JSON y reparacion manual.</p>
            </div>
            <div className="adminToolsTabs" role="tablist" aria-label="Herramientas de administrador">
              <button
                type="button"
                role="tab"
                aria-selected={activeAdminToolsTab === "json"}
                className={activeAdminToolsTab === "json" ? "adminToolsTab adminToolsTabActive" : "adminToolsTab"}
                onClick={() => setAdminToolsTab("json")}
              >
                JSON Crudo
              </button>
              {hasSandboxTools ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeAdminToolsTab === "sandbox"}
                  className={activeAdminToolsTab === "sandbox" ? "adminToolsTab adminToolsTabActive" : "adminToolsTab"}
                  onClick={() => setAdminToolsTab("sandbox")}
                >
                  Sandbox Reparacion
                </button>
              ) : null}
            </div>
          </div>

          {activeAdminToolsTab === "json" ? (
            <div className="adminToolsPane adminToolsJsonPane" role="tabpanel">
              <div className="adminJsonAccordionList">
              {modelRawText ? (
                <details className="jsonDetails modelRawOutputDetails">
                  <summary>Datos crudos devueltos por el motor IA</summary>
                  <p className="muted modelRawOutputHint">
                    Vista previa del texto/JSON devuelto por el proveedor. Se recorta para no bloquear el navegador con respuestas grandes.
                  </p>
                  <pre className="modelRawOutputPre">{modelRawText}</pre>
                  {modelRawWasTruncated ? (
                    <p className="muted modelRawOutputMeta">
                      Vista previa recortada a {RAW_TEXT_PREVIEW_LIMIT.toLocaleString("es-CO")} caracteres.
                    </p>
                  ) : null}
                </details>
              ) : null}
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
                  stageNum === 3 ? (
                    <JsonDetails
                      title="JSON crudo (detalle parseo: limpio vs crudo)"
                      value={response.cleaned ? { cleaned: response.cleaned, raw: response.raw } : response.raw}
                      subtle
                    />
                  ) : (
                    <JsonDetails
                      title="JSON crudo"
                      value={response.cleaned ? { cleaned: response.cleaned, raw: response.raw } : response.raw}
                      subtle
                    />
                  )
                ) : null}
              </div>
              </div>
            </div>
          ) : null}

          {activeAdminToolsTab === "sandbox" && hasSandboxTools ? (
            <div className="adminToolsPane" role="tabpanel">
              <div className="sandboxCoverageTool">
        {stageNum === 3 && response.result ? (
          <div className={`stage3CoveragePanel ${!stage3Coverage || stage3Coverage.faltantes > 0 ? "stage3CoveragePartial" : ""}`}>
            <div className="stage3CoverageMain">
              <div>
                <div className="stage3CoverageTitle">Cobertura contra Etapa 2</div>
                <p className="muted stage3CoverageText">
                  {stage3Coverage ? (
                    <>
                      Recibidos {stage3Coverage.recibidos.toLocaleString("es-CO")} de {stage3Coverage.esperados.toLocaleString("es-CO")} item(s).
                      {stage3Coverage.faltantes > 0
                        ? ` Faltan ${stage3Coverage.faltantes.toLocaleString("es-CO")} item(s).`
                        : " Lista completa segun consecutivos/lote-item."}
                    </>
                  ) : (
                    <>Cobertura no calculada en este resultado. El miniagente puede revisar Etapa 2 contra Etapa 3 y pedir a la IA los bloques faltantes.</>
                  )}
                </p>
              </div>
              {isAdminMode ? (
                <button
                  type="button"
                  className="secondary miniButton"
                  disabled={completionBusy || !canAskMiniAgentForMissing}
                  onClick={() => void completeMissingWithMiniAgent()}
                >
                  {completionBusy ? "Completando..." : "Completar faltantes con miniagente"}
                </button>
              ) : null}
            </div>
            {isAdminMode && stage3Coverage?.faltantesMuestra.length ? (
              <div className="stage3CoverageMissing">
                {stage3Coverage.faltantesMuestra.slice(0, 12).map((item, index) => (
                  <span className="badge" key={`${item}-${index}`}>{item}</span>
                ))}
              </div>
            ) : null}
            {isAdminMode && completionMessage ? <div className="notice stage3CoverageNotice">{completionMessage}</div> : null}
          </div>
        ) : null}

              </div>
              <Stage3ReviewSandbox
                stage2={stage2Response}
                stage3={response}
                openAiService={openAiService}
                onApplyRepaired={onApplyRepairedStage3}
                onApplyOpenAiLab={(next) => {
                  onSetStage3OpenAiExperiment(next);
                  setExperimentError(null);
                  setCompletionMessage("OpenAI experimental listo en laboratorio.");
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

    </div>
  );
}



function ExperimentResultBox({
  title,
  subtitle,
  response,
  stageNum,
  displayNumberFormat,
  copRate,
  canAudit = false,
  auditStage2Result,
  showRaw = true,
  showJson = true,
  emptyText
}: {
  title: string;
  subtitle?: string;
  response: ApiResponse | null;
  stageNum: 2 | 3;
  displayNumberFormat: NumberDisplayFormat;
  copRate: number;
  canAudit?: boolean;
  auditStage2Result?: StageResult | null;
  showRaw?: boolean;
  showJson?: boolean;
  emptyText: string;
}) {
  const [auditBusy, setAuditBusy] = useState<"domains" | "evidence" | "googleUrl" | "supervisor" | null>(null);
  const [auditResult, setAuditResult] = useState<Record<string, unknown> | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const rows = useMemo(
    () => extractStageResultTableRows(response?.result ?? undefined, stageNum),
    [response?.result, stageNum]
  );
  const summaryRows = useMemo(
    () => stageNum === 3 && response?.result?.items ? extractStage3ItemSummaryRows(response.result.items) : rows,
    [response?.result, rows, stageNum]
  );
  const stage3BCumulative = getRecord(isRecord(response?.result) ? response.result.stage3b_cumulative : null);
  const stage3BCumulativeUsage = getRecord(stage3BCumulative.usage);
  const stage3BCumulativeCost = getRecord(stage3BCumulative.cost);
  const displayUsage = Object.keys(stage3BCumulativeUsage).length ? stage3BCumulativeUsage : response?.usage;
  const displayCost = Object.keys(stage3BCumulativeCost).length ? stage3BCumulativeCost : response?.cost;

  async function runAudit(action: "domains" | "evidence" | "googleUrl" | "supervisor") {
    if (!response?.result) {
      setAuditError("No hay resultado en esta caja para auditar.");
      return;
    }
    setAuditBusy(action);
    setAuditError(null);
    try {
      const apiAction = action === "domains" ? "domainEvidence" : action === "evidence" ? "linkEvidence" : action === "googleUrl" ? "googleUrlContext" : "sourceSupervisor";
      const res = await fetch("/api/stage3-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apiAction,
          stage2Json: auditStage2Result ?? null,
          stage3Result: response.result,
          rawText: response.raw ?? response.cleaned ?? "",
          maxSources: 40
        })
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setAuditError(typeof data.error === "string" ? data.error : `Auditoria fallo (HTTP ${res.status}).`);
        return;
      }
      setAuditResult({ action, ...data });
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "Fallo inesperado auditando la caja.");
    } finally {
      setAuditBusy(null);
    }
  }

  return (
    <article className="stageExperimentBox">
      <div className="stageExperimentBoxHeader">
        <div>
          <h4>{title}</h4>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {response?.result ? (
          <div className="stageDataToolbarMeta stageExperimentMeta">
            <span>{(rows.length || response.result.items?.length || 0).toLocaleString("es-CO")} items</span>
            <span>{isRecord(response.result.stage3b_cumulative) ? "Flujo: Etapa 3-B" : "Motor IA: " + getModelDisplayName(response.model || "")}</span>
            {typeof displayUsage?.totalTokens === "number" ? <span>Tokens: {displayUsage.totalTokens.toLocaleString("es-CO")}</span> : null}
            {typeof displayCost?.totalUsd === "number" ? <span>Costo acum.: {formatUsd(displayCost.totalUsd)}{copRate > 0 ? " / COP " + Math.round(displayCost.totalUsd * copRate).toLocaleString("es-CO") : ""}</span> : null}
          </div>
        ) : null}
      </div>

      {!response?.result ? <p className="muted stageExperimentEmpty">{emptyText}</p> : null}

      {response?.result ? (
        <>
          {stageNum === 3 ? (
            <div className="stageExperimentTableBlock">
              <div className="stageExperimentTableTitle">Vista r?pida por ?tem</div>
              <DynamicTable items={summaryRows.length ? summaryRows : (response.result.items ?? [])} numberFormat={displayNumberFormat} />
              {rows.length > summaryRows.length ? (
                <details className="stageExperimentSourceRows">
                  <summary>Ver detalle fila por fuente ({rows.length.toLocaleString("es-CO")} fila(s))</summary>
                  <DynamicTable items={rows} numberFormat={displayNumberFormat} />
                </details>
              ) : null}
            </div>
          ) : (
            <DynamicTable items={rows.length ? rows : (response.result.items ?? [])} numberFormat={displayNumberFormat} />
          )}
          {canAudit ? (
            <div className="stageExperimentAuditBar">
              <span className="muted">Sandbox aplicado a esta caja:</span>
              <button type="button" className="secondary miniButton" disabled={auditBusy !== null} onClick={() => void runAudit("domains")}>
                {auditBusy === "domains" ? "Revisando..." : "Testear dominios"}
              </button>
              <button type="button" className="secondary miniButton" disabled={auditBusy !== null} onClick={() => void runAudit("evidence")}>
                {auditBusy === "evidence" ? "Revisando..." : "Testear links completos"}
              </button>
              <button type="button" className="secondary miniButton" disabled={auditBusy !== null} onClick={() => void runAudit("googleUrl")}>
                {auditBusy === "googleUrl" ? "Validando..." : "Google URL Context"}
              </button>
              <button type="button" className="secondary miniButton" disabled={auditBusy !== null} onClick={() => void runAudit("supervisor")}>
                {auditBusy === "supervisor" ? "Evaluando..." : "Supervisor IA"}
              </button>
            </div>
          ) : null}
          {auditError ? <div className="error stageExperimentError">{auditError}</div> : null}
          {auditResult ? (
            <div className="stageExperimentAuditResult">
              <AuditHumanSummary data={auditResult} />
              <details className="jsonDetails stageExperimentRaw">
                <summary>JSON tecnico de auditoria</summary>
                <pre className="stage3ReviewPre">{JSON.stringify(auditResult, null, 2)}</pre>
              </details>
            </div>
          ) : null}
          {showRaw && response.raw ? (
            <details className="jsonDetails stageExperimentRaw">
              <summary>Respuesta cruda del motor</summary>
              <pre className="stage3ReviewPre">{truncateTextForUi(response.raw)}</pre>
            </details>
          ) : null}
          {showJson ? (
            <details className="jsonDetails stageExperimentRaw">
              <summary>JSON crudo de esta caja</summary>
              <pre className="stage3ReviewPre">{JSON.stringify({ metadata: response.result.metadata, control_calidad: response.result.control_calidad, details: response.details, groundingMetadata: response.groundingMetadata }, null, 2)}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </article>
  );
}


function AuditHumanSummary({ data }: { data: Record<string, unknown> }) {
  const action = textValue(data.action);
  const resultRecord = getRecord(data.result);
  const summary = getRecord(data.summary) || getRecord(data.evidenceSummary) || getRecord(resultRecord.resumen);
  const supervision = getRecord(data.supervision);
  const supervisorSummary = getRecord(supervision.resumen);
  const evidence = Array.isArray(data.evidence) ? data.evidence.filter(isRecord) : [];
  const sourceRows = buildAuditSourceRows(data);
  const stats = summarizeStage3BAuditToolResult(data);
  const actionLabel =
    action === "domains"
      ? "Dominios"
      : action === "evidence"
        ? "Links completos"
        : action === "googleUrl"
          ? "Google URL Context"
          : action === "supervisor"
            ? "Supervisor IA"
            : "Auditoria";
  const status = textValue(supervisorSummary.estado_general) || inferAuditStatus(summary, evidence);
  const comment = textValue(supervisorSummary.comentario) || buildAuditComment(action, summary, evidence);

  return (
    <div className="auditHumanSummary">
      <div className="auditHumanHeader">
        <span className="auditHumanTitle">Resumen {actionLabel}</span>
        <span className={`auditHumanStatus auditHumanStatus-${normalizeLabel(status) || "pendiente"}`}>{status || "pendiente"}</span>
      </div>
      <div className="auditHumanStats">
        <span>{stats.inspected} fuente(s) revisada(s)</span>
        <span>{stats.yes} si</span>
        <span>{stats.no} no</span>
        <span>{stats.unknown} no evaluable</span>
      </div>
      {comment ? <p className="auditHumanComment">{comment}</p> : null}
      {sourceRows.length ? <DynamicTable items={sourceRows} numberFormat="es-CO" /> : null}
    </div>
  );
}

function buildAuditSourceRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const supervision = getRecord(data.supervision);
  const supervisorSources = Array.isArray(supervision.fuentes) ? supervision.fuentes.filter(isRecord) : [];
  if (supervisorSources.length) {
    return supervisorSources.slice(0, 60).map((source) => ({
      "Item": textValue(source.itemKey),
      "Fuente": textValue(source.sourceId),
      "Estado": textValue(source.estado),
      "Precio soportado": textValue(source.precio_soportado),
      "URL soportada": textValue(source.url_soportada),
      "Producto": textValue(source.producto_corresponde),
      "Accion": textValue(source.accion_sugerida),
      "Comentario": textValue(source.comentario),
      "Confianza": textValue(source.confianza)
    }));
  }

  const googleResult = getRecord(data.result);
  const googleSources = Array.isArray(googleResult.fuentes) ? googleResult.fuentes.filter(isRecord) : [];
  if (googleSources.length) {
    return googleSources.slice(0, 60).map((source) => ({
      "Item": textValue(source.itemKey) || textValue(source.item),
      "Fuente": textValue(source.sourceId) || textValue(source.fuente),
      "URL leida": textValue(source.url_leida) || textValue(source.estado_url),
      "Pagina abre": textValue(source.pagina_abre),
      "Producto leido": textValue(source.producto_leido),
      "Precio visible": textValue(source.precio_visible),
      "Precio coincide": textValue(source.precio_reportado_coincide),
      "Precio": textValue(source.precio_detectado),
      "Moneda": textValue(source.moneda),
      "Producto": textValue(source.producto_en_pagina) || textValue(source.producto_detectado),
      "Evidencia": textValue(source.evidencia) || textValue(source.evidencia_url),
      "Error": textValue(source.error)
    }));
  }

  const evidence = Array.isArray(data.evidence) ? data.evidence.filter(isRecord) : [];
  return evidence.slice(0, 60).map((source) => {
    const signals = getRecord(source.toolSignals);
    const reported = getRecord(source.reported);
    return {
      "Item": textValue(source.itemKey),
      "Proveedor": textValue(reported.provider) || textValue(source.reportedSourceName),
      "Precio reportado": textValue(reported.priceRaw) || textValue(source.reportedPriceText) || textValue(source.reportedPrice),
      "URL": textValue(reported.url) || textValue(source.reportedUrl),
      "Hay proveedor": textValue(signals.proveedor_reportado),
      "Hay precio": textValue(signals.precio_reportado),
      "Hay URL": textValue(signals.url_reportada),
      "Dominio": textValue(signals.dominio_resuelve),
      "Link abre": textValue(signals.link_abre),
      "Precio en pagina": textValue(signals.pagina_tiene_precio),
      "Precio coincide": textValue(signals.precio_reportado_aparece_en_pagina),
      "Producto": textValue(reported.productTitle) || textValue(source.reportedProductTitle)
    };
  });
}

function inferAuditStatus(summary: Record<string, unknown>, evidence: Record<string, unknown>[]) {
  const failed = (Number(summary.failed ?? 0) || 0) + (Number(summary.domainError ?? 0) || 0) + (Number(summary.invalidUrl ?? 0) || 0);
  if (failed) return "medido_con_no";
  if (evidence.length) return "aceptable";
  return "sin_evidencia";
}

function buildAuditComment(action: string, summary: Record<string, unknown>, evidence: Record<string, unknown>[]) {
  if (!evidence.length) return "No se encontraron fuentes en este resultado para auditar.";
  if (action === "domains") {
    const counts = countEvidenceSignal(evidence, "dominio_resuelve");
    return `Dominio resuelve: ${counts.yes} si, ${counts.no} no, ${counts.unknown} no evaluable.`;
  }
  if (action === "evidence") {
    const linkCounts = countEvidenceSignal(evidence, "link_abre");
    const priceCounts = countEvidenceSignal(evidence, "precio_reportado_aparece_en_pagina");
    return `Link abre: ${linkCounts.yes} si, ${linkCounts.no} no, ${linkCounts.unknown} no evaluable. Precio reportado aparece: ${priceCounts.yes} si, ${priceCounts.no} no, ${priceCounts.unknown} no evaluable.`;
  }
  if (action === "googleUrl") {
    const read = Number(summary.url_leidas ?? 0) || 0;
    const prices = Number(summary.precios_visibles ?? 0) || 0;
    return `Google URL Context: ${read} URL(s) leidas y ${prices} precio(s) visibles reportados.`;
  }
  return "Supervisor listo. Interpreto las senales binarias y el resultado crudo.";
}

function getStage3CoverageSummary(result?: StageResult | null) {
  if (!result || !isRecord(result.control_calidad)) {
    return null;
  }
  const coverage = result.control_calidad.cobertura_stage3;
  if (!isRecord(coverage)) {
    return null;
  }

  const toCount = (value: unknown) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  };

  return {
    estado: typeof coverage.estado === "string" ? coverage.estado : "",
    completo: Boolean(coverage.completo),
    esperados: toCount(coverage.esperados),
    recibidos: toCount(coverage.recibidos),
    faltantes: toCount(coverage.faltantes),
    faltantesMuestra: Array.isArray(coverage.faltantes_muestra)
      ? coverage.faltantes_muestra.map((item) => String(item)).filter(Boolean)
      : []
  };
}

type Stage3ValidationReportPayload = {
  expectedCount: number;
  actualCount: number;
  expectedKeys: string[];
  outputKeys: string[];
  missingKeys: string[];
  extraInOutput: string[];
  duplicateOutputKeys: string[];
  basicIssues: string[];
};

function Stage3ReviewSandbox({
  stage2,
  stage3,
  openAiService,
  onApplyRepaired,
  onApplyOpenAiLab
}: {
  stage2: ApiResponse | null;
  stage3: ApiResponse | null;
  openAiService?: ProviderServiceStatus | null;
  onApplyRepaired: (result: Record<string, unknown>) => void;
  onApplyOpenAiLab: (response: ApiResponse) => void;
}) {
  const [busy, setBusy] = useState<null | "validate" | "missing" | "history" | "domains" | "evidence" | "googleUrl" | "supervisor" | "repair" | "probe" | "openai">(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Stage3ValidationReportPayload | null>(null);
  const [missing, setMissing] = useState<{
    missingLabels: string[];
    missingKeys: string[];
    summary: string;
  } | null>(null);
  const [repaired, setRepaired] = useState<unknown | undefined>(undefined);
  const [repairNotas, setRepairNotas] = useState<string[]>([]);
  const [repairFailureRaw, setRepairFailureRaw] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<Record<string, unknown> | null>(null);
  const [historyInfo, setHistoryInfo] = useState<Record<string, unknown> | null>(null);
  const [sourceDomains, setSourceDomains] = useState<Record<string, unknown> | null>(null);
  const [sourceEvidence, setSourceEvidence] = useState<Record<string, unknown> | null>(null);
  const [sourceGoogleUrl, setSourceGoogleUrl] = useState<Record<string, unknown> | null>(null);
  const [sourceSupervision, setSourceSupervision] = useState<Record<string, unknown> | null>(null);
  const [openAiModel, setOpenAiModel] = useState(openAiService?.model || openAiService?.defaultModel || "gpt-5.5");
  const [openAiReasoning, setOpenAiReasoning] = useState(openAiService?.reasoningEffort || openAiService?.defaultReasoningEffort || "medium");

  useEffect(() => {
    setOpenAiModel(openAiService?.model || openAiService?.defaultModel || "gpt-5.5");
    setOpenAiReasoning(openAiService?.reasoningEffort || openAiService?.defaultReasoningEffort || "medium");
  }, [openAiService?.model, openAiService?.defaultModel, openAiService?.reasoningEffort, openAiService?.defaultReasoningEffort]);

  function isPlainObj(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  }

  async function post(action: "validate" | "missing" | "history" | "domains" | "evidence" | "googleUrl" | "supervisor" | "repair") {
    setError(null);
    setProbeInfo(null);
    if (action !== "history") {
      setHistoryInfo(null);
    }
    if (action === "domains") {
      setSourceDomains(null);
      setSourceSupervision(null);
    }
    if (action === "evidence") {
      setSourceEvidence(null);
      setSourceGoogleUrl(null);
      setSourceSupervision(null);
    }
    if (action === "googleUrl") {
      setSourceGoogleUrl(null);
      setSourceSupervision(null);
    }
    if (action === "supervisor") {
      setSourceSupervision(null);
    }
    if (action === "repair") {
      setRepaired(undefined);
      setRepairNotas([]);
      setRepairFailureRaw(null);
    }
    setBusy(action);
    try {
      const existingEvidence = isPlainObj(sourceEvidence) && Array.isArray(sourceEvidence.evidence)
        ? sourceEvidence.evidence
        : undefined;
      const body =
        action === "repair"
          ? {
              action: "repair" as const,
              rawText:
                (typeof stage3?.raw === "string" && stage3.raw.trim()
                  ? stage3.raw
                  : typeof stage3?.cleaned === "string" && stage3.cleaned.trim()
                    ? stage3.cleaned
                    : stage3?.result
                      ? JSON.stringify(stage3.result, null, 2)
                      : "") || ""
            }
          : action === "history"
            ? {
                action,
                runId: stage3?.runId ?? stage2?.runId ?? null,
                stage2Json: stage2?.result ?? null,
                stage3Result: stage3?.result ?? null
              }
            : action === "domains"
              ? {
                  action: "domainEvidence" as const,
                  stage3Result: stage3?.result ?? null,
                  maxSources: 80
                }
              : action === "evidence"
                ? {
                    action: "linkEvidence" as const,
                    stage3Result: stage3?.result ?? null,
                    maxSources: 80
                  }
                : action === "googleUrl"
                  ? {
                      action: "googleUrlContext" as const,
                      stage3Result: stage3?.result ?? null,
                      rawText: typeof stage3?.raw === "string" ? stage3.raw : "",
                      maxSources: 20,
                      model: "gemini:gemini-2.5-pro",
                      runId: stage3?.runId ?? stage2?.runId ?? null
                    }
                  : action === "supervisor"
                ? {
                    action: "sourceSupervisor" as const,
                    stage3Result: stage3?.result ?? null,
                    evidence: existingEvidence,
                    rawText: typeof stage3?.raw === "string" ? stage3.raw : "",
                    maxSources: 80,
                    model: "deepseek:deepseek-v4-pro"
                  }
                : {
                    action,
                    stage2Json: stage2?.result ?? null,
                    stage3Result: stage3?.result ?? null
                  };

      const res = await fetch("/api/stage3-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          setError(
            `El servidor respondió ${res.status} pero el cuerpo no es JSON (a veces es HTML de error). Primeros 600 caracteres:\n${text.slice(0, 600)}`
          );
          return;
        }
      }

      if (!res.ok) {
        const base =
          typeof data.error === "string" ? data.error : `Error HTTP ${res.status} en la herramienta de revisión.`;
        const codeHint = typeof data.code === "string" ? `\n[Código: ${data.code}]` : "";
        const modelHint = typeof data.model === "string" ? `\nModelo: ${data.model}` : "";
        const diag =
          typeof data.diagnostic === "string" ? `\n\nDetalle técnico (proveedor): ${data.diagnostic}` : "";
        const userAct =
          typeof data.userAction === "string" ? `\n\nQué hacer: ${data.userAction}` : "";
        const rawPv = typeof data.rawPreview === "string" ? data.rawPreview : null;
        const provRaw = typeof data.raw === "string" ? data.raw : null;
        const fallbackRaw = rawPv || provRaw;
        setRepairFailureRaw(action === "repair" && fallbackRaw ? fallbackRaw : null);
        setError(base + codeHint + modelHint + diag + userAct);
        return;
      }

      setRepairFailureRaw(null);

      if (action === "validate" && data.report && typeof data.report === "object") {
        setReport(data.report as Stage3ValidationReportPayload);
      }
      if (action === "missing") {
        setMissing({
          missingLabels: Array.isArray(data.missingLabels)
            ? (data.missingLabels as string[])
            : [],
          missingKeys: Array.isArray(data.missingKeys) ? (data.missingKeys as string[]) : [],
          summary: typeof data.summary === "string" ? data.summary : ""
        });
      }
      if (action === "history") {
        setHistoryInfo(data);
      }
      if (action === "domains") {
        setSourceDomains(data);
      }
      if (action === "evidence") {
        setSourceEvidence(data);
      }
      if (action === "googleUrl") {
        setSourceGoogleUrl(data);
      }
      if (action === "supervisor") {
        setSourceSupervision(data);
        if (!sourceEvidence && Array.isArray(data.evidence)) {
          setSourceEvidence({ ok: true, evidence: data.evidence, summary: data.evidenceSummary ?? null });
        }
      }
      if (action === "repair") {
        setRepaired(Object.prototype.hasOwnProperty.call(data, "json_reparado") ? data.json_reparado : undefined);
        setRepairNotas(Array.isArray(data.notas) ? (data.notas as string[]) : []);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof TypeError && /fetch|network|Failed to fetch/i.test(msg)) {
        setError("Error de red (no hubo respuesta del servidor o el navegador bloqueó la petición).");
      } else {
        setError(`Fallo al llamar a la herramienta: ${msg}`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runOpenAiLab() {
    setError(null);
    setRepairFailureRaw(null);
    setBusy("openai");
    try {
      const res = await fetch("/api/stage3/openai-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage2Json: stage2?.result ?? null,
          model: openAiModel,
          reasoningEffort: openAiReasoning,
          runId: stage2?.runId ?? stage3?.runId ?? null
        })
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          setError(`OpenAI respondi? ${res.status}, pero el cuerpo no es JSON. Primeros 600 caracteres:\n${text.slice(0, 600)}`);
          return;
        }
      }
      if (!res.ok) {
        const base = typeof data.error === "string" ? data.error : `OpenAI fallo (HTTP ${res.status}).`;
        const diag = typeof data.diagnostic === "string" ? `\n\nDetalle tecnico: ${data.diagnostic}` : "";
        const code = typeof data.code === "string" ? `\n[C?digo: ${data.code}]` : "";
        setError(base + code + diag);
        return;
      }
      onApplyOpenAiLab(data as ApiResponse);
      setSourceDomains(null);
      setSourceEvidence(null);
      setSourceSupervision(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runProbe() {
    setError(null);
    setProbeInfo(null);
    setRepairFailureRaw(null);
    setBusy("probe");
    try {
      const res = await fetch("/api/stage3-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe" })
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          setError(
            `El servidor respondió ${res.status} pero el cuerpo no es JSON. Primeros 600 caracteres:\n${text.slice(0, 600)}`
          );
          return;
        }
      }

      setProbeInfo(data);

      if (!res.ok || data.ok === false) {
        const base =
          typeof data.error === "string" ? data.error : `La prueba de conexión falló (HTTP ${res.status}).`;
        const codeHint = typeof data.code === "string" ? `\n[Código: ${data.code}]` : "";
        const diag =
          typeof data.diagnostic === "string" ? `\n\nDetalle técnico (proveedor): ${data.diagnostic}` : "";
        const userAct =
          typeof data.userAction === "string" ? `\n\nQué hacer: ${data.userAction}` : "";
        setError(base + codeHint + diag + userAct);
        return;
      }

      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof TypeError && /fetch|network|Failed to fetch/i.test(msg)) {
        setError("Error de red (no hubo respuesta del servidor o el navegador bloqueó la petición).");
      } else {
        setError(`Fallo al probar conexión: ${msg}`);
      }
    } finally {
      setBusy(null);
    }
  }

  const canCompare = Boolean(stage2?.result && stage3);
  const errorSummary = error ? summarizeSandboxError(error) : null;

  return (
    <div className="stage3ReviewSandbox stage3ReviewSandboxEmbedded">
      <div className="stage3ReviewSandboxSummary">
        <span className="stage3ReviewSandboxTitle">Herramientas de revision Etapa 3 (sandbox)</span>
        <span className="stage3ReviewSandboxHint">Diagnostico avanzado.</span>
        {errorSummary ? <span className="stage3ReviewStatusChip" title={error ?? undefined}>{errorSummary}</span> : null}
      </div>

      <div className="stage3ReviewSandboxBody">
        <p className="muted stage3ReviewSandboxHint">
          Opcional. No cambia el flujo principal. Usar JSON reparado solo sustituye el resultado si lo confirmas.
        </p>
        <div className="stage3ReviewSandboxActions">
          <button type="button" disabled={!canCompare || busy !== null} onClick={() => void post("validate")}>
            {busy === "validate" ? "..." : "Validar resultado Etapa 3"}
          </button>
          <button type="button" disabled={!canCompare || busy !== null} onClick={() => void post("missing")}>
            {busy === "missing" ? "..." : "Detectar items faltantes"}
          </button>
          <button type="button" disabled={!canCompare || !stage3?.runId || busy !== null} onClick={() => void post("history")}>
            {busy === "history" ? "..." : "Revisar historico exitoso"}
          </button>
          <button type="button" disabled={!stage3 || busy !== null} onClick={() => void post("domains")}>
            {busy === "domains" ? "..." : "Testear dominios"}
          </button>
          <button type="button" disabled={!stage3 || busy !== null} onClick={() => void post("evidence")}>
            {busy === "evidence" ? "..." : "Testear links completos"}
          </button>
          <button type="button" disabled={!stage3 || busy !== null} onClick={() => void post("googleUrl")}>
            {busy === "googleUrl" ? "..." : "Google URL Context"}
          </button>
          <button type="button" disabled={!stage3 || busy !== null} onClick={() => void post("supervisor")}>
            {busy === "supervisor" ? "..." : "Supervisor DeepSeek"}
          </button>
          <button type="button" disabled={!stage3 || busy !== null} onClick={() => void post("repair")}>
            {busy === "repair" ? "..." : "Reparar JSON Etapa 3"}
          </button>
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void runProbe()}>
            {busy === "probe" ? "..." : "Probar conexion (agente reparacion)"}
          </button>
        </div>

        {error ? (
          <details className="stage3ReviewInlineIssue">
            <summary><span className="stage3ReviewIssueIcon">!</span> {errorSummary}</summary>
            <pre className="stage3ReviewIssuePre">{error}</pre>
          </details>
        ) : null}

        {probeInfo && probeInfo.ok === true ? (
          <div className="stage3ProbeOk" role="status">
            <div className="stage3ProbeOkTitle">Prueba de conexion al proveedor del agente</div>
            <p className="muted stage3ProbeOkMeta">
              Latencia ~{String(probeInfo.latencyMs ?? "?")} ms - {String(probeInfo.provider ?? "?")} - {" "}
              {String(probeInfo.model ?? "?")}
              {probeInfo.jsonMatchesProbeShape === false ? (
                <span> - El modelo respondio pero el JSON no coincide con la forma esperada (revisa snippet).</span>
              ) : null}
            </p>
            {typeof probeInfo.responseSnippet === "string" ? (
              <pre className="stage3ProbeOkPre">{probeInfo.responseSnippet}</pre>
            ) : null}
          </div>
        ) : null}

        {repairFailureRaw ? (
          <div className="stage3RepairModelRaw" aria-label="Respuesta del modelo en reparacion">
            <div className="stage3RepairModelRawTitle">Texto devuelto por el modelo (reparacion JSON)</div>
            <pre className="stage3RepairModelRawPre">{repairFailureRaw}</pre>
          </div>
        ) : null}

        {report ? (
          <details className="stage3ReviewDetails">
            <summary>Validacion (solo lectura)</summary>
            <pre className="stage3ReviewPre">{JSON.stringify(report, null, 2)}</pre>
          </details>
        ) : null}

        {missing ? (
          <details className="stage3ReviewDetails">
            <summary>{missing.summary}</summary>
            {missing.missingLabels.length ? (
              <ul className="stage3ReviewList">
                {missing.missingLabels.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nada que listar.</p>
            )}
          </details>
        ) : null}

        {historyInfo ? (
          <details className="stage3ReviewDetails">
            <summary>{String(historyInfo.recommendation ?? "Revision de historico lista")}</summary>
            <pre className="stage3ReviewPre">{JSON.stringify(historyInfo, null, 2)}</pre>
          </details>
        ) : null}

        {sourceDomains ? (
          <details className="stage3ReviewDetails">
            <summary>{formatSourceDomainSummary(sourceDomains)}</summary>
            <pre className="stage3ReviewPre">{JSON.stringify(sourceDomains, null, 2)}</pre>
          </details>
        ) : null}

        {sourceEvidence ? (
          <details className="stage3ReviewDetails">
            <summary>{formatSourceEvidenceSummary(sourceEvidence)}</summary>
            <AuditHumanSummary data={{ action: "evidence", ...sourceEvidence }} />
            <details className="jsonDetails stageExperimentRaw">
              <summary>JSON tecnico links completos</summary>
              <pre className="stage3ReviewPre">{JSON.stringify(sourceEvidence, null, 2)}</pre>
            </details>
          </details>
        ) : null}

        {sourceGoogleUrl ? (
          <details className="stage3ReviewDetails" open>
            <summary>{formatSourceGoogleUrlSummary(sourceGoogleUrl)}</summary>
            <AuditHumanSummary data={{ action: "googleUrl", ...sourceGoogleUrl }} />
            <details className="jsonDetails stageExperimentRaw">
              <summary>JSON tecnico Google URL Context</summary>
              <pre className="stage3ReviewPre">{JSON.stringify(sourceGoogleUrl, null, 2)}</pre>
            </details>
          </details>
        ) : null}

        {sourceSupervision ? (
          <details className="stage3ReviewDetails" open>
            <summary>{formatSourceSupervisorSummary(sourceSupervision)}</summary>
            <pre className="stage3ReviewPre">{JSON.stringify(sourceSupervision, null, 2)}</pre>
          </details>
        ) : null}

        {repaired !== undefined ? (
          <div className="stage3ReviewRepaired">
            {isPlainObj(repaired) ? (
              <button type="button" className="secondary" onClick={() => onApplyRepaired(repaired)}>
                Usar JSON reparado como resultado Etapa 3
              </button>
            ) : (
              <p className="muted">El modelo devolvio json_reparado vacio o nulo (revisa notas).</p>
            )}
            {repaired !== null && repaired !== undefined ? (
              <details className="stage3ReviewDetails">
                <summary>JSON reparado</summary>
                <pre className="stage3ReviewPre">{JSON.stringify(repaired, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {repairNotas.length > 0 ? (
          <ul className="muted stage3ReviewList">
            {repairNotas.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function formatSourceDomainSummary(data: Record<string, unknown>) {
  const summary = isRecord(data.summary) ? data.summary : null;
  const inspected = summary ? Number(summary.inspectedSources ?? 0) : 0;
  const ok = summary ? Number(summary.domainOk ?? 0) : 0;
  const bad = summary ? Number(summary.domainError ?? 0) + Number(summary.invalidUrl ?? 0) + Number(summary.missingUrl ?? 0) : 0;
  return summary ? `Dominios revisados: ${inspected} fuente(s), ${ok} ok, ${bad} con alerta` : "Dominios revisados";
}

function formatSourceEvidenceSummary(data: Record<string, unknown>) {
  const summary = isRecord(data.summary) ? data.summary : null;
  const inspected = summary ? Number(summary.inspectedSources ?? 0) : 0;
  const ok = summary ? Number(summary.ok ?? 0) : 0;
  const failed = summary ? Number(summary.failed ?? 0) : 0;
  if (summary) {
    return `Evidencia links lista: ${inspected} fuente(s), ${ok} ok, ${failed} con fallo`;
  }
  return "Evidencia links lista";
}

function formatSourceGoogleUrlSummary(data: Record<string, unknown>) {
  const result = isRecord(data.result) ? data.result : null;
  const summary = result && isRecord(result.resumen) ? result.resumen : null;
  const total = summary ? Number(summary.fuentes_validadas ?? 0) : 0;
  const ok = summary ? Number(summary.verificables ?? 0) : 0;
  const partial = summary ? Number(summary.candidata_parcial ?? 0) : 0;
  const noUrl = summary ? Number(summary.link_no_verificable ?? 0) : 0;
  return summary ? `Google URL Context: ${total} fuente(s), ${ok} verificable(s), ${partial} parcial(es), ${noUrl} no verificable(s)` : "Google URL Context listo";
}

function formatSourceSupervisorSummary(data: Record<string, unknown>) {
  const supervision = isRecord(data.supervision) ? data.supervision : null;
  const resumen = supervision && isRecord(supervision.resumen) ? supervision.resumen : null;
  const status = typeof resumen?.estado_general === "string" ? resumen.estado_general : "auditoria lista";
  const comment = typeof resumen?.comentario === "string" ? resumen.comentario : "";
  return comment ? `Auditoria DeepSeek: ${status} - ${comment}` : `Auditoria DeepSeek: ${status}`;
}

function summarizeSandboxError(message: string) {
  const firstLine = message.split("\n").map((line) => line.trim()).find(Boolean) ?? "Revision requiere atencion";
  return firstLine.length > 92 ? `${firstLine.slice(0, 89)}...` : firstLine;
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

function DynamicTable({ items, numberFormat = "es-CO" }: { items: Record<string, unknown>[]; numberFormat?: NumberDisplayFormat }) {
  const columns = useMemo(() => Object.keys(items[0] ?? {}), [items]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [adjustmentPopover, setAdjustmentPopover] = useState<AdjustmentPopoverState | null>(null);
  const [adjustmentValues, setAdjustmentValues] = useState<Record<string, number>>({});
  const [alertsDrawer, setAlertsDrawer] = useState<AlertsDrawerState>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

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
  const stickyColumnOffsets = useMemo(() => buildStickyColumnOffsets(visibleColumns, columnWidths), [visibleColumns, columnWidths]);

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

  function setColumnWidth(column: string, width: number) {
    setColumnWidths((current) => ({
      ...current,
      [column]: Math.max(80, Math.min(900, Math.round(width)))
    }));
  }

  function startColumnResize(column: string, event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = columnWidths[column] ?? getDefaultColumnWidth(column);

    const onMouseMove = (moveEvent: MouseEvent) => {
      setColumnWidth(column, startWidth + moveEvent.clientX - startX);
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup, { once: true });
  }

  function autoFitColumn(column: string, event?: ReactMouseEvent<HTMLSpanElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    const samples = [
      column,
      ...sortedItems.map((item) => getCellPlainTextForTitle(item[column], 240))
    ];
    const longest = samples.reduce((max, sample) => Math.max(max, sample.length), 0);
    setColumnWidth(column, Math.min(900, Math.max(96, longest * 7 + 40)));
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

      <div className="tableWrap tableWrapScroll financialTableWrap">
        <table className="dataTable dataTableCompact financialDataTable">
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
              {visibleColumns.map((column) => {
                const sticky = stickyColumnOffsets[column];
                return (
                <th
                  className={sticky ? `stickyColumn stickyColumnHeader stickyColumn${sticky.index}` : undefined}
                  key={column}
                  style={sticky ? { left: `${sticky.left}px` } : undefined}
                >
                  <div className="thContent">
                    <button
                      className={`sortButton${sortConfig?.column === column ? " sortButtonActive" : ""}`}
                      onClick={() => toggleSort(column)}
                      title={`Ordenar por ${column}`}
                      type="button"
                    >
                      <span className="thLabel">{column}</span>
                      <span className="sortMark">{getSortLabel(column, sortConfig)}</span>
                    </button>
                    <button
                      aria-label={`Ocultar ${column}`}
                      className="columnHideButton"
                      disabled={visibleColumns.length <= 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        hideColumn(column);
                      }}
                      title="Ocultar columna"
                      type="button"
                    >
                      {"\u00d7"}
                    </button>
                    <span
                      aria-hidden="true"
                      className="columnResizeHandle"
                      onDoubleClick={(event) => autoFitColumn(column, event)}
                      onMouseDown={(event) => startColumnResize(column, event)}
                      title="Arrastra para redimensionar. Doble clic para autoajustar."
                    />
                  </div>
                </th>
                );
              })}
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
                    const sticky = stickyColumnOffsets[column];
                    const raw = item[column];
                    const complex = isComplexCellValue(raw, column);
                    const isLongDescriptionColumn = isLongDescriptionOrFichaColumn(column);
                    const isAdjustmentColumn = isAdjustmentOfferColumn(column);
                    const isUtilityStatusColumn = isUtilityStatusColumnName(column);
                    const bodyClass = expanded
                      ? "cellBody cellBodyExpanded"
                      : complex
                        ? "cellBody cellBodyComplex"
                        : `cellBody cellBodyEllipsis${isLongDescriptionColumn ? " cellBodyStrictEllipsis" : ""}`;
                    const popoverKey = `${rowIndex}:${column}`;
                    const alerts = isUtilityStatusColumn ? extractAlertsFromValue(raw) : [];

                    return (
                      <td
                        className={[
                          getCellClassName(column),
                          isLongDescriptionColumn ? "tdLongText" : "",
                          isAdjustmentColumn ? "tdAdjustment" : "",
                          isUtilityStatusColumn ? "tdUtilityStatus" : "",
                          sticky ? `stickyColumn stickyColumnBody stickyColumn${sticky.index}` : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={column}
                        style={sticky ? { left: `${sticky.left}px` } : undefined}
                        title={getCellPlainTextForTitle(raw)}
                      >
                        {isAdjustmentColumn ? (
                          <div className="adjustmentCell">
                            <button
                              type="button"
                              className="ghostButton"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAdjustmentPopover((current) =>
                                  current?.rowIndex === rowIndex && current.column === column
                                    ? null
                                    : { rowIndex, column }
                                );
                              }}
                            >
                              Ajustar
                            </button>
                            {adjustmentPopover?.rowIndex === rowIndex && adjustmentPopover.column === column ? (
                              <div className="adjustmentPopover" onClick={(event) => event.stopPropagation()}>
                                <div className="adjustmentPopoverHeader">
                                  <strong>Ajuste Oferta</strong>
                                  <button
                                    type="button"
                                    className="popoverCloseButton"
                                    onClick={() => setAdjustmentPopover(null)}
                                    aria-label="Cerrar ajuste"
                                  >
                                    ×
                                  </button>
                                </div>
                                <label className="adjustmentSliderLabel">
                                  <span>{adjustmentValues[popoverKey] ?? 0}%</span>
                                  <input
                                    type="range"
                                    min={-30}
                                    max={30}
                                    step={1}
                                    value={adjustmentValues[popoverKey] ?? 0}
                                    onChange={(event) =>
                                      setAdjustmentValues((current) => ({
                                        ...current,
                                        [popoverKey]: Number(event.target.value)
                                      }))
                                    }
                                  />
                                </label>
                                <p className="muted adjustmentHint">
                                  Ajuste visual de fila. No modifica datos del pipeline.
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : isUtilityStatusColumn ? (
                          <UtilityStatusCell
                            value={raw}
                            alerts={alerts}
                            onOpenAlerts={(event) => {
                              event.stopPropagation();
                              setAlertsDrawer({ rowIndex, column, alerts });
                            }}
                          />
                        ) : (
                          <div
                            className={bodyClass}
                            title={isLongDescriptionColumn || complex ? getCellPlainTextForTitle(raw) : undefined}
                          >
                            {!expanded && complex ? getCellPlainTextForTitle(raw, 260) : formatCell(raw, column, numberFormat)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {alertsDrawer ? (
        <div className="alertsDrawerBackdrop" role="presentation" onClick={() => setAlertsDrawer(null)}>
          <aside
            className="alertsDrawer"
            role="dialog"
            aria-modal="true"
            aria-label="Alertas de la fila"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="alertsDrawerHeader">
              <div>
                <p className="alertsDrawerKicker">Fila {alertsDrawer.rowIndex + 1}</p>
                <h3>Alertas</h3>
              </div>
              <button
                type="button"
                className="popoverCloseButton"
                onClick={() => setAlertsDrawer(null)}
                aria-label="Cerrar alertas"
              >
                ×
              </button>
            </div>
            {alertsDrawer.alerts.length ? (
              <ul className="alertsDrawerList">
                {alertsDrawer.alerts.map((alert, index) => (
                  <li key={`${alert}-${index}`}>{alert}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Sin alertas registradas para esta fila.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function truncateTextForUi(value: string, limit = RAW_TEXT_PREVIEW_LIMIT) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n... [vista previa recortada: ${value.length - limit} caracteres adicionales]`;
}

function prepareJsonForUi(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return truncateTextForUi(value);
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  if (depth >= 5) {
    return "[contenido anidado recortado para la UI]";
  }

  if (Array.isArray(value)) {
    const maxItems = 80;
    const items = value.slice(0, maxItems).map((item) => prepareJsonForUi(item, depth + 1));
    if (value.length > maxItems) {
      items.push(`[${value.length - maxItems} elementos adicionales recortados para la UI]`);
    }
    return items;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, prepareJsonForUi(entry, depth + 1)])
  );
}

function JsonDetails({ title, value, subtle }: { title: string; value: unknown; subtle?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const preparedValue = useMemo(() => (isOpen ? prepareJsonForUi(value) : null), [isOpen, value]);

  return (
    <details
      className={`jsonDetails${subtle ? " jsonDetailsSubtle" : ""}`}
      open={isOpen}
      onToggle={(event) => setIsOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{title}</summary>
      {isOpen ? (
        <pre>{typeof preparedValue === "string" ? preparedValue : JSON.stringify(preparedValue, null, 2)}</pre>
      ) : null}
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
  displayNumberFormat = "es-CO",
  sourceLabel = "Etapa 3",
  financialSource = "stage3",
  onSetFinancialSource,
  sourceOptions = [],
  embedded = false,
  isAdminMode = false
}: {
  stage3Done: boolean;
  ingest: FinancialIngestPayload | null;
  loading: boolean;
  previewError: string | null;
  financialBusy: boolean;
  financialMessage: string | null;
  onSend: () => void;
  canSend: boolean;
  displayNumberFormat?: NumberDisplayFormat;
  sourceLabel?: string;
  financialSource?: Stage3FinancialSource;
  onSetFinancialSource?: Dispatch<SetStateAction<Stage3FinancialSource>>;
  sourceOptions?: Array<{ id: Stage3FinancialSource; label: string; hint: string; available: boolean }>;
  embedded?: boolean;
  isAdminMode?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const tableItems = useMemo(() => (ingest ? financialIngestToTableRows(ingest) : []), [ingest]);

  useEffect(() => {
    if (ingest) {
      setIsOpen(true);
    }
  }, [ingest]);

  const sourcePicker = sourceOptions.length ? (
    <div className="financialSourcePicker" role="group" aria-label="Fuente para Etapa 4">
      <div className="financialSourcePickerLabel">
        <span>Fuente de ingesta</span>
        <small>Etapa 2 permite saltar cotización y trabajar manualmente en el simulador.</small>
      </div>
      <div className="financialSourcePickerOptions">
        {sourceOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`financialSourceOption${financialSource === option.id ? " financialSourceOptionActive" : ""}`}
            disabled={!option.available || !onSetFinancialSource}
            onClick={() => onSetFinancialSource?.(option.id)}
            title={option.available ? option.hint : `${option.label} aún no tiene datos.`}
          >
            <span>{option.label}</span>
            <small>{option.hint}</small>
          </button>
        ))}
      </div>
    </div>
  ) : null;

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
        {sourcePicker}
        <p className="muted stageTabPlaceholder">Elige una fuente con datos para armar la vista previa financiera.</p>
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
        <span className="badge">Ingesta v2</span>
        <span className="badge">{sourceLabel}</span>
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
            {sourcePicker}
            <p className="muted ingestPreviewLine">
              Vista previa <strong>POST /api/import</strong> · contrato <strong>v2</strong>
              {ingest.settings?.usd_to_cop_rate != null ? ` - TRM USD ${ingest.settings.usd_to_cop_rate}` : null}
              <InfoTip
                label="Ingesta"
                text="Cada envío crea un cálculo nuevo en Simulador Financiero. El JSON coincide con el cuerpo del POST /api/import (contrato v2)."
              />
            </p>

            <div className="stageTabExportToolbar" role="region" aria-label="Exportar vista previa a Excel">
              <button
                type="button"
                className="stageTabExportExcelBtn"
                disabled={!tableItems.length}
                title={
                  tableItems.length
                    ? "Descargar la vista previa como Excel (.xlsx), mismas columnas que la tabla."
                    : "Sin filas en la vista previa para exportar."
                }
                onClick={() => downloadFinancialIngestPreviewExcel(ingest)}
              >
                Descargar Excel (.xlsx)
              </button>
              <span className="muted stageTabExportHint">
                {tableItems.length
                  ? `${tableItems.length} fila(s) · misma vista que la tabla siguiente.`
                  : "Sin filas exportables en la vista previa."}
              </span>
            </div>

            {tableItems.length ? (
              <DynamicTable items={tableItems} numberFormat={displayNumberFormat ?? "es-CO"} />
            ) : (
              <p className="empty">Sin filas exportables.</p>
            )}

            {isAdminMode ? (
              <div className="stageJsonStack">
                <JsonDetails title="JSON ingesta (v2)" value={ingest} subtle />
              </div>
            ) : null}

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
    return "USD 0,00";
  }

  return `USD ${formatNumberEsCO(value, { minFractionDigits: 2, maxFractionDigits: 6 })}`;
}

function formatCell(value: unknown, column?: string, numberFormat: NumberDisplayFormat = "es-CO"): ReactNode {
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

  if (isSourceLinkColumn(normalizedColumn) && typeof value === "string") {
    return <SourceLinkCell url={value} />;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return "";
    }

    return (
      <div className="cellList">
        {value.map((entry, index) => (
          <span className="cellLine" key={index}>
            {isRecord(entry) ? compactRecord(entry, numberFormat) : formatScalarForUi(entry, { numberFormat })}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return <span>{compactRecord(value as Record<string, unknown>, numberFormat)}</span>;
  }

  return formatScalarForUi(value, { numberFormat });
}


function isSourceLinkColumn(normalizedColumn: string) {
  return normalizedColumn.includes("link") || normalizedColumn.includes("url") || normalizedColumn.includes("enlace");
}

function SourceLinkCell({ url }: { url: string }) {
  const clean = url.trim();
  if (!clean) {
    return <span className="cellMuted">Sin link</span>;
  }

  let href = clean;
  try {
    const parsed = new URL(clean);
    href = parsed.toString();
  } catch {
    return <span className="sourceLinkInvalid" title={clean}>URL no valida</span>;
  }

  let label = "Abrir fuente";
  try {
    label = new URL(href).hostname.replace(/^www\./, "");
  } catch {}

  return (
    <a
      className="sourceLinkChip"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </a>
  );
}

function UtilityStatusCell({
  value,
  alerts,
  onOpenAlerts
}: {
  value: unknown;
  alerts: string[];
  onOpenAlerts: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const parsed = parseUtilityStatusValue(value);
  const toneClass = parsed.statusTone === "good" ? "utilityStatusGood" : "utilityStatusWarn";

  return (
    <div className="utilityStatusCell">
      <div className="utilityMoney">{parsed.money || "—"}</div>
      {parsed.percent ? <div className="utilityPercent">{parsed.percent}</div> : null}
      <div className="utilityStatusFooter">
        <span className={`statusBadge ${toneClass}`}>{parsed.statusLabel}</span>
        <button
          type="button"
          className={`alertsBellButton${alerts.length ? " hasAlerts" : ""}`}
          aria-label={alerts.length ? `Ver ${alerts.length} alertas` : "Sin alertas"}
          onClick={onOpenAlerts}
          title={alerts.length ? "Ver alertas" : "Sin alertas"}
        >
          🔔
        </button>
      </div>
    </div>
  );
}

function parseUtilityStatusValue(value: unknown) {
  const text = getCellPlainTextForTitle(value);
  const moneyMatch =
    text.match(/(?:COP|USD)\s*[\d.,]+/i) ??
    text.match(/[$]\s*[\d.,]+/) ??
    text.match(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/);
  const percentMatch = text.match(/-?\d+(?:[.,]\d+)?\s*%/);
  const normalized = normalizeLabel(text);
  const hasWarning =
    normalized.includes("alerta") ||
    normalized.includes("riesgo") ||
    normalized.includes("amarillo") ||
    normalized.includes("revision") ||
    normalized.includes("negativ");

  return {
    money: moneyMatch?.[0] ?? "",
    percent: percentMatch?.[0] ?? "",
    statusLabel: hasWarning ? "Revisar" : "OK",
    statusTone: hasWarning ? "warn" : "good"
  };
}

function extractAlertsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => getCellPlainTextForTitle(entry)).filter(Boolean);
  }
  if (isRecord(value)) {
    const candidates = [value.alertas, value.alerts, value.estado, value.status, value.detalle].filter(Boolean);
    return candidates.flatMap((entry) => extractAlertsFromValue(entry));
  }
  const text = getCellPlainTextForTitle(value);
  const alertCount = text.match(/(\d+)\s*alerta/i);
  if (alertCount) {
    return [`${alertCount[1]} alerta(s) reportada(s). Revisa el detalle técnico de la fila.`];
  }
  return text && normalizeLabel(text).includes("alerta") ? [text] : [];
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
          <span className="cellLabel">{label}:</span> {isRecord(entry) ? compactRecord(entry) : formatScalarForUi(entry)}
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
        <span className="cellLabel">Descartadas:</span> {formatNumberEsCO(discarded)}
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
    return "\u2195";
  }

  return sortConfig.direction === "asc" ? "\u2191" : "\u2193";
}

function buildStickyColumnOffsets(columns: string[], columnWidths: Record<string, number>) {
  const stickyCount = Math.min(4, columns.length);
  const offsets: Record<string, { left: number; index: number }> = {};
  let left = 0;

  for (let index = 0; index < stickyCount; index += 1) {
    const column = columns[index];
    offsets[column] = { left, index: index + 1 };
    left += columnWidths[column] ?? getDefaultColumnWidth(column);
  }

  return offsets;
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
    "confianza cotizacion",
    "fuente #",
    "moneda",
    "und",
    "cant"
  ]);

  if (compactColumns.has(normalized)) {
    return 104;
  }

  if (normalized.includes("link") || normalized.includes("url") || normalized.includes("enlace")) {
    return 220;
  }

  if (normalized.includes("soporte") || normalized.includes("observacion")) {
    return 360;
  }

  if (normalized.includes("producto encontrado") || normalized.includes("nombre o descripcion")) {
    return 260;
  }

  if (getCellClassName(column) === "tdWide") {
    return 268;
  }

  return 148;
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
    "fuente 3",
    "producto encontrado",
    "soporte / observacion",
    "link fuente"
  ]);

  return wideColumns.has(normalized) ? "tdWide" : undefined;
}

function isLongDescriptionOrFichaColumn(column: string) {
  const normalized = normalizeLabel(column);
  return (
    normalized === "descripcion" ||
    normalized === "ficha tecnica" ||
    normalized.includes("descripcion / ficha") ||
    normalized.includes("descripcion/ficha") ||
    normalized.includes("detalles o ficha")
  );
}

function isAdjustmentOfferColumn(column: string) {
  const normalized = normalizeLabel(column);
  return normalized.includes("ajuste oferta") || normalized.includes("ajuste de oferta");
}

function isUtilityStatusColumnName(column: string) {
  const normalized = normalizeLabel(column);
  return (
    normalized.includes("utilidad / estado") ||
    normalized.includes("utilidad/estado") ||
    (normalized.includes("utilidad") && normalized.includes("estado"))
  );
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

  if (typeof value === "number") {
    return formatNumberEsCO(value);
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
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

function compactRecord(value: Record<string, unknown>, numberFormat: NumberDisplayFormat = "es-CO") {
  const entries = Object.entries(value)
    .filter(([, entry]) => hasValue(entry))
    .slice(0, 6)
    .map(([key, entry]) => `${key}: ${formatCompactValue(entry, numberFormat)}`);

  return entries.join(" | ");
}

function formatCompactValue(value: unknown, numberFormat: NumberDisplayFormat = "es-CO"): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatCompactValue(entry, numberFormat)).join(", ");
  }

  if (isRecord(value)) {
    return compactRecord(value, numberFormat);
  }

  return formatScalarForUi(value, { numberFormat });
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
