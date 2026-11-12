import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

import { getProjectPriceBaseState, getCalculationReceipt } from "../lib/store";
import { GET as historyGET } from "../app/api/projects/[projectId]/price-bases/route";
import { GET as receiptGET } from "../app/api/projects/[projectId]/operations/route";

const serviceToken = "test-only-read-snapshot-token-00000000001";
describe("fresh financial queries on a single disk snapshot", () => {
  let root: string;
  let file: string;
  let cwd: ReturnType<typeof vi.spyOn>;
  let oldToken: string | undefined;
  const fixture = () => ({
    projects: [{ id: "a", items: [], settings: {}, updatedAt: "2026-10-14T10:00:00Z" }],
    priceBaseVersions: [
      { id: "v1", projectId: "a", jobId: "j1", snapshot: [], digest: "old" },
      { id: "foreign", projectId: "b", jobId: "j2", snapshot: [], digest: "old" },
      { id: "v2", projectId: "a", jobId: "j3", snapshot: [], digest: "old" },
    ],
    calculationOperationReceipts: { op: { receipt: { id: "op", calculationId: "a", changes: [] } } },
    manualChangeReceipts: [{ id: "manual", projectId: "a", changes: [] }],
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "caf-read-snapshot-"));
    file = join(root, "data", "financial-offer", "projects.json");
    await mkdir(join(root, "data", "financial-offer"), { recursive: true });
    await writeFile(file, JSON.stringify(fixture()));
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    oldToken = process.env.FINANCIAL_PRICE_BASE_TOKEN;
    process.env.FINANCIAL_PRICE_BASE_TOKEN = serviceToken;
    vi.mocked(readFile).mockClear();
  });
  afterEach(async () => {
    cwd.mockRestore();
    vi.mocked(readFile).mockReset();
    // Restore the actual implementation without retaining any fixture snapshot.
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(readFile).mockImplementation(actual.readFile);
    if (oldToken === undefined) delete process.env.FINANCIAL_PRICE_BASE_TOKEN;
    else process.env.FINANCIAL_PRICE_BASE_TOKEN = oldToken;
    await rm(root, { recursive: true, force: true });
  });
  function request(path: string, token = serviceToken) {
    return new Request("http://financial.test/" + path, { headers: { Authorization: "Bearer " + token } });
  }
  function props(projectId = "a") { return { params: Promise.resolve({ projectId }) }; }
  it("returns project and only its newest-first history using one read", async () => {
    const result = await getProjectPriceBaseState("a");
    expect(result?.project.id).toBe("a");
    expect(result?.versions.map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it("does not cache a prior file version or expose another project", async () => {
    const first = await getProjectPriceBaseState("a");
    const updated = fixture();
    updated.projects[0].updatedAt = "2026-10-14T10:01:00Z";
    updated.priceBaseVersions.push({ id: "v3", projectId: "a", jobId: "j4", snapshot: [], digest: "new" });
    await writeFile(file, JSON.stringify(updated));
    const second = await getProjectPriceBaseState("a");
    expect(second?.project.updatedAt).not.toBe(first?.project.updatedAt);
    expect(second?.versions[0].id).toBe("v3");
    expect(await getProjectPriceBaseState("missing")).toBeNull();
    // A stat-validated unchanged snapshot also answers a missing-project query.
    // Mutating a returned object must never contaminate the cached snapshot.
    second!.project.updatedAt = "changed-by-caller";
    const third = await getProjectPriceBaseState("a");
    expect(third?.project.updatedAt).toBe("2026-10-14T10:01:00Z");
    expect(third?.versions.map((v) => v.id)).toEqual(["v3", "v2", "v1"]);
    expect(readFile).toHaveBeenCalledTimes(2);
  });
  it("returns manual fallback and missing receipts without a second parse", async () => {
    expect(await getCalculationReceipt("manual")).toMatchObject({ id: "manual" });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(await getCalculationReceipt("missing")).toBeNull();
    expect(readFile).toHaveBeenCalledTimes(2);
  });
  it("preserves operation priority and defensive cloning", async () => {
    const data = fixture();
    data.manualChangeReceipts.push({ id: "op", projectId: "b", changes: [] });
    await writeFile(file, JSON.stringify(data));
    const result = await getCalculationReceipt("op");
    expect(result).toMatchObject({ calculationId: "a", createdItemKeys: [] });
    if (result) Object.assign(result, { id: "changed-in-caller" });
    expect(await getCalculationReceipt("op")).toMatchObject({ id: "op" });
  });
  it("keeps the HTTP history contract and auth before any data read", async () => {
    expect((await historyGET(request("api/projects/a/price-bases", "wrong"), props())).status).toBe(401);
    expect(readFile).not.toHaveBeenCalled();
    const response = await historyGET(request("api/projects/a/price-bases"), props());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.calculationId).toBe("a");
    expect(body.versions.map((v: { id: string }) => v.id)).toEqual(["v2", "v1"]);
    expect(body.versions.every((v: { active: unknown }) => typeof v.active === "boolean")).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it("keeps receipt identity and foreign-calculation rejection with one read", async () => {
    const response = await receiptGET(request("api/projects/a/operations?receiptId=manual"), props());
    expect(response.status).toBe(200);
    expect((await response.json()).receipt.id).toBe("manual");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect((await receiptGET(request("api/projects/b/operations?receiptId=op"), props("b"))).status).toBe(404);
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
