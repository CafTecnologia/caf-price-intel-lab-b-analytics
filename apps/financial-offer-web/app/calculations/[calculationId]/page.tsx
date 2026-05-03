import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@offer/components/project-workspace";
import { getCalculation } from "@offer/lib/store";

export default async function CalculationPage(props: { params: Promise<{ calculationId: string }> }) {
  const { calculationId } = await props.params;
  const calculation = await getCalculation(calculationId);
  if (!calculation) {
    notFound();
  }
  return <ProjectWorkspace project={calculation} />;
}
