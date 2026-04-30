import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) {
    continue;
  }
  args.set(arg.slice(2), process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : "true");
}

const baseUrl = args.get("base-url") ?? "http://127.0.0.1:18020";
const runId = args.get("run-id");
const file = args.get("file");
const dryRun = args.get("dry-run") === "true";
const includeDebug = args.get("debug") !== "false";

if (!runId && !file) {
  console.error("Uso: npm run replay:market -- --run-id <runId> | --file <ruta>");
  process.exit(2);
}

async function postFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`No existe el archivo: ${filePath}`);
  }

  if (dryRun) {
    return {
      ok: true,
      status: 0,
      dryRun: true,
      action: "post_file",
      filePath,
      fileName: basename(filePath),
      endpoint: `${baseUrl}/api/market-analysis`,
    };
  }

  const formData = new FormData();
  formData.set("file", new Blob([readFileSync(filePath)]), basename(filePath));
  const response = await fetch(`${baseUrl}/api/market-analysis`, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function retryRun(targetRunId) {
  if (dryRun) {
    const response = await fetch(`${baseUrl}/api/market-analysis/${targetRunId}`);
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      dryRun: true,
      action: "retry_run",
      runId: targetRunId,
      sourceFile: payload.run?.uploadedFilePath ?? null,
      currentStatus: payload.run?.status ?? null,
      currentRows: payload.run?.result?.rows?.length ?? null,
      endpoint: `${baseUrl}/api/market-analysis/${targetRunId}/retry`,
    };
  }

  const response = await fetch(`${baseUrl}/api/market-analysis/${targetRunId}/retry`, { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function debugRun(targetRunId) {
  const response = await fetch(`${baseUrl}/api/market-analysis/${targetRunId}/debug`);
  return response.text();
}

const result = file ? await postFile(resolve(file)) : await retryRun(runId);
console.log(JSON.stringify(result, null, 2));

const newRunId = result.payload?.runId;
if (newRunId && includeDebug) {
  console.log("\n--- DEBUG REPORT ---\n");
  console.log(await debugRun(newRunId));
}

if (!result.ok) {
  process.exit(1);
}
