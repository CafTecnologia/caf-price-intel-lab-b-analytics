import { findModelPricing, type ModelPricing, type ProviderId } from "@/lib/model-pricing";

export type AiUsageSummary = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
};

export type AiSearchUsage = {
  searchQueries: number;
  groundedPrompt: boolean;
};

export type AiCostSummary = {
  provider: ProviderId;
  model: string;
  pricingLabel: string;
  pricingVerifiedAt: string;
  pricingSourceUrl: string;
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
  searchUsd: number;
  totalUsd: number;
  searchBillingUnit?: "grounded_prompt" | "search_query";
  searchBillableUnits?: number;
  note?: string;
};

type EstimateInput = {
  provider: ProviderId;
  model: string;
  usage?: AiUsageSummary;
  search?: AiSearchUsage;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

type DeepSeekUsageMetadata = {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export function extractGeminiUsageMetadata(metadata: unknown): AiUsageSummary | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const usage = metadata as GeminiUsageMetadata;
  const inputTokens = toNonNegativeNumber(usage.promptTokenCount);
  const cachedInputTokens = toNonNegativeNumber(usage.cachedContentTokenCount);
  const outputTokens = toNonNegativeNumber(usage.candidatesTokenCount);
  const thinkingTokens = toNonNegativeNumber(usage.thoughtsTokenCount);
  const totalTokens = toNonNegativeNumber(usage.totalTokenCount);

  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    thinkingTokens === 0 &&
    totalTokens === 0
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens
  };
}

export function extractDeepSeekUsageMetadata(metadata: unknown): AiUsageSummary | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const usage = metadata as DeepSeekUsageMetadata;
  const inputTokens = toNonNegativeNumber(usage.prompt_tokens);
  const cachedInputTokens = toNonNegativeNumber(usage.prompt_cache_hit_tokens);
  const completionTokens = toNonNegativeNumber(usage.completion_tokens);
  const thinkingTokens = toNonNegativeNumber(usage.completion_tokens_details?.reasoning_tokens);
  const outputTokens = Math.max(0, completionTokens - thinkingTokens);
  const totalTokens = toNonNegativeNumber(usage.total_tokens);

  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    thinkingTokens === 0 &&
    totalTokens === 0
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens
  };
}

export function estimateAiCost(input: EstimateInput): AiCostSummary | undefined {
  const pricing = findModelPricing(input.provider, input.model);

  if (!pricing || !input.usage) {
    return undefined;
  }

  const hasCostableTokenBreakdown =
    input.usage.inputTokens > 0 ||
    input.usage.cachedInputTokens > 0 ||
    input.usage.outputTokens > 0 ||
    input.usage.thinkingTokens > 0;

  if (!hasCostableTokenBreakdown) {
    return undefined;
  }

  const billableCachedInputTokens = Math.min(
    input.usage.cachedInputTokens,
    input.usage.inputTokens
  );
  const billableRegularInputTokens = Math.max(
    0,
    input.usage.inputTokens - billableCachedInputTokens
  );
  const outputTokens = input.usage.outputTokens + input.usage.thinkingTokens;

  const inputUsd =
    (billableRegularInputTokens / 1_000_000) *
    selectInputPrice(pricing, input.usage.inputTokens);
  const cachedInputUsd =
    (billableCachedInputTokens / 1_000_000) *
    selectCachedInputPrice(pricing, input.usage.inputTokens);
  const outputUsd =
    (outputTokens / 1_000_000) * selectOutputPrice(pricing, input.usage.inputTokens);
  const { searchUsd, searchBillableUnits } = estimateSearchCost(pricing, input.search);

  return {
    provider: input.provider,
    model: input.model,
    pricingLabel: pricing.label,
    pricingVerifiedAt: pricing.verifiedAt,
    pricingSourceUrl: pricing.sourceUrl,
    inputUsd: roundUsd(inputUsd),
    cachedInputUsd: roundUsd(cachedInputUsd),
    outputUsd: roundUsd(outputUsd),
    searchUsd: roundUsd(searchUsd),
    totalUsd: roundUsd(inputUsd + cachedInputUsd + outputUsd + searchUsd),
    searchBillingUnit: pricing.standard.searchBillingUnit,
    searchBillableUnits,
    note: buildCostNote(pricing.standard.note, searchUsd > 0)
  };
}

export function summarizeSearchUsage(groundingMetadata: unknown): AiSearchUsage {
  if (!groundingMetadata || typeof groundingMetadata !== "object") {
    return { searchQueries: 0, groundedPrompt: false };
  }

  const metadata = groundingMetadata as {
    webSearchQueries?: unknown;
    groundingSources?: unknown;
    groundingChunks?: unknown;
  };

  const searchQueries = Array.isArray(metadata.webSearchQueries)
    ? metadata.webSearchQueries.length
    : 0;
  const sources = Array.isArray(metadata.groundingSources)
    ? metadata.groundingSources
    : Array.isArray(metadata.groundingChunks)
      ? metadata.groundingChunks
      : [];

  return {
    searchQueries,
    groundedPrompt: sources.length > 0 || searchQueries > 0
  };
}

function selectInputPrice(pricing: ModelPricing, inputTokens: number) {
  if (
    pricing.standard.inputThresholdTokens &&
    pricing.standard.inputAboveThresholdUsdPer1m &&
    inputTokens > pricing.standard.inputThresholdTokens
  ) {
    return pricing.standard.inputAboveThresholdUsdPer1m;
  }

  return pricing.standard.inputUsdPer1m;
}

function selectOutputPrice(pricing: ModelPricing, inputTokens: number) {
  if (
    pricing.standard.inputThresholdTokens &&
    pricing.standard.outputAboveThresholdUsdPer1m &&
    inputTokens > pricing.standard.inputThresholdTokens
  ) {
    return pricing.standard.outputAboveThresholdUsdPer1m;
  }

  return pricing.standard.outputUsdPer1m;
}

function selectCachedInputPrice(pricing: ModelPricing, inputTokens: number) {
  if (
    pricing.standard.inputThresholdTokens &&
    pricing.standard.cachedInputAboveThresholdUsdPer1m &&
    inputTokens > pricing.standard.inputThresholdTokens
  ) {
    return pricing.standard.cachedInputAboveThresholdUsdPer1m;
  }

  return pricing.standard.cachedInputUsdPer1m ?? selectInputPrice(pricing, inputTokens);
}

function estimateSearchCost(pricing: ModelPricing, search?: AiSearchUsage) {
  if (!pricing.standard.searchUsdPer1k || !pricing.standard.searchBillingUnit || !search) {
    return { searchUsd: 0, searchBillableUnits: 0 };
  }

  const searchBillableUnits =
    pricing.standard.searchBillingUnit === "search_query"
      ? search.searchQueries
      : search.groundedPrompt
        ? 1
        : 0;

  return {
    searchUsd: (searchBillableUnits / 1000) * pricing.standard.searchUsdPer1k,
    searchBillableUnits
  };
}

function toNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function buildCostNote(baseNote: string | undefined, includesSearchCost: boolean) {
  const notes = [baseNote];

  if (includesSearchCost) {
    notes.push("Search cost is a marginal paid-tier estimate after any free quota.");
  }

  return notes.filter(Boolean).join(" ");
}
