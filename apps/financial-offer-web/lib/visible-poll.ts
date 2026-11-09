// Poll only while visible, after the previous request settles. Never queue reads.
export function startVisiblePoll(load: (signal: AbortSignal) => Promise<void>, intervalMs: number, initial = false) {
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const visible = () => document.visibilityState !== "hidden";
  function schedule(delay = intervalMs) {
    if (!stopped && visible() && !inFlight) timer = setTimeout(() => { void run(); }, delay);
  }
  async function run() {
    timer = undefined;
    if (stopped || !visible() || inFlight) return;
    inFlight = true;
    const request = new AbortController();
    controller = request;
    const deadline = setTimeout(() => request.abort(), 45000);
    try { await load(request.signal); }
    catch { /* The consumer presents actionable errors; polling stays retryable. */ }
    finally {
      clearTimeout(deadline);
      controller = undefined;
      inFlight = false;
      schedule();
    }
  }
  function visibilityChanged() {
    clearTimeout(timer);
    timer = undefined;
    if (!visible()) controller?.abort();
    else schedule(0);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  schedule(initial ? 0 : intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
