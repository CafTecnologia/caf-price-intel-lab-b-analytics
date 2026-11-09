import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini, callGeminiWithSearch, callGeminiWithSearchFreeform } from "@/lib/gemini";
import { centralResponse } from "@/lib/central-routing";
import { runStage2ForJson } from "@/lib/ai-pipeline";
import { estimateAiCost, extractGeminiUsageMetadata, extractOpenAiUsageMetadata } from "@/lib/usage-cost";

vi.mock("@/lib/config", () => ({ getGeminiRuntimeConfig: vi.fn(() => { throw new Error("Unexpected direct provider fallback"); }) }));
vi.mock("@/lib/pipeline-log", () => ({ writePipelineLog: vi.fn(async () => {}) }));
vi.mock("@/lib/text-extract", () => ({ extractTextFromFile: vi.fn(() => { throw new Error("No document I/O expected"); }) }));

let temp = "";
const network = vi.fn<typeof fetch>();
function respond(text = "{}", usage: {input_tokens: number; output_tokens: number} | null = {input_tokens:120, output_tokens:30}) {
  return new Response(JSON.stringify({id:"synthetic", model:"gpt-5.4", caf_routing:{provider:"openai"}, usage,
    output:[{type:"message",content:[{type:"output_text",text}]}]}), {status:200});
}
function bodyAt(n: number) { return JSON.parse(String(network.mock.calls[n][1]?.body)); }

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-parity61-"));
  const token = path.join(temp, "synthetic-token");fs.writeFileSync(token, "synthetic-only");
  vi.stubEnv("CAF_AI_ROUTER_URL", "http://router.invalid/ai");
  vi.stubEnv("CAF_AI_ROUTER_TOKEN_FILE", token);
  vi.stubEnv("CAF_AI_ROUTER_DATABASE", "origin-test");
  vi.stubEnv("CAF_AI_ROUTER_CONTROL_DATABASE", "control-test");
  vi.stubEnv("CAF_AI_ROUTER_ALLOWED_DATABASES", "origin-test");
  network.mockReset();network.mockImplementation(async () => respond());vi.stubGlobal("fetch", network);
});
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();fs.rmSync(temp,{recursive:true,force:true});});

describe("central routing and usage parity", () => {
  it("uses control database while retaining the authorized origin", async () => {
    await centralResponse("stage_analysis", {input:"synthetic"});
    const options = network.mock.calls[0][1]!;
    expect(options.headers).toMatchObject({"X-Odoo-Database":"control-test","X-CAF-Origin-Database":"origin-test"});
    expect(options.redirect).toBe("error");
    expect(network.mock.calls[0][0]).toBe("http://router.invalid/ai/stage_analysis/responses");
  });
  it("rejects an unauthorized origin before any request", async () => {
    vi.stubEnv("CAF_AI_ROUTER_ALLOWED_DATABASES", "different-test");
    await expect(centralResponse("stage_analysis", {})).rejects.toThrow("no está autorizada");
    expect(network).not.toHaveBeenCalled();
  });
  it("requires web search and normalizes the centrally billed usage", async () => {
    const result = await callGeminiWithSearch({prompt:"synthetic",stage:"stage3"});
    expect(bodyAt(0)).toMatchObject({tools:[{type:"web_search"}],tool_choice:"required",text:{format:{type:"json_object"}}});
    const usage=extractGeminiUsageMetadata(result.usageMetadata);
    expect(usage).toEqual({inputTokens:120,outputTokens:30,totalTokens:150,cachedInputTokens:0,thinkingTokens:0,accountingSource:"central_ledger"});
    expect(estimateAiCost({provider:result.provider,model:result.model,usage})).toBeUndefined();
  });
  it("keeps freeform pilot search free of the JSON restriction", async () => {
    await callGeminiWithSearchFreeform({prompt:"synthetic",stage:"stage3"});
    expect(bodyAt(0).tool_choice).toBe("required");expect(bodyAt(0)).not.toHaveProperty("text");
  });
  it("keeps extraction JSON without forcing search", async () => {
    await callGemini({prompt:"synthetic",stage:"stage1"});
    expect(String(network.mock.calls[0][0])).toContain("/stage_extraction/responses");
    expect(bodyAt(0)).not.toHaveProperty("tools");
  });
  it("does not invent usage or cost when the central response has no usage", async () => {
    network.mockImplementation(async () => respond("{}",null));
    const result=await callGemini({prompt:"synthetic",stage:"stage2"});
    const usage=extractGeminiUsageMetadata(result.usageMetadata);
    expect(usage).toBeUndefined();
    expect(estimateAiCost({provider:result.provider,model:result.model,usage})).toBeUndefined();
  });
  it("preserves the existing direct OpenAI pilot tariff", () => {
    const usage=extractOpenAiUsageMetadata({input_tokens:120,output_tokens:30,total_tokens:150});
    expect(usage).not.toHaveProperty("accountingSource");
    expect(estimateAiCost({provider:"openai",model:"gpt-5.4",usage})).toMatchObject({inputUsd:0.0003,outputUsd:0.00045,totalUsd:0.00075});
  });
  it("preserves all 121 identities and quantities across three chunks and accounts usage once", async () => {
    const items=Array.from({length:121},(_,i)=>({"Consecutivo interno":i+1,"Lote":"A","No. item":`ref-${i+1}`,"Nombre o descripción":`Item ${i+1}`,"Detalles o ficha técnica":"Synthetic","Und de medida":"und","Cant":i+2,"Precio techo encontrado":1000,"Tipo de ficha":"simple","Unidad técnica de referencia":"und","Nota técnica para cotización":"test","Confianza":"alta"}));
    let offset=0;
    network.mockImplementation(async () => {const chunk=items.slice(offset,offset+60);offset+=chunk.length;return respond(JSON.stringify({metadata:{},items:chunk,control_calidad:{}}));});
    const result=await runStage2ForJson({metadata:{},items},"synthetic-chunks");
    expect(network).toHaveBeenCalledTimes(3);
    const rows=result.result.items as typeof items;
    expect(rows.map(r=>[r["No. item"],r.Cant])).toEqual(items.map(r=>[r["No. item"],r.Cant]));
    expect(result.usage).toEqual({inputTokens:360,outputTokens:90,totalTokens:450,cachedInputTokens:0,thinkingTokens:0,accountingSource:"central_ledger"});
    expect(result.cost).toBeUndefined();
  });
});
