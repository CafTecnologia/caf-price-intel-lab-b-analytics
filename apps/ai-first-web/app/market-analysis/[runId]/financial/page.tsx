import { notFound } from "next/navigation";

import { FinancialSimulator } from "@web/components/financial-simulator";
import { MarketAnalysisTabs } from "@web/components/market-analysis-tabs";
import { getMarketAnalysisService } from "@web/lib/market-analysis-service";
import { getOfficialTrmSnapshot } from "@web/lib/trm-service";

export default async function FinancialSimulationPage(props: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { runId } = await props.params;
  const { focus } = await props.searchParams;
  const run = getMarketAnalysisService().getRun(runId);
  const focusMode = focus === "table";

  if (!run) {
    notFound();
  }

  const trm = await getOfficialTrmSnapshot();

  return (
    <div className={`stack ${focusMode ? "focus-workspace" : ""}`}>
      <section className={`panel workspace-hero ${focusMode ? "workspace-hero-compact" : ""}`}>
        <MarketAnalysisTabs
          runId={run.runId}
          projectCode={run.projectCode}
          fileName={run.fileName}
          status={run.status}
          current="financial"
        />
      </section>

      <FinancialSimulator
        run={run}
        trm={trm}
        openInNewTabHref={!focusMode ? `/market-analysis/${run.runId}/financial?focus=table` : undefined}
      />
    </div>
  );
}
