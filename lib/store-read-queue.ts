// Route bundles share this queue. Each read keeps its own mutable snapshot;
// only overlapping reads of the large file are serialized, never cached.
type ReadQueues = Map<string, Promise<void>>;
const queueKey = Symbol.for("caf.financial-store.read-queues.v1");
const shared = globalThis as typeof globalThis & { [queueKey]?: ReadQueues };
const queues = shared[queueKey] ??= new Map();

export async function withStoreRead<T>(path: string, read: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  queues.set(path, current);
  await previous;
  try {
    return await read();
  } finally {
    release();
    if (queues.get(path) === current) queues.delete(path);
  }
}
