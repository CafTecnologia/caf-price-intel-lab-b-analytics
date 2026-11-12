export function groupCostVersions<T extends { id: string; source: string; jobId?: string | null }>(versions: T[]) {
  const groups = new Map<string, { key: string; versions: T[] }>();
  for (const version of versions) {
    const key = version.source === "ai" && version.jobId ? `job:${version.jobId}` : `version:${version.id}`;
    const group = groups.get(key) ?? { key, versions: [] };
    group.versions.push(version); groups.set(key, group);
  }
  return [...groups.values()];
}
