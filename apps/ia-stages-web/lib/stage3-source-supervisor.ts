import { callGemini } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import {
  buildStage3SourceSupervisorEvidencePayload,
  buildStage3SourceSupervisorPrompt
} from "@/lib/stage3-source-supervisor-contract";
import {
  estimateAiCost,
  extractDeepSeekUsageMetadata,
  extractGeminiUsageMetadata,
  type AiCostSummary,
  type AiUsageSummary
} from "@/lib/usage-cost";

export async function runStage3SourceSupervisor(input: {
  stage2Json?: unknown;
  stage3Result?: unknown;
  rawText?: string;
  maxSources?: number;
  evidence?: unknown;
  urlContextResult?: unknown;
  model?: string;
}) {
  const evidencePayload = await buildStage3SourceSupervisorEvidencePayload(input);
  const prompt = buildStage3SourceSupervisorPrompt(evidencePayload);
  const model = input.model?.trim() || "deepseek:deepseek-v4-pro";
  const ai = await callGemini({ prompt, model, stage: "stage3" });
  const supervision = parseJsonFromModelText(ai.text);
  const usage = usageFromProvider(ai.provider, ai.usageMetadata);
  const cost = estimateAiCost({ provider: ai.provider, model: ai.model, usage });

  return {
    ok: true,
    provider: ai.provider,
    model: ai.model,
    evidence: evidencePayload.evidence,
    evidenceSummary: evidencePayload.summary,
    supervision,
    rawPreview: ai.text.slice(0, 12000),
    usage,
    cost
  };
}

function usageFromProvider(provider: "gemini" | "deepseek" | "openai" | "vps", metadata: unknown): AiUsageSummary | undefined {
  return provider === "deepseek" ? extractDeepSeekUsageMetadata(metadata) : extractGeminiUsageMetadata(metadata);
}

export type Stage3SourceSupervisorOutput = Awaited<ReturnType<typeof runStage3SourceSupervisor>> & {
  usage?: AiUsageSummary;
  cost?: AiCostSummary;
};
