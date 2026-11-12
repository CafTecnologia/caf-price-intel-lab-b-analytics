import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HomeDashboard } from "@offer/components/home-dashboard";
import { OdooLaunchBridge } from "@offer/components/odoo-launch-bridge";
import { listCalculations } from "@offer/lib/store";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import { hasImportedItems, isInitialPlaceholderCalculation } from "@offer/lib/odoo-launch-navigation";

export const dynamic = "force-dynamic";

export default async function HomePage(props: { searchParams: Promise<{ preparedCalculationId?: string | string[] }> }) {
  const searchParams = await props.searchParams;
  const calculations = await listCalculations();
  const preparedId = typeof searchParams.preparedCalculationId === "string" ? searchParams.preparedCalculationId.trim() : "";
  const preparedCalculation = preparedId ? calculations.find((calculation) => calculation.id === preparedId) : null;
  if (preparedCalculation && hasImportedItems(preparedCalculation)) {
    redirect(`/calculations/${encodeURIComponent(preparedCalculation.id)}`);
  }
  const recentCalculations = calculations.map((calculation) => ({
    id: calculation.id,
    name: calculation.name,
    itemCount: calculation.items.length,
    sourceSystem: calculation.sourceSystem,
    isInitialPlaceholder: isInitialPlaceholderCalculation(calculation),
    updatedAt: formatBogotaDateTime(calculation.updatedAt),
  }));

  return (
    <>
      <Suspense fallback={null}>
        <OdooLaunchBridge />
      </Suspense>
      <HomeDashboard calculations={recentCalculations} />
    </>
  );
}
