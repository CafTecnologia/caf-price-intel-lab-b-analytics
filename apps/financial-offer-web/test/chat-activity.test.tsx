import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { activityStep, responseSignature, savedAiActivity } from "../lib/chat-activity";
import { chatOutcome } from "../lib/chat-outcome";
import type { AiResultEvidence } from "../lib/ai-result-evidence";
import { ChatTurnView } from "../components/ai-result-panel";
import { AiWorkspaceActivity } from "../components/ai-workspace-activity";

const receipt = { operationId: "op-1", status: "applied" as const, baseVersionId: "base-1", createdAt: "2026-10-28T13:30:00Z", active: true, historical: false, changedItemCount: 1, changedItemIds: ["item-1"], changes: [], comparison: { scope: "this_request" as const, versionId: "base-1", parentVersionId: null, basis: "receipt_changes" as const, diffs: [] } };
const proof: AiResultEvidence = { calculationId: "calculation-1", odooProjectId: "1", externalRunId: "run-1", jobId: "job-1", receiptCount: 1, appliedReceiptCount: 1, noChangesReceiptCount: 0, uniqueChangedItemCount: 1, receipts: [receipt] };
const turn = { job_id: "job-1", status: "running", prompt: "Revisa los costos" };

describe("activity backed by the current calculation receipts", () => {
  it("announces a partial save while work continues and deduplicates repeated polls", () => {
    const activity = savedAiActivity("calculation-1", turn, proof, new Set());
    expect(activity?.itemIds).toEqual(["item-1"]);
    expect(activity?.baseVersionIds).toEqual(["base-1"]);
    expect(chatOutcome(turn, proof).kind).toBe("working");
    expect(savedAiActivity("calculation-1", turn, proof, new Set(["op-1"]))).toBeNull();
  });
  it("does not announce another request/calculation or an inactive/historical/no-change receipt", () => {
    expect(savedAiActivity("another", turn, proof, new Set())).toBeNull();
    expect(savedAiActivity("calculation-1", { ...turn, job_id: "another" }, proof, new Set())).toBeNull();
    for (const invalid of [{ active: false }, { historical: true }, { status: "no_changes" as const }]) {
      expect(savedAiActivity("calculation-1", turn, { ...proof, receipts: [{ ...receipt, ...invalid }] }, new Set())).toBeNull();
    }
  });
  it("keeps a finished answer distinct from a verified save, including failed partial work", () => {
    expect(savedAiActivity("calculation-1", { ...turn, status: "completed" }, null, new Set())).toBeNull();
    expect(chatOutcome({ ...turn, status: "completed", financial_read_only: true }).title).toBe("Respuesta lista");
    expect(chatOutcome({ ...turn, status: "failed" }, proof).kind).toBe("error");
  });
  it("never exposes private process events as the current activity", () => {
    expect(activityStep({ ...turn, events: [{ type: "tool", message: "Consultando referencias" }, { type: "thinking", message: "PRIVATE" }] })).toBe("Consultando referencias");
    expect(activityStep({ ...turn, status: "completed" })).toBe("");
    expect(activityStep({ ...turn, publication: { status: "applying" } })).toBe("Esperando confirmación del resultado");
    expect(responseSignature(turn)).toBe(responseSignature({ ...turn, events: [{ type: "tool", message: "Otro paso" }] }));
  });
});

describe("conversation and saved-view feedback", () => {
  it("shows the full ordinary answer and distinguishes working from finished", () => {
    const text = "Respuesta extensa visible. ".repeat(35);
    const done = renderToStaticMarkup(<ChatTurnView turn={{ ...turn, status: "completed", financial_read_only: true, result: text }} index={0} latest />);
    expect(done).toContain(text.trim());
    expect(done).not.toContain("Leer respuesta completa");
    expect(done).not.toContain("La IA está trabajando");
    expect(renderToStaticMarkup(<ChatTurnView turn={turn} index={0} latest />)).toContain('aria-label="La IA está trabajando"');
  });
  it("does not say that saved changes are displayed when local edits defer adoption", () => {
    const activity = savedAiActivity("calculation-1", turn, proof, new Set());
    const pending = renderToStaticMarkup(<AiWorkspaceActivity activity={activity} pending onDismiss={() => {}} />);
    expect(pending).toContain("Tus ediciones locales se conservan");
    expect(pending).not.toContain("están resaltados");
    expect(renderToStaticMarkup(<AiWorkspaceActivity activity={activity} pending={false} onDismiss={() => {}} />)).toContain("están resaltados");
  });
});

describe("respuesta lista sin esperar el registro interno", () => {
 it("muestra una consulta completada de solo lectura aunque Odoo aún cierre su registro", () => {
  for (const status of ["waiting","applying","reconciling"]) {
   expect(chatOutcome({job_id:"readonly",status:"completed",financial_read_only:true,publication:{status}}).kind).toBe("neutral");
   expect(chatOutcome({job_id:"readonly",status:"completed",financial_read_only:true,publication:{status}}).title).toBe("Respuesta lista");
  }
 });
 it("exige el comprobante para anunciar un guardado y permite mostrarlo antes del cierre interno", () => {
  expect(chatOutcome({...turn,status:"completed",publication:{status:"reconciling"}},proof).title).toBe("Cambios guardados");
  expect(chatOutcome({...turn,status:"completed",publication:{status:"reconciling"}},null).kind).toBe("working");
  expect(chatOutcome({...turn,status:"running",publication:{status:"reconciling"}},proof).kind).toBe("working");
 });
});

it("does not present a completed historical answer as a new pending confirmation", () => {
 const old = {job_id:"past",status:"completed",result:"Cambio confirmado en aquella solicitud",publication:{status:"applied"}};
 const html = renderToStaticMarkup(<ChatTurnView turn={old} index={0} latest={false} />);
 expect(html).toContain("Respuesta anterior");
 expect(html).not.toContain("Revisión por confirmar");
 expect(html).not.toContain("La IA está trabajando");
 const current = renderToStaticMarkup(<ChatTurnView turn={old} index={0} latest />);
 expect(current).toContain("Revisión por confirmar");
 expect(current).not.toContain("Cambios guardados");
});
