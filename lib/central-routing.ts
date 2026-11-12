import fs from "node:fs";
type CentralConnection = { url: string; token: string; database: string };
export function centralConnection(): CentralConnection | null {
  const url = (process.env.CAF_AI_ROUTER_URL || "").replace(/\/$/, "");
  if (!url) return null;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Conexión central IA inválida.");
  }
  const database = process.env.CAF_AI_ROUTER_DATABASE || "";
  const allowed = (process.env.CAF_AI_ROUTER_ALLOWED_DATABASES || "").split(",").map(value => value.trim());
  if (!database || !allowed.includes(database)) throw new Error("La empresa de ensayo no está autorizada para esta ruta.");
  const file = process.env.CAF_AI_ROUTER_TOKEN_FILE;
  if (!file) throw new Error("Falta la credencial de servicio IA.");
  const token = fs.readFileSync(file, "utf8").trim();
  if (!token) throw new Error("Credencial de servicio IA vacía.");
  return { url, token, database };
}
export async function centralResponse(stage: string, body: Record<string, unknown>, timeoutMs = 180000) {
  const connection = centralConnection();
  if (!connection) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(stage)) throw new Error("Tarea IA inválida.");
  const response = await fetch(connection.url + "/" + encodeURIComponent(stage) + "/responses", {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + connection.token, "X-Odoo-Database": connection.database },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("La política central IA no completó la tarea; consulte Consumo y respaldos.");
  return await response.json() as {
    id: string; model: string; output: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }>;
    usage: { input_tokens: number; output_tokens: number } | null;
    caf_routing?: { provider: string; operation: string; effort: string };
  };
}
export function centralText(response: NonNullable<Awaited<ReturnType<typeof centralResponse>>>) {
  return response.output.filter(item => item.type === "message")
    .flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text || "").join("");
}

export function centralSources(response: NonNullable<Awaited<ReturnType<typeof centralResponse>>>) {
  const sources = response.output.flatMap(item => item.content || []).flatMap(part => part.annotations || [])
    .filter(item => item.type === "url_citation" && typeof item.url === "string" && /^https?:\/\//.test(item.url))
    .map(item => ({ title: item.title || null, uri: item.url || null }));
  return sources.filter((source, index) => sources.findIndex(other => other.uri === source.uri) === index);
}
