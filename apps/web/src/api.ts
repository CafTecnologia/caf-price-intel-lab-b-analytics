import type {
  AIAssistantResponse,
  DashboardSummary,
  LLMConfig,
  LLMConfigRead,
  LLMTestResult,
  ProcessCreateInput,
  ProcessDetail,
  ProcessRead,
  Stage1AutoFixResponse,
  Stage1RunResponse,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface Credentials {
  username: string;
  password: string;
}

function buildHeaders(credentials: Credentials) {
  return {
    Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(path: string, credentials: Credentials): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: buildHeaders(credentials) });
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function requestWithBody<T>(path: string, method: "POST" | "PUT", credentials: Credentials, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: buildHeaders(credentials),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function requestDelete<T>(path: string, credentials: Credentials): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(credentials),
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(credentials: Credentials) {
  return request<DashboardSummary>("/api/v1/dashboard", credentials);
}

export function fetchProcesses(credentials: Credentials) {
  return request<ProcessRead[]>("/api/v1/processes", credentials);
}

export function fetchProcessDetail(processId: string, credentials: Credentials) {
  return request<ProcessDetail>(`/api/v1/processes/${processId}`, credentials);
}

export function createProcess(input: ProcessCreateInput, credentials: Credentials) {
  return requestWithBody<ProcessRead>("/api/v1/processes", "POST", credentials, input);
}

export async function uploadDocuments(processId: string, files: File[], credentials: Credentials) {
  const results = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append("upload", file);
    const response = await fetch(`${API_URL}/api/v1/processes/${processId}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
      },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Error subiendo ${file.name}: ${response.status}`);
    }
    results.push(await response.json());
  }
  return results;
}

export function analyzeProcess(processId: string, credentials: Credentials, forceAi = false) {
  return requestWithBody<{ status: string; result?: unknown }>(
    `/api/v1/processes/${processId}/analyze?async_mode=false&force_ai=${forceAi ? "true" : "false"}`,
    "POST",
    credentials,
    {},
  );
}

export function reanalyzeProcess(processId: string, credentials: Credentials, forceAi = false) {
  return requestWithBody<{ status: string; mode?: string; result?: unknown }>(
    `/api/v1/processes/${processId}/reanalyze?async_mode=false&force_ai=${forceAi ? "true" : "false"}`,
    "POST",
    credentials,
    {},
  );
}

export function runStage1(processId: string, credentials: Credentials, forceAi = false) {
  return requestWithBody<Stage1RunResponse>(
    `/api/v1/processes/${processId}/stage-1/run?force_ai=${forceAi ? "true" : "false"}`,
    "POST",
    credentials,
    {},
  );
}

export function autoCorrectStage1(processId: string, credentials: Credentials, useAi = true) {
  return requestWithBody<Stage1AutoFixResponse>(
    `/api/v1/processes/${processId}/stage-1/auto-correct`,
    "POST",
    credentials,
    { use_ai: useAi },
  );
}

export function deleteProcess(processId: string, credentials: Credentials) {
  return requestDelete<{ deleted_process_id: string; deleted: boolean }>(`/api/v1/processes/${processId}`, credentials);
}

export function askProcessAI(processId: string, prompt: string, credentials: Credentials) {
  return requestWithBody<AIAssistantResponse>(
    `/api/v1/processes/${processId}/ai/chat`,
    "POST",
    credentials,
    { prompt },
  );
}

export function askItemAI(processId: string, normalizedItemId: string, prompt: string, credentials: Credentials) {
  return requestWithBody<AIAssistantResponse>(
    `/api/v1/processes/${processId}/items/${normalizedItemId}/ai/chat`,
    "POST",
    credentials,
    { prompt },
  );
}

export function fetchLLMConfig(credentials: Credentials) {
  return request<LLMConfigRead>("/api/v1/llm/config", credentials);
}

export function saveLLMConfig(config: LLMConfig, credentials: Credentials) {
  return requestWithBody<LLMConfigRead>("/api/v1/llm/config", "PUT", credentials, config);
}

export function testLLMConfig(config: LLMConfig, credentials: Credentials) {
  return requestWithBody<LLMTestResult>("/api/v1/llm/test", "POST", credentials, { config });
}
