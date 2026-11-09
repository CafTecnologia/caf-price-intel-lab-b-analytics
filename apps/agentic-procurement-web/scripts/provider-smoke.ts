import { providerHealth, runProviderTask } from "../lib/providers";
import type { ProviderId } from "../lib/types";

const ids: ProviderId[] = ["codex_pc", "codex_vps"];

async function main() {
  for (const providerId of ids) {
    const health = await providerHealth(providerId);
    console.log(`${providerId}: health=${health.ok ? "ok" : "failed"}`);
    if (!health.ok) {
      console.log(`  ${health.error || health.status}`);
      continue;
    }
    const response = await runProviderTask(providerId, {
      jobId: `smoke_${providerId}_${Date.now()}`,
      stage: "technical",
      prompt: 'Devuelve exclusivamente este JSON valido, sin markdown: {"contract":"caf-smoke/v1","items":[],"warnings":[]}'
    });
    console.log(`  task=${response.ok ? "ok" : "failed"} engine=${response.summary?.engine || "n/a"} chars=${response.summary?.characters || response.rawResponse.length}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
