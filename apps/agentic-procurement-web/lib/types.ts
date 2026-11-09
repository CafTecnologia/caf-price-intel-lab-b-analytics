import type { DocumentIntakeResult } from "./document-intake-contract";

export type ProviderId = "mock" | "codex_pc" | "codex_vps" | "deepseek" | "openrouter";
export type RunStatus = "draft" | "running" | "needs_review" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "passed" | "warning" | "failed" | "skipped";
export type Confidence = "high" | "medium" | "low" | "no_data";
export type Decision = "accept" | "accept_with_note" | "retry" | "human_review" | "no_result";
export type StageId = "source" | "extraction" | "technical" | "market" | "supervision";
export type ResolutionMode =
  | "direct_product"
  | "pack_conversion"
  | "bulk_proration"
  | "bundle_bom"
  | "product_plus_service"
  | "equivalent_benchmark"
  | "custom_fabrication"
  | "ambiguous";
export type AutomationLevel = "automatic" | "assisted" | "human";
export type ComponentKind = "product" | "accessory" | "consumable" | "service" | "shipping" | "custom";
export type VerificationValue = "yes" | "partial" | "no" | "unknown" | "not_applicable";

export type SourceReference = {
  file: string;
  sheet?: string;
  row?: number;
  page?: number;
  excerpt?: string;
};

export type OriginalItem = {
  id: string;
  name: string;
  description: string;
  unit: string;
  quantity: string | number;
  ceilingPrice: string;
  lot?: string;
  source: SourceReference;
  raw: Record<string, unknown>;
};

export type NormalizedItem = {
  name: string;
  description: string;
  lot?: string;
  unit: string;
  quantity: number | null;
  ceilingPriceCop: number | null;
  transformations: string[];
  fallbackFields?: string[];
};

export type ResolutionComponent = {
  id: string;
  label: string;
  kind: ComponentKind;
  required: boolean;
  quantity: number | null;
  unit: string;
  sourcingBrief: string;
  requirementBasis: string[];
  assumptions: string[];
};

export type ConversionPlan = {
  sourcePresentation: string;
  sourceQuantity: number | null;
  sourceUnit: string;
  requiredQuantity: number | null;
  requiredUnit: string;
  calculationBasis: "purchase_minimum" | "prorated_reference" | "both" | "not_applicable";
  wasteFactorPct: number | null;
};

export type CommercialResolutionPlan = {
  mode: ResolutionMode;
  automationLevel: AutomationLevel;
  rationale: string;
  components: ResolutionComponent[];
  conversion: ConversionPlan | null;
  assumptions: string[];
  missingInformation: string[];
  humanQuestions: string[];
  stopReasons: string[];
};

export type TechnicalInterpretation = {
  purchaseMode: "exact" | "defined_range" | "open" | "unclear";
  hardRequirements: string[];
  flexibleRequirements: string[];
  ambiguities: string[];
  searchBrief: string;
  confidence: Confidence;
  resolutionPlan: CommercialResolutionPlan;
};

export type EvidenceArtifact = {
  url: string;
  finalUrl: string;
  observedAt: string;
  pageTitle: string;
  observedProduct: string;
  observedPrice: number | null;
  currency: string;
  presentation: string;
  availability: "in_stock" | "out_of_stock" | "unknown" | "not_applicable";
  verificationMethod: "direct_page" | "search_result" | "catalog" | "provider_quote" | "not_observed";
  observations: string[];
};

export type PricingLine = {
  componentId: string;
  coveredComponentIds: string[];
  label: string;
  supplier: string;
  product: string;
  observedPackagePrice: number | null;
  currency: string;
  url: string;
  sourceQuantity: number | null;
  sourceUnit: string;
  requiredQuantity: number | null;
  requiredUnit: string;
  pricingMethod: "direct" | "prorated" | "purchase_minimum";
  referenceCost: number | null;
  purchaseMinimumCost: number | null;
  formula: string;
  evidence: EvidenceArtifact[];
};

export type MarketResult = {
  supplier: string;
  product: string;
  price: number | null;
  currency: string;
  url: string;
  notes: string;
  evidence: string[];
  confidence: Confidence;
  decision: Decision;
  pricingType: "observed_single" | "derived_conversion" | "composed_bom" | "partial_benchmark" | "no_result";
  lines: PricingLine[];
  missingComponents: string[];
  calculationWarnings: string[];
  workerRecommendation: Decision;
};

export type SupervisionResult = {
  sourceSupport: VerificationValue;
  priceObserved: VerificationValue;
  productMatch: VerificationValue;
  presentationMatch: VerificationValue;
  componentCompleteness: "complete" | "partial" | "missing" | "unknown";
  calculationValid: VerificationValue;
  confidence: Confidence;
  decision: Decision;
  reason: string;
  firstDeviation: string;
  humanAction: string;
  policyAdjustments: string[];
  benchmarkUsability?: "sufficient" | "conditional" | "insufficient" | "no_data";
  reviewRequirement?: "none" | "recommended" | "required";
  verifiedAt: string;
};

export type ItemAssistantExchange = {
  id: string;
  createdAt: string;
  providerId: ProviderId;
  question: string;
  reply: string;
  diagnosis: string;
  suggestedAction: "accept" | "apply" | "rerun" | "exclude" | "human_review";
  suggestedStage: StageId;
  instruction: string;
  proposedCorrection?: HumanCorrection;
  tags: string[];
};

