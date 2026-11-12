import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

// Keep one normalized snapshot. Version identity includes streamed content:
// same-size in-place writes can have identical inode/mtime/ctime on real storage.
// Concurrent checks share only an in-flight fingerprint, never a timed stale one.
export function createVersionedFileReader<T>(load: (path: string) => Promise<T>) {
  let snapshot: { key: string; path: string; value: T } | undefined;
  let loading: Promise<void> | undefined;
  let generation = 0;
  const checking = new Map<string, Promise<string>>();
  async function fingerprint(path: string): Promise<string> {
    try {
      const s = await stat(path, { bigint: true });
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
        hash.update(chunk);
      }
      return `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${hash.digest("hex")}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${path}:missing`;
      throw error;
    }
  }
  async function version(path: string): Promise<string> {
    const pending = checking.get(path);
    if (pending) return pending;
    const task = fingerprint(path);
    checking.set(path, task);
    try { return await task; }
    finally { if (checking.get(path) === task) checking.delete(path); }
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
