import { getCalculation } from "@offer/lib/store";
import { readOdooAttachments } from "@offer/lib/odoo-project-sources";
export const dynamic = "force-dynamic";
export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(projectId)) return Response.json({ error: "Cálculo no encontrado." }, { status: 404 });
  const project = await getCalculation(projectId);
  if (!project) return Response.json({ error: "Cálculo no encontrado." }, { status: 404 });
  return readOdooAttachments(request, project);
}
