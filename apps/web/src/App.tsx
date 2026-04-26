import { useEffect, useRef, useState } from "react";
import {
  askItemAI,
  askProcessAI,
  analyzeProcess,
  autoCorrectStage1,
  createProcess,
  deleteProcess,
  fetchDashboard,
  fetchLLMConfig,
  fetchProcessDetail,
  fetchProcesses,
  reanalyzeProcess,
  runStage1,
  saveLLMConfig,
  testLLMConfig,
  uploadDocuments,
  type Credentials,
} from "./api";
import type {
  Assessment,
  AIAssistantResponse,
  DashboardSummary,
  LLMConfig,
  LLMTestResult,
  ProcessCreateInput,
  ProcessDetail,
  ProcessRead,
  ProviderName,
  Stage1AutoFixResponse,
} from "./types";

const defaultCredentials: Credentials = {
  username: "admin",
  password: "admin123",
};

const fallbackDashboard: DashboardSummary = {
  total_processes: 0,
  analyzed_processes: 0,
  total_items: 0,
  open_issues: 0,
  classification_counts: {},
};

const defaultLLMConfig: LLMConfig = {
  provider_name: "disabled",
  base_url: "",
  model_name: "",
  api_key: "",
  enabled: false,
  timeout_seconds: 30,
  max_task_budget_usd: 2.5,
  max_process_budget_usd: 20,
  estimated_input_token_price: 0.0000005,
  estimated_output_token_price: 0.0000015,
  extra_headers: {},
};

const presets: Record<string, Partial<LLMConfig>> = {
  deepseek: {
    provider_name: "openai_compatible",
    base_url: "https://api.deepseek.com/v1",
    model_name: "deepseek-chat",
    enabled: true,
  },
  openai: {
    provider_name: "openai",
    base_url: "https://api.openai.com/v1",
    model_name: "gpt-4.1-mini",
    enabled: true,
  },
  compatible: {
    provider_name: "openai_compatible",
    base_url: "http://127.0.0.1:1234/v1",
    model_name: "openai-compatible-model",
    enabled: true,
  },
  disabled: {
    provider_name: "disabled",
    base_url: "",
    model_name: "",
    api_key: "",
    enabled: false,
  },
};

const discardedStorageKey = (processId: string) => `procurement-discarded:${processId}`;

function parseNumberLike(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  let cleaned = text.replace(/[^\d,.\-]/g, "");
  if (!cleaned) return null;

  if ((cleaned.match(/\./g) ?? []).length > 1 && !cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "");
  } else if ((cleaned.match(/,/g) ?? []).length > 1 && !cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(".") && !cleaned.includes(",")) {
    const parts = cleaned.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      cleaned = parts.join("");
    }
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length === 3) {
      cleaned = parts.join("");
    } else if (parts.length === 2) {
      cleaned = `${parts[0]}.${parts[1]}`;
    }
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCopValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const parsed = parseNumberLike(value);
  if (parsed === null) return String(value);
  const [integerPart, decimalPart] = parsed.toFixed(2).split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (decimalPart === "00") {
    return `$ ${grouped}`;
  }
  return `$ ${grouped},${decimalPart}`;
}

type AssessmentSortKey =
  | "item_number"
  | "raw_description"
  | "raw_quantity"
  | "raw_unit"
  | "price_ref_entity_unit"
  | "price_ref_entity_total"
  | "benchmark_median"
  | "gap_cop"
  | "gap_pct"
  | "classification"
  | "benchmark_points";

function compareAssessmentValues(left: string | number | null | undefined, right: string | number | null | undefined): number {
  const leftNumber = parseNumberLike(left);
  const rightNumber = parseNumberLike(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return String(left ?? "").localeCompare(String(right ?? ""), "es", { sensitivity: "base" });
}

function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString("es-CO");
  return String(value);
}

function consistencyTone(score: number | null | undefined): "high" | "medium" | "low" {
  const safeScore = Number(score ?? 0);
  if (safeScore >= 80) return "high";
  if (safeScore >= 60) return "medium";
  return "low";
}

function readAnalysisProgress(detail: ProcessDetail | null): AnalysisProgressMeta | null {
  const value = detail?.process?.metadata_json?.analysis_progress;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AnalysisProgressMeta;
}

type OperationTone = "system" | "llm" | "success" | "warning";
type OperationStatus = "running" | "success" | "error";

interface OperationLogEntry {
  id: string;
  at: string;
  message: string;
  tone: OperationTone;
}

interface OperationTracker {
  id: string;
  label: string;
  stage: string;
  percent: number;
  status: OperationStatus;
  usesAI: boolean;
  aiActive: boolean;
  logs: OperationLogEntry[];
}

interface AnalysisProgressMeta {
  current_stage_code?: string;
  current_stage_label?: string;
  progress_pct?: number;
  in_progress?: boolean;
  raw_items?: number;
  normalized_items?: number;
  validation_issues?: number;
  benchmark_points?: number;
  financial_assessments?: number;
  items_with_llm_search_plan?: number;
  items_with_escalated_search?: number;
}

interface StageDonutState {
  key: string;
  label: string;
  percent: number;
  hint: string;
  tone: "neutral" | "active" | "success";
}

interface IssueGroupSummary {
  key: string;
  severity: string;
  title: string;
  message: string;
  count: number;
  explanation: string;
  suggestedAction: string;
  statuses: string[];
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildOperationStageStates(
  detail: ProcessDetail | null,
  tracker: OperationTracker | null,
): StageDonutState[] {
  const progress = readAnalysisProgress(detail);
  const rawItems = detail?.raw_items.length ?? 0;
  const normalizedItems = detail?.normalized_items.length ?? 0;
  const issues = detail?.issues.length ?? 0;
  const benchmarkPoints = detail?.assessments.reduce((sum, item) => sum + item.benchmark_points, 0) ?? 0;
  const assessments = detail?.assessments.length ?? 0;
  const stage1 = detail?.stage_summaries.find((stage) => stage.stage_code === "stage_1_extraction_normalization");
  const stage2 = detail?.stage_summaries.find((stage) => stage.stage_code === "stage_2_review_validation");
  const stage3 = detail?.stage_summaries.find((stage) => stage.stage_code === "stage_3_benchmark_assessment");
  const currentStageCode = progress?.current_stage_code ?? "";
  const overallPercent = progress?.progress_pct ?? tracker?.percent ?? 0;

  const extractionPercent = rawItems > 0 || normalizedItems > 0
    ? 100
    : currentStageCode === "benchmark_financial" || currentStageCode === "completed"
      ? 100
      : clampPercent((overallPercent / 58) * 100);

  const validationPercent = currentStageCode === "benchmark_financial" || currentStageCode === "completed" || issues > 0
    ? 100
    : normalizedItems > 0
      ? 72
      : 0;

  const benchmarkPercent = assessments > 0
    ? 100
    : currentStageCode === "benchmark_financial"
      ? clampPercent(((overallPercent - 58) / 38) * 100)
      : currentStageCode === "completed"
        ? 100
        : 0;

  return [
    {
      key: "extraction",
      label: "Extracción",
      percent: extractionPercent,
      hint: rawItems > 0
        ? `${rawItems} filas RAW · ${normalizedItems} normalizadas`
        : stage1?.status === "review_required"
          ? "Pendiente de lectura confiable"
          : "Preparando lectura base",
      tone: extractionPercent >= 100 ? "success" : extractionPercent > 0 ? "active" : "neutral",
    },
    {
      key: "validation",
      label: "Validación",
      percent: validationPercent,
      hint: issues > 0
        ? `${issues} issues detectados`
        : stage2?.status === "ready"
          ? "Lista para revisión humana"
          : "Esperando datos estructurados",
      tone: validationPercent >= 100 ? "success" : validationPercent > 0 ? "active" : "neutral",
    },
    {
      key: "benchmark",
      label: "Benchmark",
      percent: benchmarkPercent,
      hint: benchmarkPercent >= 100
        ? `${assessments} artículos evaluados`
        : benchmarkPoints > 0
          ? `${benchmarkPoints} puntos benchmark acumulados`
          : stage3?.status === "review_required"
            ? "Buscando referencias de mercado"
            : "Aún no inicia",
      tone: benchmarkPercent >= 100 ? "success" : benchmarkPercent > 0 ? "active" : "neutral",
    },
  ];
}

function summarizeProvider(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "openai_compatible":
      return "OpenAI-compatible";
    default:
      return "Deshabilitado";
  }
}

function issueUserGuide(title: string, message: string): { explanation: string; suggestedAction: string } {
  const normalized = `${title} ${message}`.toLowerCase();
  if (normalized.includes("campos requeridos faltantes") || normalized.includes("faltan campos")) {
    return {
      explanation: "Hay filas donde faltan datos base como precio, cantidad, unidad o total. El sistema las marca porque con esos vacíos no puede validar ni valorar el artículo con confianza.",
      suggestedAction: "Revisa si el documento fuente sí trae esos datos, si quedaron en otra hoja o si hace falta apoyar la lectura con otra fuente más confiable.",
    };
  }
  if (normalized.includes("duplic")) {
    return {
      explanation: "El sistema detectó posibles artículos repetidos entre fuentes o filas muy parecidas que podrían representar el mismo ítem.",
      suggestedAction: "Confirma cuál fila es la oficial y descarta o corrige duplicados antes de seguir con benchmark y evaluación financiera.",
    };
  }
  if (normalized.includes("confidence") || normalized.includes("ocr")) {
    return {
      explanation: "La lectura local no quedó lo suficientemente confiable y puede haber texto o números mal capturados.",
      suggestedAction: "Revisa la evidencia visual, usa un documento más estructurado o vuelve a ejecutar con apoyo IA si la ambigüedad persiste.",
    };
  }
  if (normalized.includes("column") || normalized.includes("corrid")) {
    return {
      explanation: "El sistema sospecha que una tabla quedó desalineada y que valores de una columna se corrieron a otra.",
      suggestedAction: "Verifica la tabla fuente y prioriza Excel o tablas limpias antes de aceptar estos resultados.",
    };
  }
  if (normalized.includes("coma") || normalized.includes("punto") || normalized.includes("decimal")) {
    return {
      explanation: "Hay indicios de que los separadores de miles o decimales pueden estar interpretándose de forma ambigua.",
      suggestedAction: "Confirma el formato original del documento para evitar precios inflados o reducidos por error de separadores.",
    };
  }
  return {
    explanation: "El sistema encontró una situación que puede afectar la integridad del proceso o la confianza del análisis.",
    suggestedAction: "Abre el detalle técnico solo si necesitas revisar la evidencia exacta y decide si conviene corregir, descartar o reanalizar.",
  };
}

