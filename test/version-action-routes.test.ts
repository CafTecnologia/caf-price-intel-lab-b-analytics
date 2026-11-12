import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { sampleImportPayload } from "../lib/contract";
import { importProject, listPriceBaseVersions, listProjectScenarios, saveProject } from "../lib/store";
import {
  GET as GET_BASE_ACTION,
  POST as POST_BASE_ACTION,
} from "../app/api/projects/[projectId]/price-bases/actions/route";
import {
  GET as GET_SCENARIOS,
  POST as POST_SCENARIO,
} from "../app/api/projects/[projectId]/scenarios/route";
import {
  GET as GET_SCENARIO_ACTION,
  POST as POST_SCENARIO_ACTION,
  DELETE as DELETE_SCENARIO_ACTION,
} from "../app/api/projects/[projectId]/scenarios/[scenarioId]/route";

afterEach(() => {
  delete process.env.ODOO_INTERNAL_BASE_URL;
  vi.unstubAllGlobals();
});

function authorizedHeaders(includeOrigin = true): Record<string, string> {
  return {
    Cookie: "session_id=test",
    ...(includeOrigin ? { Origin: "http://localhost:3000" } : {}),
  };
}

describe("rutas de recibos de versiones", () => {
  it("recupera un recibo de base tras respuesta ambigua y rechaza reutilizar la operación", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-base-action-route-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      process.env.ODOO_INTERNAL_BASE_URL = "http://odoo.test:8069";
      const authorize = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", authorize);
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const operationId = randomUUID();
      const url = `http://localhost:3000/api/projects/${project.id}/price-bases/actions`;
      const params = { params: Promise.resolve({ projectId: project.id }) };
      const body = JSON.stringify({ action: "save", expectedUpdatedAt: project.updatedAt, operationId });
      const post = () => POST_BASE_ACTION(new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authorizedHeaders() },
        body,
      }), params);

      const baseLoginRequired = await POST_BASE_ACTION(new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body,
      }), params);
      expect(baseLoginRequired.status).toBe(401);
      expect(await baseLoginRequired.json()).toMatchObject({ code: "ODOO_LOGIN_REQUIRED" });

      authorize.mockResolvedValueOnce(new Response(null, { status: 303, headers: { Location: "/web/login" } }));
      const redirectedBase = await post();
      expect(redirectedBase.status).toBe(401);
      expect(await redirectedBase.json()).toMatchObject({ code: "ODOO_LOGIN_REQUIRED" });
      expect(await listPriceBaseVersions(project.id)).toHaveLength(0);

      const saved = await post();
      const savedBody = await saved.json();
      expect(saved.status).toBe(200);
      expect(savedBody).toMatchObject({ operationId, status: "saved", updatedAt: project.updatedAt });
      expect((await (await post()).json()).baseVersionId).toBe(savedBody.baseVersionId);
      expect(await listPriceBaseVersions(project.id)).toHaveLength(1);

      const recovered = await GET_BASE_ACTION(new Request(`${url}?operationId=${operationId}`, {
        headers: authorizedHeaders(false),
      }), params);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        operationId, status: "saved", baseVersionId: savedBody.baseVersionId,
      });

      const reused = await POST_BASE_ACTION(new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authorizedHeaders() },
        body: JSON.stringify({
          action: "restore", expectedUpdatedAt: project.updatedAt,
          operationId, versionId: savedBody.baseVersionId,
        }),
      }), params);
      expect(reused.status).toBe(409);
      expect(await reused.json()).toMatchObject({ code: "OPERATION_ID_CONFLICT" });
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("hace idempotentes guardar y activar escenario, expone recibos y detecta versión obsoleta", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-scenario-action-route-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      process.env.ODOO_INTERNAL_BASE_URL = "http://odoo.test:8069";
      const authorize = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", authorize);
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const operationId = randomUUID();
      const url = `http://localhost:3000/api/projects/${project.id}/scenarios`;
      const params = { params: Promise.resolve({ projectId: project.id }) };
      const body = JSON.stringify({
        name: "A", expectedUpdatedAt: project.updatedAt, operationId,
      });
      const create = () => POST_SCENARIO(new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...authorizedHeaders() }, body,
      }), params);

      const deniedCreate = await POST_SCENARIO(new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      }), params);
      expect(deniedCreate.status).toBe(403);
      expect(await listProjectScenarios(project.id)).toHaveLength(0);

      const scenarioLoginRequired = await POST_SCENARIO(new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body,
      }), params);
      expect(scenarioLoginRequired.status).toBe(401);
      expect(await scenarioLoginRequired.json()).toMatchObject({ code: "ODOO_LOGIN_REQUIRED" });

      authorize.mockResolvedValueOnce(new Response(null, { status: 303, headers: { Location: "/web/login" } }));
      const redirectedScenario = await create();
      expect(redirectedScenario.status).toBe(401);
      expect(await redirectedScenario.json()).toMatchObject({ code: "ODOO_LOGIN_REQUIRED" });
      expect(await listProjectScenarios(project.id)).toHaveLength(0);

      const first = await create();
      const firstBody = await first.json();
      expect(first.status).toBe(201);
      expect(firstBody).toMatchObject({ operationId, status: "saved", updatedAt: project.updatedAt });
      expect((await (await create()).json()).scenario.id).toBe(firstBody.scenario.id);
      expect(await listProjectScenarios(project.id)).toHaveLength(1);

      const saveReceipt = await GET_SCENARIOS(new Request(`${url}?operationId=${operationId}`, {
        headers: authorizedHeaders(false),
      }), params);
      expect(saveReceipt.status).toBe(200);
      expect(await saveReceipt.json()).toMatchObject({
        operationId, status: "saved", scenarioId: firstBody.scenario.id,
      });

      const activateOperation = randomUUID();
      const actionUrl = `${url}/${firstBody.scenario.id}`;
      const actionParams = { params: Promise.resolve({
        projectId: project.id, scenarioId: firstBody.scenario.id,
      }) };
      const activateBody = JSON.stringify({
        expectedUpdatedAt: project.updatedAt, operationId: activateOperation,
      });
      const activate = () => POST_SCENARIO_ACTION(new Request(actionUrl, {
        method: "POST", headers: { "Content-Type": "application/json", ...authorizedHeaders() }, body: activateBody,
      }), actionParams);
      const deniedActivate = await POST_SCENARIO_ACTION(new Request(actionUrl, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: activateBody,
      }), actionParams);
      expect(deniedActivate.status).toBe(403);
      const deniedArchive = await DELETE_SCENARIO_ACTION(new Request(actionUrl, {
        method: "DELETE", headers: authorizedHeaders(false),
      }), actionParams);
      expect(deniedArchive.status).toBe(403);

      expect(await (await activate()).json()).toMatchObject({
        operationId: activateOperation, status: "no_changes", updatedAt: project.updatedAt,
      });
      expect(await (await activate()).json()).toMatchObject({ status: "no_changes" });

      const actionReceipt = await GET_SCENARIO_ACTION(new Request(
        `${actionUrl}?operationId=${activateOperation}`, { headers: authorizedHeaders(false) },
      ), actionParams);
      expect(actionReceipt.status).toBe(200);
      expect(await actionReceipt.json()).toMatchObject({
        operationId: activateOperation, status: "no_changes", scenarioId: firstBody.scenario.id,
      });

      const changed = await saveProject(project.id, { name: "Cambio concurrente" }, project.updatedAt);
      const stale = await POST_SCENARIO(new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authorizedHeaders() },
        body: JSON.stringify({
          name: "obsoleto", expectedUpdatedAt: project.updatedAt, operationId: randomUUID(),
        }),
      }), params);
      expect(changed?.updatedAt).not.toBe(project.updatedAt);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "STALE_CALCULATION" });
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
