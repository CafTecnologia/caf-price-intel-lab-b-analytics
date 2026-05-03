import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@offer/components/project-workspace";
import { getProject } from "@offer/lib/store";

export default async function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const project = await getProject(projectId);
  if (!project) {
    notFound();
  }
  return <ProjectWorkspace project={project} />;
}
