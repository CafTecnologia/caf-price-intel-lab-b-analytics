export type QuoteProviderId = "codex_pc_local" | "codex_vps";

export type QuoteProviderTransport = "browser_direct" | "app_proxy";

export type QuoteProviderDefinition = {
  id: QuoteProviderId;
  label: string;
  shortLabel: string;
  description: string;
  transport: QuoteProviderTransport;
  baseUrl?: string;
  proxyBasePath?: string;
  engineHint: string;
  costMode: "subscription" | "api" | "unknown";
};

export const DEFAULT_QUOTE_PROVIDER_ID: QuoteProviderId = "codex_pc_local";

export const QUOTE_PROVIDER_DEFINITIONS: QuoteProviderDefinition[] = [
  {
    id: "codex_pc_local",
    label: "Codex PC local",
    shortLabel: "PC local",
    description: "Proveedor que corre en este computador y escucha en el puerto 18731.",
    transport: "browser_direct",
    baseUrl: "http://127.0.0.1:18731",
    engineHint: "codex_exec",
    costMode: "subscription"
  },
  {
    id: "codex_vps",
    label: "Codex VPS DEV",
    shortLabel: "VPS DEV",
    description: "Proveedor interno del VPS. La app actua como proxy hacia el worker local del servidor.",
    transport: "app_proxy",
    proxyBasePath: "/api/quote-provider/codex_vps",
    engineHint: "codex_exec",
    costMode: "subscription"
  }
];

export function getQuoteProviderDefinition(id: string | null | undefined): QuoteProviderDefinition {
  return QUOTE_PROVIDER_DEFINITIONS.find((provider) => provider.id === id) || QUOTE_PROVIDER_DEFINITIONS[0];
}

export function getQuoteProviderUrl(id: string | null | undefined, action: "health" | "status" | "quote" | "logs" | "jobs" | "result", query?: string) {
  const provider = getQuoteProviderDefinition(id);
  const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  if (provider.transport === "app_proxy") {
    return `${provider.proxyBasePath}/${action}${suffix}`;
  }
  return `${provider.baseUrl}/${action}${suffix}`;
}
