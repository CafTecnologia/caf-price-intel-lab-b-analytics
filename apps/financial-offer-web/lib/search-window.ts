// Reserve the tab during the user gesture, before any network wait.
const pending = new Map<string, Window>();

export async function openSearchWindow(
  key: string,
  fallbackUrl: string,
  prepare: () => Promise<string>,
  feedback: { onBlocked?: () => void; onFallback?: () => void } = {},
): Promise<void> {
  const previous = pending.get(key);
  if (previous && !previous.closed) return;
  const tab = window.open("about:blank", "_blank");
  if (!tab) { feedback.onBlocked?.(); return; } // Do not start a paid request when blocked.
  tab.opener = null;
  tab.document.title = "Preparando búsqueda";
  tab.document.body.textContent = "Preparando la consulta de Google…";
  pending.set(key, tab);
  try {
    let url = fallbackUrl;
    try {
      const candidate = new URL(await prepare());
      if (candidate.protocol === "https:" && candidate.hostname === "www.google.com" && candidate.pathname === "/search") url = candidate.href;
    } catch {
      feedback.onFallback?.(); // The local query remains usable when preparation fails.
    }
    if (!tab.closed) tab.location.replace(url);
  } finally {
    if (pending.get(key) === tab) pending.delete(key);
  }
}
