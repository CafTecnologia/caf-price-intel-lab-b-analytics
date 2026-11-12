import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersionedFileReader } from "../lib/versioned-file-reader";
import { sampleImportPayload } from "../lib/contract";
import { importProject, getProject, saveProject, listProjects } from "../lib/store";

describe("versioned financial reads", () => {
  it("shares 32 cold reads, detaches only selected data, and detects external rename/corruption", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caf-snapshot-"));
    try {
      const path = join(dir, "projects.json");
      await writeFile(path, JSON.stringify({ a: { notes: "original" }, b: { notes: "other" } }));
      const load = vi.fn(async (p: string) => JSON.parse(await readFile(p, "utf8")));
      const reader = createVersionedFileReader(load);
      const values = await Promise.all(Array.from({ length: 32 }, () => reader.select(path, s => s.a)));
      expect(load).toHaveBeenCalledTimes(1);
      values[0].notes = "draft";
      expect(values[1].notes).toBe("original");
      expect((await reader.select(path, s => s.a)).notes).toBe("original");
      expect((await reader.select(path, s => s.b)).notes).toBe("other");
      await writeFile(path + ".new", JSON.stringify({ a: { notes: "updated" }, b: { notes: "other" } }));
      await rename(path + ".new", path);
      expect((await reader.select(path, s => s.a)).notes).toBe("updated");
      expect(load).toHaveBeenCalledTimes(2);
      await writeFile(path, "{");
      await expect(reader.select(path, s => s.a)).rejects.toThrow();
      await writeFile(path, JSON.stringify({ a: { notes: "recovered" } }));
      expect((await reader.select(path, s => s.a)).notes).toBe("recovered");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("does not publish a snapshot changed during its read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caf-snapshot-race-"));
    try {
      const path = join(dir, "projects.json"); await writeFile(path, '{"value":1}');
      let first = true;
      const reader = createVersionedFileReader(async (p: string) => {
        const value = JSON.parse(await readFile(p, "utf8"));
        if (first) { first = false; await writeFile(p, '{"value":2}'); }
        return value;
      });
      expect(await reader.select(path, s => s.value)).toBe(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps projects independent and observes guarded writes and reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caf-store-reuse-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const a = await importProject(sampleImportPayload());
      const payload = structuredClone(sampleImportPayload()) as any;
      payload.calculation.external_id = "reuse-independent-project";
      const b = await importProject(payload);
      const first = await getProject(a.id);
      first!.notesDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "draft not saved" }] }] } as any;
      expect((await getProject(a.id))!.notesDocument).not.toEqual(first!.notesDocument);
      expect((await getProject(b.id))!.notesDocument).not.toEqual(first!.notesDocument);
      const saved = await saveProject(a.id, { name: "Reusable saved project" }, a.updatedAt);
      expect((await getProject(a.id))!.name).toBe(saved!.name);
      const list = await listProjects(); list[0].name = "list detached";
      expect((await getProject(list[0].id))!.name).not.toBe("list detached");
    } finally { cwd.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  });
});
