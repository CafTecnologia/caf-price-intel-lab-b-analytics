import { stat } from "node:fs/promises";

// One normalized snapshot per reader. Callers receive only detached selections;
// mutation and historical guards continue to use fresh, locked store reads.
export function createVersionedFileReader<T>(load: (path: string) => Promise<T>) {
  let snapshot: { key: string; path: string; value: T } | undefined;
  let loading: Promise<void> | undefined;
  let generation = 0;
  async function version(path: string): Promise<string> {
    try {
      const s = await stat(path, { bigint: true });
      return `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${path}:missing`;
      throw error;
    }
  }
  return {
    invalidate(path: string) {
      generation++;
      if (snapshot?.path === path) snapshot = undefined;
    },
    async select<R>(path: string, pick: (value: T) => R): Promise<R> {
      for (let attempt = 0; attempt < 8; attempt++) {
        const key = await version(path);
        if (snapshot?.key === key) return structuredClone(pick(snapshot.value));
        if (loading) { await loading; continue; }
        const revision = generation;
        const task = (async () => {
          const value = await load(path);
          if (revision === generation && await version(path) === key) {
            snapshot = { key, path, value };
          }
        })();
        loading = task;
        try { await task; } finally { if (loading === task) loading = undefined; }
      }
      throw new Error("El almacenamiento financiero está cambiando. Vuelve a consultar.");
    },
  };
}
