export type ProviderId = "gemini" | "deepseek" | "openai" | "vps";

export type PricingTier = {
  inputUsdPer1m: number;
  outputUsdPer1m: number;
  cachedInputUsdPer1m?: number;
  cachedInputAboveThresholdUsdPer1m?: number;
  inputThresholdTokens?: number;
  inputAboveThresholdUsdPer1m?: number;
  outputAboveThresholdUsdPer1m?: number;
  searchUsdPer1k?: number;
  searchBillingUnit?: "grounded_prompt" | "search_query";
  note?: string;
};

export type ModelPricing = {
  provider: ProviderId;
  model: string;
  label: string;
  verifiedAt: string;
  sourceUrl: string;
  standard: PricingTier;
};

const GOOGLE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=es-419";
const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing";
const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";

export const MODEL_PRICING: ModelPricing[] = [
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 5,
      outputUsdPer1m: 30,
      cachedInputUsdPer1m: 0.5,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard pricing. Web search calls are estimated separately."
    }
  },
  {
    provider: "openai",
    model: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 30,
      outputUsdPer1m: 180,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard short-context pricing. Web search calls are estimated separately."
    }
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    label: "GPT-5.4",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 2.5,
      outputUsdPer1m: 15,
      cachedInputUsdPer1m: 0.25,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard short-context pricing."
    }
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.75,
      outputUsdPer1m: 4.5,
      cachedInputUsdPer1m: 0.075,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard short-context pricing."
    }
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.2,
      outputUsdPer1m: 1.25,
      cachedInputUsdPer1m: 0.02,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard short-context pricing."
    }
  },
  {
    provider: "openai",
    model: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    verifiedAt: "2026-05-08",
    sourceUrl: OPENAI_PRICING_URL,
    standard: {
      inputUsdPer1m: 30,
      outputUsdPer1m: 180,
      searchUsdPer1k: 10,
      searchBillingUnit: "search_query",
      note: "Standard short-context pricing."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    verifiedAt: "2026-05-20",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 1.5,
      outputUsdPer1m: 9,
      cachedInputUsdPer1m: 0.15,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Stable Gemini 3.5 model. Standard tier; output includes thinking tokens. Search is billed per query after the shared Gemini 3 free allowance."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    verifiedAt: "2026-05-20",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.25,
      outputUsdPer1m: 1.5,
      cachedInputUsdPer1m: 0.025,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Stable Gemini 3.1 Flash-Lite. Standard tier, text/image/video. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    verifiedAt: "2026-05-20",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 2,
      outputUsdPer1m: 12,
      cachedInputUsdPer1m: 0.2,
      cachedInputAboveThresholdUsdPer1m: 0.4,
      inputThresholdTokens: 200000,
      inputAboveThresholdUsdPer1m: 4,
      outputAboveThresholdUsdPer1m: 18,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Standard tier, text/image/video <= 200k input tokens. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    verifiedAt: "2026-05-20",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.5,
      outputUsdPer1m: 3,
      cachedInputUsdPer1m: 0.05,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Standard tier, text/image/video. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    verifiedAt: "2026-05-22",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 2,
      outputUsdPer1m: 12,
      cachedInputUsdPer1m: 0.2,
      cachedInputAboveThresholdUsdPer1m: 0.4,
      inputThresholdTokens: 200000,
      inputAboveThresholdUsdPer1m: 4,
      outputAboveThresholdUsdPer1m: 18,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Gemini 3 Pro Preview. Official Gemini pricing: <=200k input tier; output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash-Lite Preview",
    verifiedAt: "2026-05-20",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.25,
      outputUsdPer1m: 1.5,
      cachedInputUsdPer1m: 0.025,
      searchUsdPer1k: 14,
      searchBillingUnit: "search_query",
      note: "Standard tier, text/image/video. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 1.25,
      outputUsdPer1m: 10,
      cachedInputUsdPer1m: 0.125,
      cachedInputAboveThresholdUsdPer1m: 0.25,
      inputThresholdTokens: 200000,
      inputAboveThresholdUsdPer1m: 2.5,
      outputAboveThresholdUsdPer1m: 15,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Standard tier, text/image/video <= 200k input tokens. Search is estimated per grounded prompt."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.3,
      outputUsdPer1m: 2.5,
      cachedInputUsdPer1m: 0.03,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Standard tier, text/image/video. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.1,
      outputUsdPer1m: 0.4,
      cachedInputUsdPer1m: 0.01,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Standard tier, text/image/video. Output includes thinking tokens."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.1,
      outputUsdPer1m: 0.4,
      cachedInputUsdPer1m: 0.025,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Deprecated by Google; scheduled for shutdown on 2026-06-01."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite-preview-09-2025",
    label: "Gemini 2.5 Flash-Lite Preview 09-2025",
    verifiedAt: "2026-05-22",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.1,
      outputUsdPer1m: 0.4,
      cachedInputUsdPer1m: 0.01,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Preview 09-2025. Priced like Gemini 2.5 Flash-Lite in the official Gemini pricing table."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash 001",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.1,
      outputUsdPer1m: 0.4,
      cachedInputUsdPer1m: 0.025,
      searchUsdPer1k: 35,
      searchBillingUnit: "grounded_prompt",
      note: "Uses Gemini 2.0 Flash pricing; deprecated family."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash-Lite",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.075,
      outputUsdPer1m: 0.3,
      note: "Deprecated by Google; scheduled for shutdown on 2026-06-01."
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash-lite-001",
    label: "Gemini 2.0 Flash-Lite 001",
    verifiedAt: "2026-05-02",
    sourceUrl: GOOGLE_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.075,
      outputUsdPer1m: 0.3,
      note: "Uses Gemini 2.0 Flash-Lite pricing; deprecated family."
    }
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    verifiedAt: "2026-05-02",
    sourceUrl: DEEPSEEK_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.14,
      outputUsdPer1m: 0.28,
      cachedInputUsdPer1m: 0.0028,
      note: "Official OpenAI-compatible API pricing. Stored for future experimental branch."
    }
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    verifiedAt: "2026-05-02",
    sourceUrl: DEEPSEEK_PRICING_URL,
    standard: {
      inputUsdPer1m: 0.435,
      outputUsdPer1m: 0.87,
      cachedInputUsdPer1m: 0.003625,
      note: "Official temporary 75% discounted price, extended until 2026-05-31 15:59 UTC."
    }
  }
];

export function findModelPricing(provider: ProviderId, model: string) {
  const normalizedModel = normalizeModelName(model);

  return MODEL_PRICING.find(
    (item) => item.provider === provider && normalizeModelName(item.model) === normalizedModel
  );
}

function normalizeModelName(model: string) {
  return model.trim().replace(/^models\//i, "").toLowerCase();
}
