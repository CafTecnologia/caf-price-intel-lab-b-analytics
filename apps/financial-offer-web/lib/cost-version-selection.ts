// A restore keeps its own audit revision while the user's chosen base remains selected.
export function currentCostVersionId<T extends { id: string; digest: string; stateDigest?: string; source?: string; restoredFromVersionId?: string }>(
  versions: T[], stateDigest: string, displayDigest: string,
): string | null {
  const applied = versions.find(version => version.stateDigest ? version.stateDigest === stateDigest : version.digest === displayDigest);
  if (applied?.source === "restore" && applied.restoredFromVersionId && versions.some(version => version.id === applied.restoredFromVersionId)) return applied.restoredFromVersionId;
  return applied?.id ?? null;
}