function buildIssueGroups(detail: ProcessDetail | null): IssueGroupSummary[] {
  if (!detail) return [];
  const grouped = new Map<string, IssueGroupSummary>();
  for (const issue of detail.issues) {
    const key = `${issue.severity}::${issue.title}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.statuses.includes(issue.status)) {
        existing.statuses.push(issue.status);
      }
      continue;
    }
    const guide = issueUserGuide(issue.title, issue.message);
    grouped.set(key, {
      key,
      severity: issue.severity,
      title: issue.title,
      message: issue.message,
      count: 1,
      explanation: guide.explanation,
      suggestedAction: guide.suggestedAction,
      statuses: issue.status ? [issue.status] : [],
    });
  }
  return [...grouped.values()].sort((left, right) => {
    const severityWeight = (value: string): number => {
      if (value === "critical") return 3;
      if (value === "high") return 2;
      if (value === "medium") return 1;
      return 0;
    };
    return severityWeight(right.severity) - severityWeight(left.severity) || right.count - left.count;
  });
}

export function App() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [dashboard, setDashboard] = useState<DashboardSummary>(fallbackDashboard);
  const [processes, setProcesses] = useState<ProcessRead[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(defaultLLMConfig);
  const [llmTestResult, setLlmTestResult] = useState<LLMTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const [isSavingLlm, setIsSavingLlm] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [isCreatingProcess, setIsCreatingProcess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [isForceReanalyzing, setIsForceReanalyzing] = useState(false);
  const [isRunningStage1, setIsRunningStage1] = useState(false);
  const [isAutoCorrectingStage1, setIsAutoCorrectingStage1] = useState(false);
  const [isDeletingProcess, setIsDeletingProcess] = useState(false);
  const [isAskingProcessAI, setIsAskingProcessAI] = useState(false);
  const [isAskingItemAI, setIsAskingItemAI] = useState(false);
  const [showDiscardedItems, setShowDiscardedItems] = useState(false);
  const [discardedConsolidatedIds, setDiscardedConsolidatedIds] = useState<string[]>([]);
  const [selectedForDiscardIds, setSelectedForDiscardIds] = useState<string[]>([]);
  const [assessmentSortKey, setAssessmentSortKey] = useState<AssessmentSortKey>("item_number");
  const [assessmentSortDirection, setAssessmentSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [processAIPrompt, setProcessAIPrompt] = useState("");
  const [processAIResponse, setProcessAIResponse] = useState<AIAssistantResponse | null>(null);
  const [itemAIPrompt, setItemAIPrompt] = useState("");
  const [itemAIResponse, setItemAIResponse] = useState<AIAssistantResponse | null>(null);
  const [operationTracker, setOperationTracker] = useState<OperationTracker | null>(null);
  const liveProgressSignatureRef = useRef("");
  const lastVisibleProgressAtRef = useRef<number>(Date.now());
  const progressNoticeLevelRef = useRef(0);
  const operationPanelRef = useRef<HTMLElement | null>(null);
  const [processForm, setProcessForm] = useState<ProcessCreateInput>({
    name: "",
    external_reference: "",
    contracting_entity: "",
    description: "",
    source_url: "",
    currency: "COP",
  });

  useEffect(() => {
    void loadOverview(defaultCredentials);
  }, []);

  useEffect(() => {
    if (!selectedProcessId) return;
    void fetchProcessDetail(selectedProcessId, credentials)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [selectedProcessId, credentials]);

  useEffect(() => {
    if (!selectedProcessId) {
      setDiscardedConsolidatedIds([]);
      setSelectedForDiscardIds([]);
      setProcessAIResponse(null);
      setProcessAIPrompt("");
      return;
    }
    const stored = window.localStorage.getItem(discardedStorageKey(selectedProcessId));
    if (!stored) {
      setDiscardedConsolidatedIds([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as string[];
      setDiscardedConsolidatedIds(Array.isArray(parsed) ? parsed : []);
      setSelectedForDiscardIds([]);
    } catch {
      setDiscardedConsolidatedIds([]);
      setSelectedForDiscardIds([]);
    }
  }, [selectedProcessId]);

  useEffect(() => {
    setItemAIResponse(null);
    setItemAIPrompt("");
  }, [selectedAssessment]);

  useEffect(() => {
    if (!operationTracker || operationTracker.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setOperationTracker((current) => {
        if (!current || current.status !== "running") {
          return current;
        }
        const nextPercent = Math.min(
          current.percent + (current.percent < 35 ? 7 : current.percent < 65 ? 4 : 2),
          92,
        );
        let nextStage = current.stage;
        if (nextPercent >= 72) {
          nextStage = current.aiActive
            ? "Consolidando resultados y validando apoyo IA"
            : "Consolidando resultados y refrescando vista";
        } else if (nextPercent >= 45) {
          nextStage = current.aiActive
            ? "Extracción local y resolución de ambigüedades con IA"
            : "Extracción y normalización local";
        } else if (nextPercent >= 18) {
          nextStage = "Clasificando documentos y preparando extractores";
        }
        return {
          ...current,
          percent: nextPercent,
          stage: nextStage,
        };
      });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [operationTracker?.id, operationTracker?.status]);

  useEffect(() => {
    if (!operationTracker || operationTracker.status !== "running") {
      return;
    }
    const timeout = window.setTimeout(() => {
      operationPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [operationTracker?.id, operationTracker?.status]);

  useEffect(() => {
    const liveRefreshActive = isAnalyzing || isReanalyzing || isForceReanalyzing;
    if (!liveRefreshActive || !selectedProcessId) {
      return undefined;
    }

    let cancelled = false;
    const syncLiveProgress = async () => {
      try {
        const [dashboardData, refreshed] = await Promise.all([
          fetchDashboard(credentials),
          fetchProcessDetail(selectedProcessId, credentials),
        ]);
        if (cancelled) return;
        setDashboard(dashboardData);
        setDetail(refreshed);

        const progress = readAnalysisProgress(refreshed);
        if (!progress || !operationTracker || operationTracker.status !== "running") {
          return;
        }

        const nextStage = progress.current_stage_label ?? operationTracker.stage;
        const nextPercent = typeof progress.progress_pct === "number"
          ? Math.max(operationTracker.percent, progress.progress_pct)
          : operationTracker.percent;
        const nextAiActive = nextStage.toLowerCase().includes("ia") || nextStage.toLowerCase().includes("benchmark");
        const signature = JSON.stringify([
          progress.current_stage_code ?? "",
          progress.progress_pct ?? "",
          progress.raw_items ?? "",
          progress.normalized_items ?? "",
          progress.benchmark_points ?? "",
          progress.financial_assessments ?? "",
        ]);

        let logMessage: string | undefined;
        if (liveProgressSignatureRef.current !== signature) {
          liveProgressSignatureRef.current = signature;
          lastVisibleProgressAtRef.current = Date.now();
          progressNoticeLevelRef.current = 0;
          if (progress.current_stage_code === "benchmark_financial") {
            logMessage = `Avance visible: RAW ${progress.raw_items ?? 0}, normalizados ${progress.normalized_items ?? 0}, benchmarks ${progress.benchmark_points ?? 0}, assessments ${progress.financial_assessments ?? 0}.`;
          } else {
            logMessage = `Avance visible: ${nextStage}`;
          }
        }

        updateOperation(
          { percent: nextPercent, stage: nextStage, aiActive: nextAiActive },
          logMessage,
          nextAiActive ? "llm" : "system",
        );
      } catch {
        // El polling es solo de apoyo visual; no debe romper la ejecución principal.
      }
    };

    void syncLiveProgress();
    const interval = window.setInterval(() => {
      void syncLiveProgress();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    isAnalyzing,
    isReanalyzing,
    isForceReanalyzing,
    selectedProcessId,
    credentials,
    operationTracker,
  ]);

  useEffect(() => {
    if (!operationTracker || operationTracker.status !== "running") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      if (!operationTracker || operationTracker.status !== "running") {
        return;
      }

      const elapsedMs = Date.now() - lastVisibleProgressAtRef.current;
      const currentStage = operationTracker.stage.toLowerCase();
      const inBenchmark = currentStage.includes("benchmark") || currentStage.includes("mercado");

      if (elapsedMs >= 120000 && progressNoticeLevelRef.current < 2) {
        progressNoticeLevelRef.current = 2;
        pushOperationLog(
          inBenchmark
            ? "El benchmark sigue trabajando y puede tardar varios minutos porque aún está consultando fuentes web y comparando resultados. No se ha detenido."
            : "El sistema sigue trabajando en esta etapa. La operación aún no se ha detenido, solo necesita más tiempo por el volumen o la complejidad del proceso.",
          "warning",
        );
        return;
      }

      if (elapsedMs >= 45000 && progressNoticeLevelRef.current < 1) {
        progressNoticeLevelRef.current = 1;
        pushOperationLog(
          inBenchmark
            ? "La etapa de benchmark lleva un rato corriendo. Es normal cuando el sistema sigue buscando y depurando referencias de mercado."
            : "Esta etapa lleva más tiempo de lo habitual, pero el sistema sigue activo y esperando nuevos resultados parciales.",
          "system",
        );
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [operationTracker]);

  function nowTimeLabel() {
    return new Date().toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function startOperation(label: string, options?: { usesAI?: boolean; initialStage?: string; initialLogs?: Array<{ message: string; tone?: OperationTone }> }) {
    liveProgressSignatureRef.current = "";
    lastVisibleProgressAtRef.current = Date.now();
    progressNoticeLevelRef.current = 0;
    const initialLogs = (options?.initialLogs ?? []).map((entry, index) => ({
      id: `${Date.now()}-${index}`,
      at: nowTimeLabel(),
      message: entry.message,
      tone: entry.tone ?? "system",
    }));
    setOperationTracker({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      stage: options?.initialStage ?? "Preparando solicitud",
      percent: 8,
      status: "running",
      usesAI: Boolean(options?.usesAI),
      aiActive: Boolean(options?.usesAI),
      logs: initialLogs,
    });
  }

  function pushOperationLog(message: string, tone: OperationTone = "system") {
    setOperationTracker((current) => {
      if (!current) return current;
      const nextLog: OperationLogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        at: nowTimeLabel(),
        message,
        tone,
      };
      return {
        ...current,
        logs: [...current.logs, nextLog].slice(-10),
      };
    });
  }

  function updateOperation(step: Partial<Pick<OperationTracker, "percent" | "stage" | "aiActive">>, logMessage?: string, tone: OperationTone = "system") {
    setOperationTracker((current) => {
      if (!current) return current;
      return {
        ...current,
        percent: step.percent ?? current.percent,
        stage: step.stage ?? current.stage,
        aiActive: step.aiActive ?? current.aiActive,
      };
    });
    if (logMessage) {
      pushOperationLog(logMessage, tone);
    }
  }

  function completeOperation(message: string) {
    setOperationTracker((current) => {
      if (!current) return current;
      const nextLog: OperationLogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        at: nowTimeLabel(),
        message,
        tone: "success",
      };
      return {
        ...current,
        percent: 100,
        stage: "Proceso completado",
        status: "success",
        aiActive: false,
        logs: [...current.logs, nextLog].slice(-10),
      };
    });
  }

  function failOperation(message: string) {
    setOperationTracker((current) => {
      if (!current) return current;
      const nextLog: OperationLogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        at: nowTimeLabel(),
        message,
        tone: "warning",
      };
      return {
        ...current,
        stage: "Se detectó un error",
        status: "error",
        aiActive: false,
        logs: [...current.logs, nextLog].slice(-10),
      };
    });
  }

  async function loadOverview(currentCredentials: Credentials) {
    try {
      const [dashboardData, processData, llmData] = await Promise.all([
        fetchDashboard(currentCredentials),
        fetchProcesses(currentCredentials),
        fetchLLMConfig(currentCredentials),
      ]);
      setDashboard(dashboardData);
      setProcesses(processData);
      setLlmConfig((prev) => ({
        ...prev,
        provider_name: llmData.provider_name,
        base_url: llmData.base_url ?? "",
        model_name: llmData.model_name ?? "",
        enabled: llmData.enabled,
        timeout_seconds: Number(llmData.config_json.timeout_seconds ?? prev.timeout_seconds),
        max_task_budget_usd: Number(llmData.config_json.max_task_budget_usd ?? prev.max_task_budget_usd),
        max_process_budget_usd: Number(llmData.config_json.max_process_budget_usd ?? prev.max_process_budget_usd),
        estimated_input_token_price: Number(
          llmData.config_json.estimated_input_token_price ?? prev.estimated_input_token_price,
        ),
        estimated_output_token_price: Number(
          llmData.config_json.estimated_output_token_price ?? prev.estimated_output_token_price,
        ),
        extra_headers: (llmData.config_json.extra_headers as Record<string, string> | undefined) ?? {},
        api_key: "",
      }));
      if (!selectedProcessId && processData.length > 0) {
        setSelectedProcessId(processData[0].id);
      }
      setLlmMessage(llmData.has_api_key ? `API key actual: ${llmData.api_key_masked}` : "No hay API key guardada.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la API");
    }
  }

  function applyPreset(presetName: keyof typeof presets) {
    const preset = presets[presetName];
    setLlmConfig((prev) => ({
      ...prev,
      ...preset,
      base_url: preset.base_url ?? prev.base_url,
      model_name: preset.model_name ?? prev.model_name,
      provider_name: (preset.provider_name as ProviderName | undefined) ?? prev.provider_name,
      enabled: preset.enabled ?? prev.enabled,
      api_key: preset.api_key ?? prev.api_key,
    }));
    setLlmMessage(
      presetName === "deepseek"
        ? "Preset DeepSeek cargado. Solo pega tu API key y prueba."
        : "Preset cargado.",
    );
  }

  async function handleSaveLlmConfig() {
    setIsSavingLlm(true);
    try {
      const saved = await saveLLMConfig(llmConfig, credentials);
      setLlmMessage(saved.has_api_key ? `Configuracion guardada. API key: ${saved.api_key_masked}` : "Configuracion guardada.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuracion LLM");
    } finally {
      setIsSavingLlm(false);
    }
  }

  async function handleTestLlmConfig() {
    setIsTestingLlm(true);
    try {
      const result = await testLLMConfig(llmConfig, credentials);
      setLlmTestResult(result);
      setLlmMessage(result.succeeded ? "Conexion LLM verificada correctamente." : "La prueba LLM fallo.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo probar la conexion LLM");
    } finally {
      setIsTestingLlm(false);
    }
  }

  async function handleCreateProcess() {
    if (!processForm.name?.trim()) {
      setError("El nombre del proceso es obligatorio.");
      return;
    }
    setIsCreatingProcess(true);
    try {
      const created = await createProcess(processForm, credentials);
      setProcesses((prev) => [created, ...prev]);
      setSelectedProcessId(created.id);
      setProcessForm({
        name: "",
        external_reference: "",
        contracting_entity: "",
        description: "",
        source_url: "",
        currency: "COP",
      });
      setLlmMessage("Proceso creado. Ahora sube los documentos reales.");
      setError(null);
      await loadOverview(credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proceso");
    } finally {
      setIsCreatingProcess(false);
    }
  }

  async function handleUploadDocuments() {
    if (!selectedProcessId) {
      setError("Selecciona o crea un proceso antes de subir documentos.");
      return;
    }
    if (selectedFiles.length === 0) {
      setError("Selecciona al menos un archivo.");
      return;
    }
    setIsUploading(true);
    try {
      await uploadDocuments(selectedProcessId, selectedFiles, credentials);
      setSelectedFiles([]);
      setLlmMessage("Documentos cargados. Ya puedes ejecutar el analisis.");
      setError(null);
      await loadOverview(credentials);
      const refreshed = await fetchProcessDetail(selectedProcessId, credentials);
      setDetail(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron subir los documentos");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAnalyzeSelectedProcess() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso para analizar.");
      return;
    }
    setIsAnalyzing(true);
    startOperation("Análisis completo del proceso", {
      usesAI: false,
      initialStage: "Preparando ejecución",
      initialLogs: [
        { message: "Se validó el proceso activo y se inició la solicitud al backend." },
        { message: "El motor local trabajará primero sobre documentos y tablas estructuradas." },
      ],
    });
    try {
      updateOperation({ percent: 16, stage: "Enviando solicitud al backend", aiActive: false }, "Solicitud enviada. El servidor empezó la lectura del proceso.");
      await analyzeProcess(selectedProcessId, credentials);
      updateOperation({ percent: 82, stage: "Sincronizando resultados", aiActive: false }, "El análisis terminó en servidor. Cargando resultados actualizados.");
      const [dashboardData, refreshed] = await Promise.all([
        fetchDashboard(credentials),
        fetchProcessDetail(selectedProcessId, credentials),
      ]);
      setDashboard(dashboardData);
      setDetail(refreshed);
      setLlmMessage("Analisis ejecutado. Revisa la matriz RAW, excepciones y assessment.");
      setError(null);
      completeOperation("Análisis finalizado. Ya puedes revisar etapas, resumen e informe de ejecución.");
    } catch (err) {
      failOperation("El análisis falló antes de completar el refresco de resultados.");
      setError(err instanceof Error ? err.message : "No se pudo ejecutar el analisis");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleReanalyzeSelectedProcess() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso para reanalizar.");
      return;
    }
    setIsReanalyzing(true);
    startOperation("Reanálisis del proceso", {
      usesAI: false,
      initialStage: "Reiniciando pipeline",
      initialLogs: [
        { message: "Se limpiaron resultados anteriores del proceso para recalcular desde cero." },
        { message: "La ejecución usará extracción local y validaciones duras." },
      ],
    });
    try {
      updateOperation({ percent: 18, stage: "Reprocesando documentos", aiActive: false }, "Reanálisis enviado. El sistema está reconstruyendo RAW y normalización.");
      await reanalyzeProcess(selectedProcessId, credentials);
      updateOperation({ percent: 84, stage: "Recargando vista consolidada", aiActive: false }, "Reanálisis completado en servidor. Actualizando panel del usuario.");
      const [dashboardData, refreshed] = await Promise.all([
        fetchDashboard(credentials),
        fetchProcessDetail(selectedProcessId, credentials),
      ]);
      setDashboard(dashboardData);
      setDetail(refreshed);
      setLlmMessage("Reanálisis ejecutado. El centro de ejecución volvió a abrirse con donas y bitácora del proceso.");
      setError(null);
      completeOperation("Reanálisis completado. El resumen y la traza ya están actualizados.");
    } catch (err) {
      failOperation("El reanálisis falló y no se pudieron refrescar los resultados.");
      setError(err instanceof Error ? err.message : "No se pudo ejecutar el reanalisis");
    } finally {
      setIsReanalyzing(false);
    }
  }

  async function handleForceAIReanalyze() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso para reanalizar con IA.");
      return;
    }
    setIsForceReanalyzing(true);
    startOperation("Reanálisis forzado con IA", {
      usesAI: true,
      initialStage: "Preparando reanálisis con apoyo IA",
      initialLogs: [
        { message: "Se activó la modalidad forzada con IA para las etapas que la requieran.", tone: "llm" },
        { message: "La extracción numérica sigue priorizando fuentes locales antes de pedir apoyo semántico." },
      ],
    });
    try {
      updateOperation(
        { percent: 20, stage: "Procesando documentos y habilitando apoyo IA", aiActive: true },
        "Solicitud enviada. El sistema puede llamar a la IA si detecta ambigüedad o inconsistencia.",
        "llm",
      );
      await reanalyzeProcess(selectedProcessId, credentials, true);
      updateOperation(
        { percent: 86, stage: "Integrando trazas e intervención IA", aiActive: true },
        "El backend terminó la evaluación. Se están cargando resultados y evidencia de intervención IA.",
        "llm",
      );
      const [dashboardData, refreshed] = await Promise.all([
        fetchDashboard(credentials),
        fetchProcessDetail(selectedProcessId, credentials),
      ]);
      setDashboard(dashboardData);
      setDetail(refreshed);
      setLlmMessage("Reanálisis con IA ejecutado. El centro de ejecución volvió a abrirse y muestra cada etapa del proceso.");
      setError(null);
      completeOperation("Reanálisis con IA completado. La bitácora y las etapas ya reflejan la intervención.");
    } catch (err) {
      failOperation("El reanálisis con IA falló antes de cerrar correctamente.");
      setError(err instanceof Error ? err.message : "No se pudo ejecutar el reanalisis forzado con IA");
    } finally {
      setIsForceReanalyzing(false);
    }
  }

  async function handleRunOnlyStage1(forceAi = false) {
    if (!selectedProcessId) {
      setError("Selecciona un proceso antes de ejecutar la etapa 1.");
      return;
    }
    setIsRunningStage1(true);
    startOperation("Ejecución aislada de etapa 1", {
      usesAI: forceAi,
      initialStage: "Preparando extracción y normalización",
      initialLogs: [
        { message: "Se ejecutará solo la etapa inicial del proceso para revisar integridad base." },
        {
          message: forceAi
            ? "La IA podrá intervenir si la etapa 1 detecta ambigüedad relevante."
            : "La etapa 1 correrá priorizando lógica local y validaciones estructurales.",
          tone: forceAi ? "llm" : "system",
        },
      ],
    });
    try {
      updateOperation(
        { percent: 18, stage: "Ejecutando extractores de etapa 1", aiActive: forceAi },
        "La etapa 1 ya está corriendo sobre documentos, tablas y normalización inicial.",
        forceAi ? "llm" : "system",
      );
      const result = await runStage1(selectedProcessId, credentials, forceAi);
      updateOperation(
        { percent: 84, stage: "Cargando score y resultados de etapa 1", aiActive: false },
        `La etapa 1 terminó con score ${result.consistency_score}/100 y estado ${result.status}.`,
        result.status === "ready" ? "success" : "warning",
      );
      const [dashboardData, refreshed] = await Promise.all([
        fetchDashboard(credentials),
        fetchProcessDetail(selectedProcessId, credentials),
      ]);
      setDashboard(dashboardData);
      setDetail(refreshed);
      setLlmMessage(
        result.status === "ready"
          ? `Etapa 1 completada. Score de consistencia: ${result.consistency_score}/100.`
          : `Etapa 1 ejecutada. Aún requiere revisión. Score: ${result.consistency_score}/100.`,
      );
      setError(null);
      completeOperation("La etapa 1 terminó y la vista ya muestra su score y bloqueos actuales.");
    } catch (err) {
      failOperation("La ejecución aislada de la etapa 1 falló.");
      setError(err instanceof Error ? err.message : "No se pudo ejecutar la etapa 1");
    } finally {
      setIsRunningStage1(false);
    }
  }

  async function handleAutoCorrectOnlyStage1() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso antes de autocorregir la etapa 1.");
      return;
    }
    setIsAutoCorrectingStage1(true);
    startOperation("Autocorrección guiada de etapa 1", {
      usesAI: true,
      initialStage: "Evaluando calidad base y acciones seguras",
      initialLogs: [
        { message: "El motor de decisiones revisará la etapa 1 y elegirá acciones permitidas.", tone: "llm" },
        { message: "La IA no inventará datos: solo podrá usar herramientas y rutas autorizadas del sistema." },
      ],
    });
    try {
      updateOperation(
        { percent: 22, stage: "IA planificando acciones de etapa 1", aiActive: true },
        "La IA está evaluando documentos, score y memoria histórica resumida para decidir acciones seguras.",
        "llm",
      );
      const result: Stage1AutoFixResponse = await autoCorrectStage1(selectedProcessId, credentials, true);
      updateOperation(
        { percent: 86, stage: "Reejecutando etapa 1 tras autocorrección", aiActive: false },
        result.summary,
        result.used_llm ? "llm" : "system",
      );
      const [dashboardData, refreshed] = await Promise.all([
        fetchDashboard(credentials),
        fetchProcessDetail(selectedProcessId, credentials),
      ]);
      setDashboard(dashboardData);
      setDetail(refreshed);
      setLlmMessage(
        result.after_score !== null && result.after_score !== undefined
          ? `Autocorrección de etapa 1 completada. Score: ${result.before_score ?? "-"} -> ${result.after_score}.`
          : "Autocorrección de etapa 1 completada.",
      );
      setError(null);
      completeOperation("La autocorrección terminó. Ya puedes revisar acciones aplicadas, score y bloqueos restantes.");
    } catch (err) {
      failOperation("La autocorrección de etapa 1 no pudo completarse.");
      setError(err instanceof Error ? err.message : "No se pudo autocorregir la etapa 1");
    } finally {
      setIsAutoCorrectingStage1(false);
    }
  }

  async function handleDeleteSelectedProcess() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso para eliminar.");
      return;
    }
    const currentProcessName = processes.find((item) => item.id === selectedProcessId)?.name ?? selectedProcessId;
    if (!window.confirm(`Se eliminara el proceso "${currentProcessName}" con sus documentos, items y reportes. Esta seguro?`)) {
      return;
    }
    setIsDeletingProcess(true);
    try {
      await deleteProcess(selectedProcessId, credentials);
      window.localStorage.removeItem(discardedStorageKey(selectedProcessId));
      setSelectedProcessId(null);
      setDetail(null);
      setProcessAIResponse(null);
      setItemAIResponse(null);
      await loadOverview(credentials);
      setLlmMessage("Proceso eliminado. El sistema quedo limpio para cargar una nueva prueba.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el proceso");
    } finally {
      setIsDeletingProcess(false);
    }
  }

  async function handleAskProcessAI() {
    if (!selectedProcessId) {
      setError("Selecciona un proceso antes de consultar a la IA.");
      return;
    }
    if (!processAIPrompt.trim()) {
      setError("Escribe una instruccion para la IA del proceso.");
      return;
    }
    setIsAskingProcessAI(true);
    startOperation("Consulta guiada a la IA del proceso", {
      usesAI: true,
      initialStage: "Preparando contexto controlado",
      initialLogs: [
        { message: "Se está armando el contexto del proceso para la IA.", tone: "llm" },
        { message: "La IA verá solo evidencia controlada: documentos, resumen, issues y traza." },
      ],
    });
    try {
      updateOperation({ percent: 28, stage: "IA analizando el proceso", aiActive: true }, "La IA está evaluando el proceso con el contexto controlado.", "llm");
      const response = await askProcessAI(selectedProcessId, processAIPrompt.trim(), credentials);
      setProcessAIResponse(response);
      setLlmMessage(
        response.can_execute_requested_action
          ? "Consulta a IA completada para el proceso."
          : "La IA respondió, pero indicó que esa acción no puede ejecutarse directamente desde el chat.",
      );
      setError(null);
      completeOperation("La IA respondió para el proceso. Ya puedes revisar acciones sugeridas y evidencia usada.");
    } catch (err) {
      failOperation("La consulta a IA del proceso no pudo completarse.");
      setError(err instanceof Error ? err.message : "No se pudo consultar la IA para el proceso");
    } finally {
      setIsAskingProcessAI(false);
    }
  }

  async function handleAskProcessAIPreset(prompt: string) {
    if (!selectedProcessId) {
      setError("Selecciona un proceso antes de consultar a la IA.");
      return;
    }
    setProcessAIPrompt(prompt);
    setIsAskingProcessAI(true);
    try {
      const response = await askProcessAI(selectedProcessId, prompt, credentials);
      setProcessAIResponse(response);
      setLlmMessage("Consulta dirigida a IA completada para esta etapa.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar la IA para esta etapa");
    } finally {
      setIsAskingProcessAI(false);
    }
  }

  async function handleAskItemAI() {
    if (!selectedProcessId || !selectedAssessment?.normalized_item_id) {
      setError("Selecciona un articulo valido antes de consultar a la IA.");
      return;
    }
    if (!itemAIPrompt.trim()) {
      setError("Escribe una instruccion para la IA del articulo.");
      return;
    }
    setIsAskingItemAI(true);
    startOperation("Consulta IA para artículo puntual", {
      usesAI: true,
      initialStage: "Empaquetando contexto del artículo",
      initialLogs: [
        { message: "Se está construyendo el contexto del artículo y sus benchmarks.", tone: "llm" },
      ],
    });
    try {
      updateOperation({ percent: 30, stage: "IA revisando artículo y fuentes", aiActive: true }, "La IA está evaluando el artículo seleccionado dentro del contexto del proceso.", "llm");
      const response = await askItemAI(
        selectedProcessId,
        selectedAssessment.normalized_item_id,
        itemAIPrompt.trim(),
        credentials,
      );
      setItemAIResponse(response);
      setLlmMessage(
        response.can_execute_requested_action
          ? "Consulta a IA completada para el articulo."
          : "La IA respondió para el artículo, pero marcó límites operativos del sistema.",
      );
      setError(null);
      completeOperation("La IA terminó de revisar el artículo. Ya puedes leer su respuesta y evidencia.");
    } catch (err) {
      failOperation("La consulta IA del artículo falló.");
      setError(err instanceof Error ? err.message : "No se pudo consultar la IA para el articulo");
    } finally {
      setIsAskingItemAI(false);
    }
  }

  function toggleDiscardSelection(rawItemId: string, checked: boolean) {
    setSelectedForDiscardIds((current) =>
      checked ? Array.from(new Set([...current, rawItemId])) : current.filter((item) => item !== rawItemId),
    );
  }

  function discardSelectedItems() {
    if (!selectedProcessId) return;
    if (selectedForDiscardIds.length === 0) return;
    const next = Array.from(new Set([...discardedConsolidatedIds, ...selectedForDiscardIds]));
    setDiscardedConsolidatedIds(next);
    setSelectedForDiscardIds([]);
    window.localStorage.setItem(discardedStorageKey(selectedProcessId), JSON.stringify(next));
  }

  function restoreAllDiscarded() {
    if (!selectedProcessId) return;
    setDiscardedConsolidatedIds([]);
    setSelectedForDiscardIds([]);
    window.localStorage.removeItem(discardedStorageKey(selectedProcessId));
  }

  const visibleConsolidatedItems = detail
    ? detail.consolidated_items.filter((item) => showDiscardedItems || !discardedConsolidatedIds.includes(item.raw_item_id))
    : [];
  const stage1Summary = detail?.stage_summaries.find((stage) => stage.stage_code === "stage_1_extraction_normalization") ?? null;
  const assessmentRows = detail
    ? detail.assessments
        .map((assessment) => {
          const sourceItem = detail.consolidated_items.find(
            (item) => item.normalized_item_id === assessment.normalized_item_id,
          );
          if (!sourceItem) return null;
          return { assessment, sourceItem };
        })
        .filter((row): row is { assessment: NonNullable<typeof detail>["assessments"][number]; sourceItem: NonNullable<typeof detail>["consolidated_items"][number] } => row !== null)
    : [];
  const sortedAssessmentRows = [...assessmentRows].sort((left, right) => {
    const valueLeft =
      assessmentSortKey in left.assessment
        ? left.assessment[assessmentSortKey as keyof Assessment]
        : left.sourceItem[assessmentSortKey as keyof typeof left.sourceItem];
    const valueRight =
      assessmentSortKey in right.assessment
        ? right.assessment[assessmentSortKey as keyof Assessment]
        : right.sourceItem[assessmentSortKey as keyof typeof right.sourceItem];
    const comparison = compareAssessmentValues(
      valueLeft as string | number | null | undefined,
      valueRight as string | number | null | undefined,
    );
    return assessmentSortDirection === "asc" ? comparison : -comparison;
  });

  function toggleAssessmentSort(column: AssessmentSortKey) {
    if (assessmentSortKey === column) {
      setAssessmentSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setAssessmentSortKey(column);
    setAssessmentSortDirection("asc");
  }

  function sortIndicator(column: AssessmentSortKey): string {
    if (assessmentSortKey !== column) return "";
    return assessmentSortDirection === "asc" ? " ▲" : " ▼";
  }

  const operationStageStates = buildOperationStageStates(detail, operationTracker);
  const issueGroups = buildIssueGroups(detail);
  const llmProviderSummary = summarizeProvider(llmConfig.provider_name);
  const llmStatusSummary = llmConfig.enabled ? "Asistente IA habilitado" : "Asistente IA deshabilitado";
  const llmKeySummary = llmMessage ?? "La API key se mantiene oculta; usa este panel solo cuando necesites cambiar o probar la conexión.";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Colombia Public Procurement</p>
          <h1>Procurement Analytics</h1>
          <p className="subtle">Auditoria documental, extraccion exacta y evaluacion financiera.</p>
        </div>

        <section className="credentials">
          <h2>Acceso</h2>
          <label>
            Usuario
            <input
              value={credentials.username}
              onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
            />
          </label>
          <label>
            Clave
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <button onClick={() => void loadOverview(credentials)}>Conectar</button>
        </section>

        <section>
          <h2>Procesos</h2>
          <div className="process-list">
            {processes.map((process) => (
              <button
                key={process.id}
                className={selectedProcessId === process.id ? "process-card active" : "process-card"}
                onClick={() => setSelectedProcessId(process.id)}
              >
                <span>{process.name}</span>
                <small>{process.status}</small>
              </button>
            ))}
            {processes.length === 0 && <p className="subtle">Aun no hay procesos cargados.</p>}
          </div>
        </section>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <p className="eyebrow">Panel Ejecutivo</p>
            <h2>Integridad primero, IA con guardrails.</h2>
          </div>
          <div className="stats">
            <Metric label="Procesos" value={dashboard.total_processes} />
            <Metric label="Analizados" value={dashboard.analyzed_processes} />
            <Metric label="Items" value={dashboard.total_items} />
            <Metric label="Excepciones" value={dashboard.open_issues} danger />
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}
        {llmMessage && <div className="info-banner">{llmMessage}</div>}
        <details className="panel section-details config-shell">
          <summary className="details-summary">
            <div className="details-summary-main">
              <p className="eyebrow">Configuración</p>
              <h3>Conexión API para IA</h3>
              <p className="subtle">
                Esta zona queda oculta por defecto para que no meta ruido visual. Ábrela solo cuando necesites conectar, cambiar o probar un proveedor.
              </p>
            </div>
            <div className="details-summary-meta">
              <span className="summary-chip">{llmProviderSummary}</span>
              <span className="summary-chip">{llmStatusSummary}</span>
              <span className="details-hint">Abrir configuración</span>
            </div>
          </summary>
          <div className="details-body">
            <div className="config-intro-card">
              <strong>Estado actual</strong>
              <p className="subtle">{llmKeySummary}</p>
            </div>
            <div className="panel-header">
              <div>
                <h4>DeepSeek, OpenAI o cualquier API OpenAI-compatible</h4>
                <p className="subtle">
                  Configura aquí el proveedor que el sistema puede usar cuando una etapa requiera apoyo semántico o reanálisis asistido.
                </p>
              </div>
              <div className="button-row">
                <button className="ghost-button" onClick={() => applyPreset("deepseek")}>
                  Usar DeepSeek
                </button>
                <button className="ghost-button" onClick={() => applyPreset("openai")}>
                  Usar OpenAI
                </button>
                <button className="ghost-button" onClick={() => applyPreset("compatible")}>
                  Compatible local
                </button>
              </div>
            </div>

            <div className="config-grid">
              <label>
                Proveedor
                <select
                  value={llmConfig.provider_name}
                  onChange={(event) =>
                    setLlmConfig((prev) => ({ ...prev, provider_name: event.target.value as ProviderName }))
                  }
                >
                  <option value="disabled">Deshabilitado</option>
                  <option value="openai_compatible">OpenAI-compatible</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                Base URL
                <input
                  value={llmConfig.base_url ?? ""}
                  onChange={(event) => setLlmConfig((prev) => ({ ...prev, base_url: event.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                />
              </label>
              <label>
                Modelo
                <input
                  value={llmConfig.model_name ?? ""}
                  onChange={(event) => setLlmConfig((prev) => ({ ...prev, model_name: event.target.value }))}
                  placeholder="deepseek-chat"
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={llmConfig.api_key}
                  onChange={(event) => setLlmConfig((prev) => ({ ...prev, api_key: event.target.value }))}
                  placeholder="Pega aqui tu API key"
                />
              </label>
              <label>
                Timeout (s)
                <input
                  type="number"
                  value={llmConfig.timeout_seconds}
                  onChange={(event) => setLlmConfig((prev) => ({ ...prev, timeout_seconds: Number(event.target.value) }))}
                />
              </label>
              <label>
                Budget por tarea (USD)
                <input
                  type="number"
                  step="0.1"
                  value={llmConfig.max_task_budget_usd}
                  onChange={(event) =>
                    setLlmConfig((prev) => ({ ...prev, max_task_budget_usd: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <div className="button-row">
              <button onClick={() => void handleSaveLlmConfig()} disabled={isSavingLlm}>
                {isSavingLlm ? "Guardando..." : "Guardar configuracion"}
              </button>
              <button onClick={() => void handleTestLlmConfig()} disabled={isTestingLlm}>
                {isTestingLlm ? "Probando..." : "Probar conexion"}
              </button>
            </div>

            {llmTestResult && (
              <div className={llmTestResult.succeeded ? "assessment assessment-viable" : "assessment assessment-unviable"}>
                <strong>{llmTestResult.succeeded ? "Conexion exitosa" : "Conexion fallida"}</strong>
                <span>Proveedor: {llmTestResult.provider_name}</span>
                <span>Modelo: {llmTestResult.model_name}</span>
                <span>Costo estimado: {llmTestResult.estimated_cost_usd}</span>
                {llmTestResult.content_preview && <p>{llmTestResult.content_preview}</p>}
                {llmTestResult.error_message && <p>{llmTestResult.error_message}</p>}
              </div>
            )}
          </div>
        </details>
        {operationTracker && (
          <section ref={operationPanelRef} className="panel operation-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Centro de ejecución</p>
                <h3>{operationTracker.label}</h3>
              </div>
              <div className="button-row">
                <span
                  className={
                    operationTracker.status === "success"
                      ? "status trace-status-local"
                      : operationTracker.aiActive
                        ? "status trace-status-llm"
                        : "status"
                  }
                >
                  {operationTracker.status === "running"
                    ? operationTracker.aiActive
                      ? "IA actuando"
                      : "Sistema trabajando"
                    : operationTracker.status === "success"
                      ? "Completado"
                      : "Con alerta"}
                </span>
                <button type="button" className="ghost-button" onClick={() => setOperationTracker(null)}>
                  Ocultar
                </button>
              </div>
            </div>

            <div className="operation-layout">
              <div className="operation-ring-card">
                <div
                  className="operation-ring"
                  style={{
                    background: `conic-gradient(var(--accent) 0 ${operationTracker.percent}%, rgba(31, 42, 40, 0.12) ${operationTracker.percent}% 100%)`,
                  }}
                >
                  <div className="operation-ring-inner">
                    <strong>{Math.round(operationTracker.percent)}%</strong>
                    <span>{operationTracker.status === "running" ? "En curso" : "Finalizado"}</span>
                  </div>
                </div>
                <div className="operation-stage-copy">
                  <strong>{operationTracker.stage}</strong>
                  <p className="subtle">
                    {operationTracker.usesAI
                      ? "La interfaz te muestra cuando la IA entra a apoyar el flujo."
                      : "La ejecución actual está usando principalmente lógica local y reglas duras."}
                  </p>
                </div>
                <div className="operation-stage-grid">
                  {operationStageStates.map((stage) => (
                    <article key={stage.key} className={`operation-stage-card operation-stage-${stage.tone}`}>
                      <div
                        className="operation-stage-ring"
                        style={{
                          background: `conic-gradient(var(--accent) 0 ${stage.percent}%, rgba(31, 42, 40, 0.12) ${stage.percent}% 100%)`,
                        }}
                      >
                        <div className="operation-stage-ring-inner">
                          <strong>{stage.percent}%</strong>
                        </div>
                      </div>
                      <div className="operation-stage-text">
                        <strong>{stage.label}</strong>
                        <span>{stage.hint}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="operation-log-card">
                <div className="panel-header">
                  <div>
                    <h4>Bitácora visible</h4>
                    <p className="subtle">Aquí ves qué está haciendo el sistema mientras corre el proceso.</p>
                  </div>
                </div>
                <div className="operation-log-list">
                  {operationTracker.logs.map((entry) => (
                    <article key={entry.id} className={`operation-log-entry operation-log-${entry.tone}`}>
                      <span className="operation-log-time">{entry.at}</span>
                      <p>{entry.message}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nuevo proyecto</p>
              <h3>Crea el proceso, sube documentos y ejecuta el análisis inicial</h3>
              <p className="subtle">
                Este bloque es solo para iniciar un expediente nuevo. Las acciones sobre un proceso ya creado van aparte.
              </p>
            </div>
          </div>

          <div className="config-grid">
            <label>
              Nombre del proceso
              <input
                value={processForm.name ?? ""}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Ej. Invitacion publica papeleria 2026"
              />
            </label>
            <label>
              Referencia externa
              <input
                value={processForm.external_reference ?? ""}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, external_reference: event.target.value }))}
                placeholder="SECOP / IP-001-2026"
              />
            </label>
            <label>
              Entidad contratante
              <input
                value={processForm.contracting_entity ?? ""}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, contracting_entity: event.target.value }))}
                placeholder="Alcaldia / Hospital / Universidad"
              />
            </label>
            <label>
              URL fuente
              <input
                value={processForm.source_url ?? ""}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, source_url: event.target.value }))}
                placeholder="https://..."
              />
            </label>
            <label>
              Moneda
              <input
                value={processForm.currency ?? "COP"}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, currency: event.target.value }))}
              />
            </label>
            <label>
              Documentos del proceso
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.xlsm,.docx,.doc,.png,.jpg,.jpeg,.tiff,.bmp"
                onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              />
            </label>
          </div>

          <label className="full-width">
            Descripcion
            <textarea
              value={processForm.description ?? ""}
              onChange={(event) => setProcessForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Resumen del proceso, categoria de compra, notas de prueba..."
              rows={4}
            />
          </label>

          <div className="button-row">
            <button onClick={() => void handleCreateProcess()} disabled={isCreatingProcess}>
              {isCreatingProcess ? "Creando..." : "1. Crear proceso"}
            </button>
            <button onClick={() => void handleUploadDocuments()} disabled={isUploading || !selectedProcessId}>
              {isUploading ? "Subiendo..." : "2. Subir documentos"}
            </button>
            <button onClick={() => void handleAnalyzeSelectedProcess()} disabled={isAnalyzing || !selectedProcessId}>
              {isAnalyzing ? "Analizando..." : "3. Ejecutar análisis inicial"}
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="stack-list compact-list">
              {selectedFiles.map((file) => (
                <div key={`${file.name}-${file.size}`} className="issue">
                  <strong>{file.name}</strong>
                  <span>{Math.round(file.size / 1024)} KB</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel process-actions-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Proceso activo</p>
              <h3>Reanaliza, fuerza IA o elimina el proceso seleccionado</h3>
              <p className="subtle">
                Estas acciones vuelven a abrir el centro de ejecución con donas y bitácora para que veas el progreso paso a paso.
              </p>
            </div>
            {selectedProcessId ? (
              <span className="status">
                Proceso activo: {processes.find((item) => item.id === selectedProcessId)?.name ?? selectedProcessId}
              </span>
            ) : (
              <span className="status">No hay proceso seleccionado</span>
            )}
          </div>

          <div className="process-actions-grid">
            <article className="process-action-card">
              <strong>Reanalizar proceso</strong>
              <p className="subtle">
                Recorre de nuevo el flujo completo con lógica local, refresca resultados y muestra el avance en tiempo real.
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void handleReanalyzeSelectedProcess()}
                disabled={isReanalyzing || !selectedProcessId}
              >
                {isReanalyzing ? "Reanalizando..." : "Reanalizar proceso"}
              </button>
            </article>

            <article className="process-action-card">
              <strong>Reanalizar forzando IA</strong>
              <p className="subtle">
                Repite el análisis completo permitiendo más apoyo IA donde el sistema lo considere útil.
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void handleForceAIReanalyze()}
                disabled={isForceReanalyzing || !selectedProcessId}
              >
                {isForceReanalyzing ? "Forzando IA..." : "Reanalizar forzando IA"}
              </button>
            </article>

            <article className="process-action-card process-action-card-danger">
              <strong>Eliminar proceso</strong>
              <p className="subtle">
                Borra el expediente seleccionado, sus documentos y sus resultados para empezar limpio.
              </p>
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleDeleteSelectedProcess()}
                disabled={isDeletingProcess || !selectedProcessId}
              >
                {isDeletingProcess ? "Eliminando..." : "Eliminar proceso"}
              </button>
            </article>
          </div>
        </section>

        {detail ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Proceso seleccionado</p>
                  <h3>{detail.process.name}</h3>
                </div>
                <div className="button-row toolbar-row">
                  <span className={`status ${detail.process.status}`}>{detail.process.status}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleForceAIReanalyze()}
                    disabled={isForceReanalyzing}
                  >
                    {isForceReanalyzing ? "Forzando IA..." : "Forzar IA en etapas"}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void handleDeleteSelectedProcess()}
                    disabled={isDeletingProcess}
                  >
                    {isDeletingProcess ? "Eliminando..." : "Eliminar proceso"}
                  </button>
                </div>
              </div>
              <p className="subtle">{detail.process.description || "Sin descripcion adicional."}</p>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Flujo por etapas</p>
                  <h3>Primero valida la base del proceso, luego confía en lo demás</h3>
                </div>
              </div>
              <div className="stage-grid">
                {detail.stage_summaries.map((stage) => (
                  <article
                    key={stage.stage_code}
                    className={stage.status === "ready" ? "stage-card stage-ready" : "stage-card stage-review"}
                  >
                    <div className="panel-header">
                      <div>
                        <h4>{stage.title}</h4>
                        <p className="subtle">{stage.description}</p>
                      </div>
                      <div className="stage-status-stack">
                        <span className={stage.status === "ready" ? "status trace-status-local" : "status trace-status-llm"}>
                          {stage.status === "ready" ? "Lista" : "Revisar"}
                        </span>
                        <span className={`consistency-pill consistency-${consistencyTone(stage.consistency_score)}`}>
                          Score {stage.consistency_score}/100
                        </span>
                      </div>
                    </div>
                    <div className="stage-metrics-grid">
                      {Object.entries(stage.metrics).map(([metricKey, metricValue]) => (
                        <div key={metricKey} className="metric-inline">
                          <span>{metricKey}</span>
                          <strong>{formatMetricValue(metricValue)}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="subtle">{stage.recommended_action}</p>
                    {stage.blocking_reasons.length > 0 && (
                      <div className="stage-blockers">
                        {stage.blocking_reasons.slice(0, 3).map((reason) => (
                          <span key={reason} className="blocker-chip">{reason}</span>
                        ))}
                      </div>
                    )}
                    {stage.stage_code === "stage_1_extraction_normalization" && (
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => void handleRunOnlyStage1(false)}
                          disabled={isRunningStage1}
                        >
                          {isRunningStage1 ? "Ejecutando etapa 1..." : "Ejecutar solo etapa 1"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleAutoCorrectOnlyStage1()}
                          disabled={isAutoCorrectingStage1}
                        >
                          {isAutoCorrectingStage1 ? "Autocorrigiendo..." : "Autocorregir etapa 1 con IA"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            void handleAskProcessAIPreset(
                              "Revisa solo la etapa 1 del proceso: extracción y normalización. Explica por qué la lectura base puede estar fallando, qué filas parecen mal extraídas, qué documento parece más confiable y qué debería revisar el usuario antes de seguir.",
                            )
                          }
                          disabled={isAskingProcessAI}
                        >
                          {isAskingProcessAI ? "Consultando IA..." : "Pedir apoyo IA en etapa 1"}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <details className="raw-details" open>
                <summary>
                  <span>Etapa 1 · Extracción y normalización</span>
                  <small>Revisa aquí si la lectura base del PDF y del Excel quedó confiable antes de seguir.</small>
                </summary>
                <div className="raw-details-body stage-review-layout">
                  {stage1Summary && (
                    <div className="stage1-summary-banner">
                      <div className="stage1-summary-main">
                        <div>
                          <p className="eyebrow">Consistencia etapa 1</p>
                          <h4>{stage1Summary.consistency_score}/100</h4>
                        </div>
                        <div>
                          <p className="subtle">
                            {stage1Summary.status === "ready"
                              ? "La base documental ya está bastante confiable para seguir."
                              : "La etapa 1 todavía necesita revisión antes de confiar en el resto del proceso."}
                          </p>
                        </div>
                      </div>
                      {stage1Summary.blocking_reasons.length > 0 && (
                        <div className="stage-blockers">
                          {stage1Summary.blocking_reasons.map((reason) => (
                            <span key={reason} className="blocker-chip">{reason}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detail.stage1_last_auto_fix && (
                    <div className="stage-review-card stage-last-fix-card">
                      <div className="panel-header">
                        <div>
                          <h4>Última autocorrección de etapa 1</h4>
                          <p className="subtle">{detail.stage1_last_auto_fix.summary}</p>
                        </div>
                        <span className={detail.stage1_last_auto_fix.used_llm ? "status trace-status-llm" : "status"}>
                          {detail.stage1_last_auto_fix.used_llm ? "Usó IA" : "Solo reglas"}
                        </span>
                      </div>
                      <div className="stage-metrics-grid">
                        <div className="metric-inline">
                          <span>Score antes</span>
                          <strong>{detail.stage1_last_auto_fix.before_score ?? "-"}</strong>
                        </div>
                        <div className="metric-inline">
                          <span>Score después</span>
                          <strong>{detail.stage1_last_auto_fix.after_score ?? "-"}</strong>
                        </div>
                        <div className="metric-inline">
                          <span>Estado final</span>
                          <strong>{detail.stage1_last_auto_fix.stage_status_after ?? "-"}</strong>
                        </div>
                        <div className="metric-inline">
                          <span>Acciones</span>
                          <strong>{detail.stage1_last_auto_fix.actions_applied.length}</strong>
                        </div>
                      </div>
                      {detail.stage1_last_auto_fix.actions_applied.length > 0 && (
                        <div className="stage-blockers">
                          {detail.stage1_last_auto_fix.actions_applied.map((action, index) => (
                            <span key={`${String(action.action_type ?? "action")}-${index}`} className="action-chip">
                              {String(action.action_type ?? "acción")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="stage-review-card">
                    <div className="panel-header">
                      <div>
                        <h4>Rutas de extracción por documento</h4>
                        <p className="subtle">
                          Te ayuda a entender qué archivo leyó el sistema, con qué ruta y dónde puede estar fallando.
                        </p>
                      </div>
                    </div>
                    <div className="table-shell">
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Archivo</th>
                              <th>Tipo documental</th>
                              <th>Ruta</th>
                              <th>Clasificación</th>
                              <th>Páginas / hojas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.documents.map((document) => {
                              const metadata = document.metadata_json ?? {};
                              const route = ((metadata.profile as Record<string, unknown> | undefined)?.route as string | undefined) ?? "-";
                              const classification = ((metadata.classification as Record<string, unknown> | undefined)?.method as string | undefined) ?? "rules";
                              return (
                                <tr key={document.id}>
                                  <td>{document.file_name}</td>
                                  <td>{document.document_kind}</td>
                                  <td>{route}</td>
                                  <td>{classification}</td>
                                  <td>{document.page_count ?? "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="stage-review-card">
                    <div className="panel-header">
                      <div>
                        <h4>Vista normalizada derivada</h4>
                        <p className="subtle">
                          Esta capa no reemplaza el RAW. Sirve para validar si cantidades, unidades y valores se entendieron bien.
                        </p>
                      </div>
                    </div>
                    <div className="table-shell">
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>No. item</th>
                              <th>Descripción original</th>
                              <th>Descripción normalizada</th>
                              <th>Cantidad</th>
                              <th>Unidad</th>
                              <th>Vlr unitario COP</th>
                              <th>Total COP</th>
                              <th>Clave canónica</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.normalized_items.map((item) => {
                              const sourceRaw = detail.raw_items.find((raw) => raw.id === item.raw_item_id);
                              return (
                                <tr key={item.id}>
                                  <td>{sourceRaw?.item_number ?? "-"}</td>
                                  <td>{sourceRaw?.raw_description ?? "-"}</td>
                                  <td>{item.normalized_description ?? "-"}</td>
                                  <td>{item.quantity_num ?? "-"}</td>
                                  <td>{item.unit_normalized ?? "-"}</td>
                                  <td>{formatCopValue(item.unit_price_cop)}</td>
                                  <td>{formatCopValue(item.total_cop)}</td>
                                  <td>{item.canonical_item_key ?? "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </section>

            <section className="panel ai-chat-panel">
              <div className="panel-header">
                <div>
                  <h3>Asistente IA del proceso</h3>
                  <p className="subtle">
                    Este chat queda siempre disponible. Si le pides algo que el sistema no puede ejecutar desde aquí,
                    la respuesta debe decírtelo explícitamente.
                  </p>
                </div>
              </div>
              <div className="ai-panel">
                  <div className="ai-capability-grid">
                    <article className="ai-capability-card">
                      <strong>Puede ayudarte a</strong>
                      <ul>
                        <li>Revisar la evidencia ya cargada.</li>
                        <li>Explicar decisiones del sistema y detectar huecos.</li>
                        <li>Proponer el siguiente paso seguro dentro del flujo.</li>
                      </ul>
                    </article>
                    <article className="ai-capability-card ai-capability-card-warning">
                      <strong>No ejecuta por sí solo</strong>
                      <ul>
                        <li>No sube documentos nuevos desde este chat.</li>
                        <li>No modifica RAW ni dispara botones del backend.</li>
                        <li>No inventa datos si la evidencia no alcanza.</li>
                      </ul>
                    </article>
                  </div>
                  <label className="full-width">
                    Instruccion para la IA
                    <textarea
                      value={processAIPrompt}
                      onChange={(event) => setProcessAIPrompt(event.target.value)}
                      placeholder="Ej. revisa por que el benchmark del proceso quedo debil, dime en que etapa ves el cuello de botella y que harías para mejorarlo sin inventar datos."
                      rows={5}
                    />
                  </label>
                  <div className="button-row">
                    <button type="button" onClick={() => void handleAskProcessAI()} disabled={isAskingProcessAI}>
                      {isAskingProcessAI ? "Consultando IA..." : "Consultar IA del proceso"}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setProcessAIPrompt("")}>
                      Limpiar prompt
                    </button>
                  </div>
                  {processAIResponse && <AIResponsePanel response={processAIResponse} />}
                </div>
            </section>

            <section className="grid">
              <article className="panel">
                <h3>Documentos</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Tipo</th>
                      <th>Paginas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.documents.map((document) => (
                      <tr key={document.id}>
                        <td>{document.file_name}</td>
                        <td>{document.document_kind}</td>
                        <td>{document.page_count ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>

              <details className="panel section-details exceptions-panel">
                <summary className="details-summary">
                  <div className="details-summary-main">
                    <p className="eyebrow">Revisión</p>
                    <h3>Alertas y excepciones</h3>
                    <p className="subtle">
                      Este panel resume solo lo que realmente requiere atención. El detalle técnico queda oculto hasta que quieras abrirlo.
                    </p>
                  </div>
                  <div className="details-summary-meta">
                    <span className="summary-chip">{detail.issues.length} alertas</span>
                    <span className="summary-chip">{issueGroups.length} grupos</span>
                    <span className="details-hint">Abrir alertas</span>
                  </div>
                </summary>
                <div className="details-body">
                  {detail.issues.length === 0 ? (
                    <div className="assessment assessment-viable">
                      <strong>Sin alertas abiertas</strong>
                      <span>En esta fase el sistema no detectó problemas relevantes de integridad o revisión.</span>
                    </div>
                  ) : (
                    <>
                      <div className="exceptions-intro-card">
                        <strong>Qué significa esta bandeja</strong>
                        <p className="subtle">
                          Aquí no ves errores del sistema sin contexto. Ves alertas de revisión agrupadas para entender rápido qué está incompleto, ambiguo o potencialmente mal leído antes de confiar en el proceso.
                        </p>
                      </div>
                      <div className="issue-summary-grid">
                        {issueGroups.map((group) => (
                          <article key={group.key} className={`issue issue-${group.severity} issue-summary-card`}>
                            <div className="issue-summary-header">
                              <strong>{group.title}</strong>
                              <span className="summary-chip">{group.count} fila{group.count === 1 ? "" : "s"}</span>
                            </div>
                            <p>{group.explanation}</p>
                            <div className="issue-summary-meta">
                              <span><strong>Impacto:</strong> {group.message}</span>
                              <span><strong>Qué revisar:</strong> {group.suggestedAction}</span>
                              {group.statuses.length > 0 && (
                                <span><strong>Estado:</strong> {group.statuses.join(", ")}</span>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                      <details className="raw-details issue-technical-details">
                        <summary>
                          <span>Detalle técnico completo</span>
                          <small>{detail.issues.length} registros individuales para auditoría fina.</small>
                        </summary>
                        <div className="raw-details-body">
                          <div className="stack-list">
                            {detail.issues.map((issue) => (
                              <div key={issue.id} className={`issue issue-${issue.severity}`}>
                                <strong>{issue.title}</strong>
                                <span>{issue.message}</span>
                                <span className="subtle">Estado interno: {issue.status}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    </>
                  )}
                </div>
              </details>
            </section>

            <details className="panel section-details summary-panel">
              <summary className="details-summary">
                <div className="details-summary-main">
                  <p className="eyebrow">Vista del usuario</p>
                  <h3>Resumen consolidado de articulos</h3>
                  <p className="subtle">
                    Lista oficial de referencia para revisar articulos consolidados sin ruido del RAW.
                  </p>
                </div>
                <div className="details-summary-meta">
                  <span className="summary-chip">{visibleConsolidatedItems.length} visibles</span>
                  <span className="summary-chip">{detail.consolidated_items.length} consolidados</span>
                  <span className="summary-chip">{discardedConsolidatedIds.length} descartados</span>
                  <span className="details-hint">Abrir resumen</span>
                </div>
              </summary>
              <div className="details-body">
                <div className="summary-toolbar">
                  <div className="summary-toolbar-copy">
                    <strong>Fuente primaria por item</strong>
                    <p className="subtle">
                      El usuario trabaja sobre una vista consolidada. Los descartes solo limpian esta vista y nunca borran evidencia de origen.
                    </p>
                  </div>
                  <div className="button-row toolbar-row">
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={showDiscardedItems}
                        onChange={(event) => setShowDiscardedItems(event.target.checked)}
                      />
                      Mostrar descartadas
                    </label>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={restoreAllDiscarded}
                      disabled={discardedConsolidatedIds.length === 0}
                    >
                      Restaurar descartes
                    </button>
                  </div>
                </div>
                <div className="selection-banner">
                  <div>
                    <strong>Accion sobre filas seleccionadas</strong>
                    <p className="subtle">
                      Marca las casillas y luego usa <em>Descartar seleccionados</em>. Esos items se ocultaran temporalmente del resumen del usuario, sin borrar la evidencia RAW.
                    </p>
                  </div>
                  <div className="button-row toolbar-row">
                    <span className="selection-count">{selectedForDiscardIds.length} seleccionados</span>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setSelectedForDiscardIds([])}
                      disabled={selectedForDiscardIds.length === 0}
                    >
                      Limpiar seleccion
                    </button>
                    <button
                      type="button"
                      onClick={discardSelectedItems}
                      disabled={selectedForDiscardIds.length === 0}
                    >
                      Descartar seleccionados
                    </button>
                  </div>
                </div>
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Seleccionar</th>
                          <th>No. item</th>
                          <th>Descripcion exacta</th>
                          <th>Cant.</th>
                          <th>Unidad</th>
                          <th>Vlr unitario</th>
                          <th>Total</th>
                          <th>Origen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleConsolidatedItems.map((item) => {
                          const isDiscarded = discardedConsolidatedIds.includes(item.raw_item_id);
                          const isSelected = selectedForDiscardIds.includes(item.raw_item_id);
                          return (
                            <tr key={item.raw_item_id} className={isDiscarded ? "row-discarded" : undefined}>
                              <td>
                                <label className="checkbox-cell">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(event) => toggleDiscardSelection(item.raw_item_id, event.target.checked)}
                                  />
                                  <span>{isSelected ? "Lista para descartar" : "Seleccionar"}</span>
                                </label>
                              </td>
                              <td>{item.item_number ?? "-"}</td>
                              <td>{item.raw_description}</td>
                              <td>{item.raw_quantity ?? "-"}</td>
                              <td>{item.raw_unit ?? "-"}</td>
                              <td>{formatCopValue(item.raw_unit_price)}</td>
                              <td>{formatCopValue(item.raw_total)}</td>
                              <td>{item.origin ?? "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </details>

            <section className="panel">
              <details className="raw-details">
                <summary>
                  <span>Matriz de extraccion RAW</span>
                  <small>{detail.raw_items.length} registros. Cerrada por defecto para evitar ruido.</small>
                </summary>
                <div className="raw-details-body">
                  <div className="table-shell">
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>No. item</th>
                            <th>Descripcion exacta</th>
                            <th>Cant.</th>
                            <th>Unidad</th>
                            <th>Vlr unitario</th>
                            <th>Total</th>
                            <th>Origen</th>
                            <th>Rol fuente</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.raw_items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.item_number ?? "-"}</td>
                              <td>{item.raw_description}</td>
                              <td>{item.raw_quantity ?? "-"}</td>
                              <td>{item.raw_unit ?? "-"}</td>
                              <td>{formatCopValue(item.raw_unit_price)}</td>
                              <td>{formatCopValue(item.raw_total)}</td>
                              <td>{item.origin ?? "-"}</td>
                              <td>{item.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </details>
            </section>

            <section className="panel">
              <details className="raw-details">
                <summary>
                  <span>Informe de ejecución del análisis</span>
                  <small>
                    {detail.analysis_trace.length} etapas registradas. Aquí puedes ver qué hizo el sistema, en qué orden y si usó IA o no.
                  </small>
                </summary>
                <div className="raw-details-body">
                  {detail.analysis_trace.length === 0 ? (
                    <p className="subtle">Este proceso todavía no tiene traza de ejecución registrada.</p>
                  ) : (
                    <div className="trace-list">
                      {detail.analysis_trace.map((entry) => (
                        <article key={`${entry.stage_code}-${entry.order}`} className="trace-card">
                          <div className="panel-header">
                            <div>
                              <p className="eyebrow">Paso {entry.order}</p>
                              <h3>{entry.title}</h3>
                            </div>
                            <span className={entry.used_llm ? "status trace-status-llm" : "status trace-status-local"}>
                              {entry.used_llm ? "Usó IA" : "Sin IA"}
                            </span>
                          </div>
                          <p>{entry.logic_summary}</p>
                          <div className="trace-meta-grid">
                            <div>
                              <strong>Duración</strong>
                              <span>{entry.duration_ms} ms</span>
                            </div>
                            <div>
                              <strong>Estado</strong>
                              <span>{entry.status}</span>
                            </div>
                            <div>
                              <strong>LLM provider</strong>
                              <span>{entry.llm_provider ?? "-"}</span>
                            </div>
                            <div>
                              <strong>LLM model</strong>
                              <span>{entry.llm_model ?? "-"}</span>
                            </div>
                          </div>
                          <div className="trace-json-grid">
                            <div className="trace-json-card">
                              <strong>Entradas</strong>
                              <pre>{JSON.stringify(entry.inputs, null, 2)}</pre>
                            </div>
                            <div className="trace-json-card">
                              <strong>Salidas</strong>
                              <pre>{JSON.stringify(entry.outputs, null, 2)}</pre>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Assessment financiero</h3>
                  <p className="subtle">
                    La tabla compara siempre el dato original del proceso contra la conclusión financiera del sistema para el mismo ítem.
                  </p>
                </div>
              </div>
              {assessmentRows.length === 0 ? (
                <div className="stack-list">
                  <p className="subtle">Aun no hay benchmark suficiente o el proceso no se ha analizado.</p>
                </div>
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("item_number")}>No. item{sortIndicator("item_number")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("raw_description")}>Descripcion exacta{sortIndicator("raw_description")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("raw_quantity")}>Cant.{sortIndicator("raw_quantity")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("raw_unit")}>Unidad{sortIndicator("raw_unit")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("price_ref_entity_unit")}>Vlr unitario origen{sortIndicator("price_ref_entity_unit")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("price_ref_entity_total")}>Total origen{sortIndicator("price_ref_entity_total")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("benchmark_median")}>Benchmark mediana{sortIndicator("benchmark_median")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("gap_cop")}>Gap COP{sortIndicator("gap_cop")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("gap_pct")}>Gap %{sortIndicator("gap_pct")}</button></th>
                          <th><button type="button" className="sort-button" onClick={() => toggleAssessmentSort("classification")}>Clasificacion{sortIndicator("classification")}</button></th>
                          <th>Conclusion del sistema</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAssessmentRows.map(({ assessment, sourceItem }) => (
                          <tr key={assessment.id}>
                            <td>{assessment.item_number ?? sourceItem.item_number ?? "-"}</td>
                            <td>{assessment.raw_description ?? sourceItem.raw_description}</td>
                            <td>{assessment.raw_quantity ?? sourceItem.raw_quantity ?? "-"}</td>
                            <td>{assessment.raw_unit ?? sourceItem.raw_unit ?? "-"}</td>
                            <td>{formatCopValue(assessment.price_ref_entity_unit ?? sourceItem.raw_unit_price)}</td>
                            <td>{formatCopValue(assessment.price_ref_entity_total ?? sourceItem.raw_total)}</td>
                            <td>{formatCopValue(assessment.benchmark_median)}</td>
                            <td>{formatCopValue(assessment.gap_cop)}</td>
                            <td>{assessment.gap_pct ?? "N/D"}</td>
                            <td>
                              <span className={`classification-pill classification-${assessment.classification}`}>
                                {assessment.classification}
                              </span>
                            </td>
                            <td className="assessment-actions-cell">
                              <div className="assessment-cell-stack">
                                <span>{assessment.explanation ?? "-"}</span>
                                <button
                                  type="button"
                                  className="ghost-button small-button"
                                  onClick={() => setSelectedAssessment(assessment)}
                                >
                                  Ver detalle
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="panel">
            <h3>Sin proceso seleccionado</h3>
            <p className="subtle">Conecta la API y selecciona un proceso para revisar documentos, items y banderas.</p>
          </section>
        )}
      </main>
      {selectedAssessment && (
        <div className="modal-backdrop" onClick={() => setSelectedAssessment(null)}>
          <div className="detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Detalle del artículo</p>
                <h3>
                  Ítem {selectedAssessment.item_number ?? "-"} · {selectedAssessment.classification}
                </h3>
              </div>
              <button type="button" className="ghost-button" onClick={() => setSelectedAssessment(null)}>
                Cerrar
              </button>
            </div>

            <div className="detail-grid">
              <section className="detail-card">
                <h4>Dato original del proceso</h4>
                <dl className="detail-list">
                  <div><dt>No. item</dt><dd>{selectedAssessment.item_number ?? "-"}</dd></div>
                  <div><dt>Descripción exacta</dt><dd>{selectedAssessment.raw_description ?? "-"}</dd></div>
                  <div><dt>Cantidad</dt><dd>{selectedAssessment.raw_quantity ?? "-"}</dd></div>
                  <div><dt>Unidad</dt><dd>{selectedAssessment.raw_unit ?? "-"}</dd></div>
                  <div><dt>Vlr unitario origen</dt><dd>{formatCopValue(selectedAssessment.price_ref_entity_unit ?? selectedAssessment.raw_unit_price)}</dd></div>
                  <div><dt>Total origen</dt><dd>{formatCopValue(selectedAssessment.price_ref_entity_total ?? selectedAssessment.raw_total)}</dd></div>
                  <div><dt>Origen</dt><dd>{selectedAssessment.origin ?? "-"}</dd></div>
                </dl>
              </section>

              <section className="detail-card">
                <h4>Conclusión del sistema</h4>
                <dl className="detail-list">
                  <div><dt>Clasificación</dt><dd>{selectedAssessment.classification}</dd></div>
                  <div><dt>Benchmark min</dt><dd>{formatCopValue(selectedAssessment.benchmark_min)}</dd></div>
                  <div><dt>Benchmark P25</dt><dd>{formatCopValue(selectedAssessment.benchmark_p25)}</dd></div>
                  <div><dt>Benchmark mediana</dt><dd>{formatCopValue(selectedAssessment.benchmark_median)}</dd></div>
                  <div><dt>Benchmark P75</dt><dd>{formatCopValue(selectedAssessment.benchmark_p75)}</dd></div>
                  <div><dt>Dispersión</dt><dd>{formatCopValue(selectedAssessment.benchmark_dispersion)}</dd></div>
                  <div><dt>Gap COP</dt><dd>{formatCopValue(selectedAssessment.gap_cop)}</dd></div>
                  <div><dt>Gap %</dt><dd>{selectedAssessment.gap_pct ?? "N/D"}</dd></div>
                  <div><dt>Fuentes benchmark</dt><dd>{selectedAssessment.benchmark_points}</dd></div>
                </dl>
              </section>
            </div>

            <section className="detail-card detail-card-full">
              <h4>Análisis narrativo</h4>
              <p>{selectedAssessment.explanation ?? "Sin explicación disponible."}</p>
            </section>

            <section className="detail-card detail-card-full">
              <div className="panel-header">
                <div>
                  <h4>Asistente IA para este artículo</h4>
                  <p className="subtle">
                    Usa un prompt puntual para pedirle a la IA que revise este artículo dentro del contexto del proceso.
                  </p>
                </div>
              </div>
              <label className="full-width">
                Instrucción para la IA
                <textarea
                  value={itemAIPrompt}
                  onChange={(event) => setItemAIPrompt(event.target.value)}
                  placeholder="Ej. revisa si este artículo fue mal entendido, si el benchmark está flojo o qué búsquedas harías para mejorar la comparabilidad."
                  rows={4}
                />
              </label>
              <div className="button-row">
                <button type="button" onClick={() => void handleAskItemAI()} disabled={isAskingItemAI}>
                  {isAskingItemAI ? "Consultando IA..." : "Pedir apoyo IA para este artículo"}
                </button>
                <button type="button" className="ghost-button" onClick={() => setItemAIPrompt("")}>
                  Limpiar prompt
                </button>
              </div>
              {itemAIResponse && <AIResponsePanel response={itemAIResponse} />}
            </section>

            <section className="detail-card detail-card-full">
              <div className="panel-header">
                <div>
                  <h4>Fuentes de benchmark</h4>
                  <p className="subtle">Cada fila conserva la fuente y el nivel de comparabilidad usados por el sistema.</p>
                </div>
              </div>
              {selectedAssessment.benchmark_sources.length === 0 ? (
                <p className="subtle">No hay fuentes de benchmark asociadas a este artículo.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Fuente</th>
                      <th>Precio original</th>
                      <th>Precio normalizado COP</th>
                      <th>Comparabilidad</th>
                      <th>Presentación</th>
                      <th>Condición</th>
                      <th>Observaciones</th>
                      <th>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAssessment.benchmark_sources.map((source, index) => (
                      <tr key={`${source.source_name}-${index}`}>
                        <td>{source.source_name}</td>
                        <td>{formatCopValue(source.original_price)}</td>
                        <td>{formatCopValue(source.normalized_price_cop)}</td>
                        <td>
                          {source.comparability ?? "-"}
                          {source.comparability_score ? ` (${source.comparability_score})` : ""}
                        </td>
                        <td>{source.commercial_presentation ?? "-"}</td>
                        <td>{source.condition ?? "-"}</td>
                        <td>{source.observations ?? "-"}</td>
                        <td>
                          <a href={source.source_url} target="_blank" rel="noreferrer">
                            Abrir fuente
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function AIResponsePanel({ response }: { response: AIAssistantResponse }) {
  const modeLabel =
    response.execution_mode === "local_fallback"
      ? "Respuesta local de respaldo"
      : response.used_llm
        ? "Respuesta IA activa"
        : "Respuesta del sistema";
  const providerLabel =
    response.provider_name && response.model_name
      ? `${response.provider_name} | ${response.model_name}`
      : "Sin proveedor activo";

  return (
    <article className="detail-card ai-response-card">
      <div className="panel-header">
        <div>
          <h4>{modeLabel}</h4>
          <p className="subtle">{providerLabel}</p>
        </div>
        <span className={response.can_execute_requested_action ? "status trace-status-local" : "status trace-status-llm"}>
          {response.can_execute_requested_action ? "Dentro del alcance" : "Fuera del alcance operativo"}
        </span>
      </div>
      <p>{response.response}</p>
      {response.next_step && (
        <div className="ai-inline-banner">
          <strong>Siguiente paso sugerido</strong>
          <span>{response.next_step}</span>
        </div>
      )}
      {response.recommended_actions.length > 0 && (
        <div className="ai-list-block">
          <strong>Acciones sugeridas</strong>
          <ul>
            {response.recommended_actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response.available_actions.length > 0 && (
        <div className="ai-list-block">
          <strong>Lo que este chat sí puede hacer ahora</strong>
          <ul>
            {response.available_actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response.used_evidence.length > 0 && (
        <div className="ai-list-block">
          <strong>Evidencia usada</strong>
          <ul>
            {response.used_evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response.system_limits.length > 0 && (
        <div className="ai-list-block">
          <strong>Límites detectados</strong>
          <ul>
            {response.system_limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response.warnings.length > 0 && (
        <div className="ai-list-block">
          <strong>Advertencias</strong>
          <ul>
            {response.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={danger ? "metric danger" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
