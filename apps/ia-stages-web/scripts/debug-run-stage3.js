// Diagnostics helper (local/VPS). Prints Stage 3 stored artifacts for a runId.
// Usage:
//   node scripts/debug-run-stage3.js a36200cb-ed9a-...
//
// Reads apps/ia-stages-web data store shape:
//   data/ai-runs.sqlite (table run_stages)
//
const Database = require("better-sqlite3");

const runId = process.argv[2];
if (!runId) {
  console.error("Missing runId argument.");
  process.exit(2);
}

const dbPath =
  process.env.AI_RUNS_DB ||
  `${process.cwd()}/data/ai-runs.sqlite`;

const db = new Database(dbPath);

const rows = db
  .prepare(
    "SELECT run_id as runId, stage, status, provider, model, error_code as errorCode, error_message as errorMessage, updated_at as updatedAt, length(raw_text) as rawLen, length(call_trace_json) as traceLen FROM run_stages WHERE run_id=? ORDER BY stage"
  )
  .all(runId);

console.log(JSON.stringify({ dbPath, rows }, null, 2));

const s3 = db
  .prepare(
    "SELECT result_json as resultJson, raw_text as rawText, grounding_json as groundingJson, call_trace_json as callTraceJson, error_code as errorCode, error_message as errorMessage FROM run_stages WHERE run_id=? AND stage='stage3'"
  )
  .get(runId);

const s2 = db
  .prepare("SELECT result_json as resultJson, raw_text as rawText FROM run_stages WHERE run_id=? AND stage='stage2'")
  .get(runId);

console.log("--- stage3 excerpts ---");
console.log(
  JSON.stringify(
    {
      hasRow: Boolean(s3),
      errorCode: s3 ? s3.errorCode : null,
      errorMessage: s3 ? s3.errorMessage : null,
      rawTextPreview: s3 && s3.rawText ? String(s3.rawText).slice(0, 6000) : null,
      callTracePreview: s3 && s3.callTraceJson ? String(s3.callTraceJson).slice(0, 6000) : null
    },
    null,
    2
  )
);

console.log("--- stage2 input to stage3 (excerpt) ---");
let stage2Json = null;
try {
  stage2Json = s2 && s2.resultJson ? JSON.parse(String(s2.resultJson)) : null;
} catch {
  stage2Json = null;
}
console.log(
  JSON.stringify(
    {
      hasStage2: Boolean(s2),
      stage2ResultPreview: stage2Json ? JSON.stringify(stage2Json, null, 2).slice(0, 4000) : null
    },
    null,
    2
  )
);

try {
  const fs = require("fs");
  const promptTsPath = `${process.cwd()}/prompts/stage3-pricing.ts`;
  const src = fs.readFileSync(promptTsPath, "utf8");

  function extractBacktickConstant(source, name) {
    const idx = source.indexOf(`export const ${name}`);
    if (idx < 0) return null;
    const startTick = source.indexOf("`", idx);
    if (startTick < 0) return null;
    const endTick = source.indexOf("`", startTick + 1);
    if (endTick < 0) return null;
    return source.slice(startTick + 1, endTick);
  }

  function extractObjectLiteral(source, constName) {
    const idx = source.indexOf(`const ${constName}`);
    if (idx < 0) return null;
    const eq = source.indexOf("=", idx);
    if (eq < 0) return null;
    const start = source.indexOf("{", eq);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  const pricingPrompt = extractBacktickConstant(src, "STAGE3_PRICING_PROMPT");
  const shapeLiteral = extractObjectLiteral(src, "STAGE3_EXPECTED_SHAPE");

  let expectedShape = null;
  if (shapeLiteral) {
    // STAGE3_EXPECTED_SHAPE es un literal JS “seguro” (solo strings/null/arrays/objects).
    // Lo evaluamos para poder reproducir el JSON.stringify del prompt original.
    expectedShape = Function(`\"use strict\"; return (${shapeLiteral});`)();
  }

  if (!pricingPrompt || !expectedShape || !stage2Json) {
    console.log("--- reconstructed stage3 prompt (preview) ---");
    console.log(
      JSON.stringify(
        {
          error: "Could not reconstruct prompt fully.",
          hasPricingPrompt: Boolean(pricingPrompt),
          hasExpectedShape: Boolean(expectedShape),
          hasStage2Json: Boolean(stage2Json)
        },
        null,
        2
      )
    );
  } else {
    const prompt =
      `${pricingPrompt}\n\n` +
      `Devuelve únicamente un JSON válido, sin markdown, sin texto antes ni después.\n` +
      `La respuesta debe tener exactamente esta estructura base:\n\n` +
      `${JSON.stringify(expectedShape, null, 2)}\n\n` +
      `JSON generado por Etapa 2:\n` +
      `${JSON.stringify(stage2Json, null, 2)}`;

    console.log("--- reconstructed stage3 prompt (preview) ---");
    console.log(
      JSON.stringify(
        {
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 8000)
        },
        null,
        2
      )
    );
  }
} catch (e) {
  console.log("--- reconstructed stage3 prompt (preview) ---");
  console.log(JSON.stringify({ error: String(e && e.message ? e.message : e) }, null, 2));
}

