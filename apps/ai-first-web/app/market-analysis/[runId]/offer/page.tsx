import { notFound } from "next/navigation";

import { MarketAnalysisTabs } from "@web/components/market-analysis-tabs";
import { OfferPresentationTable } from "@web/components/offer-presentation-table";
import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export default async function OfferPresentationPage(props: {
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

  return (
    <div className={`stack ${focusMode ? "focus-workspace" : ""}`}>
      <section className={`panel workspace-hero ${focusMode ? "workspace-hero-compact" : ""}`}>
        <MarketAnalysisTabs
          runId={run.runId}
          projectCode={run.projectCode}
          fileName={run.fileName}
          status={run.status}
          current="offer"
        />
      </section>

      <OfferPresentationTable run={run} openInNewTabHref={!focusMode ? `/market-analysis/${run.runId}/offer?focus=table` : undefined} />
    </div>
  );
}
