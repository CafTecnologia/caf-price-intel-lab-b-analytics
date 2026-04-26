export type ProcessStatus = "draft" | "ingested" | "analyzed" | "review" | "completed" | "error";

export interface ProcessRead {
  id: string;
  name: string;
  contracting_entity?: string | null;
  description?: string | null;
  status: ProcessStatus;
  created_at: string;
  updated_at: string;
  metadata_json?: Record<string, unknown>;
}

export interface ProcessCreateInput {
  name: string;
  external_reference?: string | null;
  contracting_entity?: string | null;
  description?: string | null;
  source_url?: string | null;
  currency?: string;
}

export interface DashboardSummary {
  total_processes: number;
  analyzed_processes: number;
  total_items: number;
  open_issues: number;
  classification_counts: Record<string, number>;
}

export interface RawItem {
  id: string;
  item_number?: string | null;
  raw_description: string;
  raw_quantity?: string | null;
  raw_unit?: string | null;
  raw_unit_price?: string | null;
  raw_total?: string | null;
  lot?: string | null;
  page_number?: number | null;
  sheet_name?: string | null;
  extraction_confidence?: string | null;
  status: string;
  origin?: string | null;
}

export interface ConsolidatedItem {
  raw_item_id: string;
  normalized_item_id?: string | null;
  item_number?: string | null;
  raw_description: string;
  raw_quantity?: string | null;
  raw_unit?: string | null;
  raw_unit_price?: string | null;
  raw_total?: string | null;
  origin?: string | null;
  file_name: string;
  source_count: number;
  canonical_item_key?: string | null;
  lot?: string | null;
}

export interface Issue {
  id: string;
  severity: string;
  title: string;
  message: string;
  status: string;
}

export interface Assessment {
  id: string;
  normalized_item_id: string;
  item_number?: string | null;
  raw_item_id?: string | null;
  raw_description?: string | null;
  raw_quantity?: string | null;
  raw_unit?: string | null;
  raw_unit_price?: string | null;
  raw_total?: string | null;
  origin?: string | null;
  price_ref_entity_unit?: string | null;
  price_ref_entity_total?: string | null;
  benchmark_min?: string | null;
  classification: string;
  benchmark_median?: string | null;
  benchmark_p25?: string | null;
  benchmark_p75?: string | null;
  benchmark_dispersion?: string | null;
  benchmark_points: number;
  benchmark_sources: BenchmarkSourceDetail[];
  gap_cop?: string | null;
  gap_pct?: string | null;
  explanation?: string | null;
}

export interface BenchmarkSourceDetail {
  source_name: string;
  source_url: string;
  country?: string | null;
  currency: string;
  original_price?: string | null;
  normalized_price_cop?: string | null;
  commercial_presentation?: string | null;
  condition?: string | null;
  comparability?: string | null;
  comparability_score?: string | null;
  observations?: string | null;
  evidence_json: Record<string, unknown>;
}

export interface DocumentRead {
  id: string;
  file_name: string;
  document_kind: string;
  page_count?: number | null;
  metadata_json?: Record<string, unknown>;
}

export interface NormalizedItem {
  id: string;
  raw_item_id: string;
  normalized_description?: string | null;
  quantity_num?: string | null;
  unit_normalized?: string | null;
  unit_price_cop?: string | null;
  total_cop?: string | null;
  lot_normalized?: string | null;
  canonical_item_key?: string | null;
}

export interface StageSummary {
  stage_code: string;
  title: string;
  status: string;
  consistency_score: number;
  automation_ready: boolean;
  description: string;
  recommended_action: string;
  blocking_reasons: string[];
  metrics: Record<string, unknown>;
}

export interface Stage1AutoFixSnapshot {
  summary: string;
  used_llm: boolean;
  provider_name?: string | null;
  model_name?: string | null;
  actions_applied: Record<string, unknown>[];
  before_metrics: Record<string, unknown>;
  after_metrics: Record<string, unknown>;
  before_score?: number | null;
  after_score?: number | null;
  stage_status_after?: string | null;
  blockers_after: string[];
}

export interface ProcessDetail {
  process: ProcessRead;
  documents: DocumentRead[];
  consolidated_items: ConsolidatedItem[];
  raw_items: RawItem[];
  normalized_items: NormalizedItem[];
  issues: Issue[];
  assessments: Assessment[];
  analysis_trace: AnalysisTraceEntry[];
  stage_summaries: StageSummary[];
  stage1_last_auto_fix?: Stage1AutoFixSnapshot | null;
}

export interface AnalysisTraceEntry {
  order: number;
  stage_code: string;
  title: string;
  status: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  used_llm: boolean;
  llm_provider?: string | null;
  llm_model?: string | null;
  logic_summary: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export type ProviderName = "disabled" | "openai" | "openai_compatible";

export interface LLMConfig {
  provider_name: ProviderName;
  base_url: string | null;
  model_name: string | null;
  api_key: string;
  enabled: boolean;
  timeout_seconds: number;
  max_task_budget_usd: number;
  max_process_budget_usd: number;
  estimated_input_token_price: number;
  estimated_output_token_price: number;
  extra_headers: Record<string, string>;
}

export interface LLMConfigRead {
  id: string;
  provider_name: ProviderName;
  base_url: string | null;
  model_name: string | null;
  enabled: boolean;
  has_api_key: boolean;
  api_key_masked: string | null;
  config_json: Record<string, unknown>;
}

export interface LLMTestResult {
  provider_name: ProviderName;
  model_name: string;
  succeeded: boolean;
  estimated_cost_usd: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  content_preview?: string | null;
  error_message?: string | null;
}

export interface AIAssistantResponse {
  response: string;
  used_llm: boolean;
  provider_name?: string | null;
  model_name?: string | null;
  execution_mode: string;
  can_execute_requested_action: boolean;
  recommended_actions: string[];
  used_evidence: string[];
  warnings: string[];
  system_limits: string[];
  available_actions: string[];
  next_step?: string | null;
}

export interface Stage1RunResponse {
  process_id: string;
  stage_code: string;
  status: string;
  consistency_score: number;
  automation_ready: boolean;
  summary: string;
  blocking_reasons: string[];
  metrics: Record<string, unknown>;
}

export interface Stage1AutoFixResponse {
  process_id: string;
  actions_applied: Record<string, unknown>[];
  used_llm: boolean;
  provider_name?: string | null;
  model_name?: string | null;
  summary: string;
  before_score?: number | null;
  after_score?: number | null;
  stage_status_after?: string | null;
  blockers_after: string[];
}
