import { proxyStudyDocuments } from "@offer/lib/study-documents-proxy";
export const dynamic = "force-dynamic";
export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  return proxyStudyDocuments(request, projectId);
}
