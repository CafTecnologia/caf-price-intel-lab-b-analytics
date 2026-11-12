import {describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Real writes, but deterministic reproduction of a metadata identity collision.
// Expected values come from file contents, not the reader's fingerprint algorithm.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {...actual, stat: async (...args: Parameters<typeof actual.stat>) => {
    const value = await actual.stat(...args);
    if (String(args[0]).endsWith("metadata-collision.json")) {
      return {...value, dev: 1n, ino: 1n, size: 11n, mtimeNs: 1n, ctimeNs: 1n};
    }
    return value;
  }};
});
import {createVersionedFileReader} from "../lib/versioned-file-reader";

describe("financial snapshot content identity", () => {
  it("rejects an old load after a same-metadata write during that load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caf-content88-"));
    try {
      const path = join(dir, "metadata-collision.json");
      await writeFile(path, '{"value":1}');
      let first = true;
      const reader = createVersionedFileReader(async p => {
        const value = JSON.parse(await readFile(p, "utf8"));
        if (first) { first = false; await writeFile(p, '{"value":2}'); }
        return value;
      });
      expect(await reader.select(path, value => value.value)).toBe(2);
    } finally { await rm(dir, {recursive:true, force:true}); }
  });
  it("refreshes a cached receipt after a same-metadata external write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caf-content88-"));
    try {
      const path = join(dir, "metadata-collision.json");
      await writeFile(path, '{"value":1}');
      const load = vi.fn(async p => JSON.parse(await readFile(p, "utf8")));
      const reader = createVersionedFileReader(load);
      expect(await reader.select(path, value => value.value)).toBe(1);
      await writeFile(path, '{"value":2}');
      expect(await reader.select(path, value => value.value)).toBe(JSON.parse(await readFile(path, "utf8")).value);
      expect(load).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, {recursive:true, force:true}); }
  });
});
