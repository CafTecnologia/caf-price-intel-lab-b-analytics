export type ProviderErrorInfo = {
  httpCode?: number;
  status?: string;
  message: string;
  reason?: string;
  domain?: string;
  service?: string;
  retryDelay?: string;
  details?: Array<Record<string, unknown>>;
  rawMessage: string;
};

export type ProviderFailureClassification = {
  code:
    | "API_KEY_INVALID"
    | "API_CONNECTION_FAILED"
    | "API_PERMISSION_DENIED"
    | "API_MODEL_NOT_FOUND"
    | "API_BILLING_REQUIRED"
    | "API_RATE_LIMITED"
    | "API_REQUEST_TOO_LARGE"
    | "API_REQUEST_REJECTED"
    | "API_PROVIDER_ERROR"
    | "API_PROVIDER_UNAVAILABLE"
    | "API_TIMEOUT";
  technicalMessage: string;
  details: Record<string, unknown>;
};

type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
};

export function classifyProviderError(error: unknown): ProviderFailureClassification | null {
  const provider = parseProviderError(error);
  const rawMessage = provider?.rawMessage ?? getRawMessage(error);
  const providerMessage = provider?.message ?? rawMessage;
  const status = provider?.status?.toUpperCase();
  const reason = provider?.reason?.toUpperCase();
  const message = providerMessage.toLowerCase();
  const httpCode = provider?.httpCode;
  const details = buildDetails(provider);

  if (isNetworkError(message)) {
    return {
      code: "API_CONNECTION_FAILED",
      technicalMessage: rawMessage,
      details
    };
  }

  if (
    reason === "API_KEY_INVALID" ||
    /api key (expired|not valid|invalid|was reported as leaked)|apikey invalid/.test(message)
  ) {
    return {
      code: "API_KEY_INVALID",
      technicalMessage: providerMessage,
      details
    };
  }

  if (
    status === "FAILED_PRECONDITION" ||
    /prepayment credits are depleted|free tier.*not available|enable.*billing|paid plan/.test(message)
  ) {
    return {
      code: "API_BILLING_REQUIRED",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "PERMISSION_DENIED" || httpCode === 403) {
    return {
      code: "API_PERMISSION_DENIED",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "NOT_FOUND" || httpCode === 404 || /model .*not found|not found for api version/.test(message)) {
    return {
      code: "API_MODEL_NOT_FOUND",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "RESOURCE_EXHAUSTED" || httpCode === 429 || /quota|rate limit|too many requests|resource exhausted/.test(message)) {
    return {
      code: "API_RATE_LIMITED",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "DEADLINE_EXCEEDED" || httpCode === 504 || /deadline|timed out|timeout|time out/.test(message)) {
    return {
      code: "API_TIMEOUT",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "UNAVAILABLE" || httpCode === 503 || /unavailable|overloaded|temporarily down|capacity/.test(message)) {
    return {
      code: "API_PROVIDER_UNAVAILABLE",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "INTERNAL" || httpCode === 500) {
    return {
      code: "API_PROVIDER_ERROR",
      technicalMessage: providerMessage,
      details
    };
  }

  if (/context.*too long|input.*too long|token.*limit|request.*too large|payload.*size/.test(message)) {
    return {
      code: "API_REQUEST_TOO_LARGE",
      technicalMessage: providerMessage,
      details
    };
  }

  if (status === "INVALID_ARGUMENT" || httpCode === 400 || provider?.message) {
    return {
      code: "API_REQUEST_REJECTED",
      technicalMessage: providerMessage,
      details
    };
  }

  return null;
}

export function parseProviderError(error: unknown): ProviderErrorInfo | null {
  const rawMessage = getRawMessage(error);
  const parsed = parsePossibleGoogleError(rawMessage);

  if (!parsed?.error) {
    return null;
  }

  const errorInfo = parsed.error.details?.find((detail) =>
    typeof detail.reason === "string" || typeof detail.metadata === "object"
  );
  const metadata = isRecord(errorInfo?.metadata) ? errorInfo.metadata : undefined;
  const retryInfo = parsed.error.details?.find((detail) => typeof detail.retryDelay === "string");

  return {
    httpCode: parsed.error.code,
    status: parsed.error.status,
    message: parsed.error.message ?? rawMessage,
    reason: typeof errorInfo?.reason === "string" ? errorInfo.reason : undefined,
    domain: typeof errorInfo?.domain === "string" ? errorInfo.domain : undefined,
    service: typeof metadata?.service === "string" ? metadata.service : undefined,
    retryDelay: typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay : undefined,
    details: parsed.error.details,
    rawMessage
  };
}

function buildDetails(provider: ProviderErrorInfo | null): Record<string, unknown> {
  if (!provider) {
    return {};
  }

  return {
    providerHttpCode: provider.httpCode,
    providerStatus: provider.status,
    providerReason: provider.reason,
    providerDomain: provider.domain,
    providerService: provider.service,
    providerRetryDelay: provider.retryDelay,
    providerMessage: provider.message
  };
}

function isNetworkError(message: string) {
  return /fetch failed|failed to fetch|econnreset|etimedout|enotfound|network|socket|connection|dns|tls|ssl|certificate/.test(
    message
  );
}

function parsePossibleGoogleError(message: string): GoogleErrorPayload | null {
  const trimmed = message.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as GoogleErrorPayload;
  } catch {
    return null;
  }
}

function getRawMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