export type ValidationIssue = {
  stage: StageId;
  itemId?: string;
  code: string;
  severity: "warning" | "error";
  message: string;
};

export type HumanReview = {
  id: string;
  verdict: "correct" | "incorrect" | "unclear";
  stage: StageId;
  comment: string;
  tags: string[];
  rememberForSimilar: boolean;
  memoryId?: string;
  action: "record" | "apply" | "rerun" | "exclude";
  correction?: HumanCorrection;
  snapshotBefore?: ItemSnapshot;
  resolvedAt?: string;
  createdAt: string;
};

export type HumanCorrection = {
  name?: string;
  description?: string;
  unit?: string;
  quantity?: number | null;
  ceilingPriceCop?: number | null;
  supplier?: string;
  product?: string;
  price?: number | null;
  currency?: string;
  url?: string;
  notes?: string;
  confidence?: Confidence;
  decision?: Decision;
};

export type ItemSnapshot = {
  normalized?: NormalizedItem;
  technical?: TechnicalInterpretation;
  market?: MarketResult;
  supervision?: SupervisionResult;
  status: AgentItem["status"];
};

export type LearningContext = {
  memoryId: string;
  title: string;
  guidance: string;
  stage: StageId;
  score: number;
  strength: "candidate" | "recurring";
  presentedAt: string;
};

export type CaseMemory = {
  id: string;
  title: string;
  guidance: string;
  stage: StageId;
  tags: string[];
  cues: string[];
  strength: "candidate" | "recurring";
  confirmations: number;
  uses: number;
  sourceRefs: Array<{ runId: string; itemId: string; reviewId: string }>;
  createdAt: string;
  updatedAt: string;
};

export type AgentItem = {
  id: string;
  original: OriginalItem;
  normalized?: NormalizedItem;
  technical?: TechnicalInterpretation;
  market?: MarketResult;
  supervision?: SupervisionResult;
  supervisedAt?: string;
  attempts?: {
    market: number;
  };
  status: "imported" | "normalized" | "interpreted" | "priced" | "pending" | "escalated" | "excluded";
  reviews: HumanReview[];
  assistantExchanges?: ItemAssistantExchange[];
  learningContext?: LearningContext[];
  humanDecision?: {
    reviewId: string;
    decision: Decision;
    confidence: Confidence;
    reason: string;
    updatedAt: string;
  };
};

export type AgentStep = {
  id: string;
  stage: StageId;
  title: string;
  expected: string;
  observed: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  provider?: ProviderId;
  model?: string;
  inputHash?: string;
  prompt?: string;
  rawResponse?: string;
  error?: string;
  itemIds: string[];
  validationIssues?: ValidationIssue[];
  learningMemoryIds?: string[];
};

export type AgentEvent = {
  id: string;
  at: string;
  kind: "system" | "agent" | "tool" | "human" | "warning" | "error";
  stage: StageId;
  title: string;
  detail: string;
  stepId?: string;
  itemId?: string;
};

export type DocumentInventory = {
  fileName: string;
  extension: string;
  size: number;
  sheets: Array<{ name: string; rows: number; columns: number }>;
  parser: string;
  detectedRows: number;
  warnings: string[];
};

export type RunOrigin = {
  kind: "upload" | "odoo_project_drive" | "odoo_project_folder";
  odooProjectId?: string;
  odooProjectName?: string;
  odooAnalysisRecordId?: string;
  odooReturnUrl?: string;
  driveFileId?: string;
  driveFileName?: string;
  driveFileUrl?: string;
  driveFolderUrl?: string;
  driveFileIds?: string[];
  driveFileNames?: string[];
  documentProfileId?: string;
};

export type AgentRun = {
  contract: "caf-agent-run/v1";
  id: string;
  name: string;
  branch: number;
  parentRunId?: string;
  status: RunStatus;
  providerId: ProviderId;
  model: string;
  batchSize: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  activeStage: StageId;
  origin?: RunOrigin;
  inventory: DocumentInventory;
  documentIntake?: DocumentIntakeResult;
  items: AgentItem[];
  steps: AgentStep[];
  events: AgentEvent[];
  metrics: {
    totalItems: number;
    normalized: number;
    interpreted: number;
    priced: number;
    accepted: number;
    pending: number;
    warnings: number;
    durationMs: number;
    providerCalls: number;
  };
};

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  description: string;
  baseUrl: string;
  transport: "internal" | "http" | "openai";
  model?: string;
  apiKeyEnv?: string;
  capabilities: string[];
};

export type AgentTaskRequest = {
  routingTask?: "document_catalog" | "stage_analysis";
  jobId: string;
  stage: StageId;
  prompt: string;
  engine?: "mock" | "codex_exec";
  mockResponse?: unknown;
};

export type AgentTaskResponse = {
  ok: boolean;
  contract?: string;
  jobId: string;
  status: string;
  stage: StageId;
  rawResponse: string;
  summary?: { engine?: string; seconds?: number; characters?: number };
  error?: string;
  code?: string;
  retryable?: boolean;
  userAction?: string;
};
