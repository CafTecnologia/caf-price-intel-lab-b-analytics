import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { convertWithDocling } from "../lib/docling-client";
import { parseDocument } from "../lib/document-parser";
import { runProviderTask, ProviderTaskError, isNonRetryableProviderError } from "../lib/providers";

test("paridad: identidad por lote en flujo comun e identidad original en perfiles", () => {
  const buffer = Buffer.from(JSON.stringify([{ Item: "1", Nombre: "Marcador", Lote: "Lote 01" }, { Item: "1", Nombre: "Borrador", Lote: "Lote 02" }]));
  const common = parseDocument("items.json", buffer);
  const profiles = parseDocument("items.json", buffer, "source");
  assert.deepEqual(common.items.map(item => item.id), ["L01-1", "L02-1"]);
  assert.deepEqual(profiles.items.map(item => item.id), ["1", "1"]);
  assert.deepEqual(common.items.map(({id, ...item}) => item), profiles.items.map(({id, ...item}) => item));
});

test("paridad: cache documental distingue ventanas, OCR y reutiliza solo conversion equivalente", async () => {
  const dir = path.join(process.cwd(), ".test-cache-parity");
  const before = process.env.DOCLING_CACHE_DIR;
  process.env.DOCLING_CACHE_DIR = dir;
  const forms: FormData[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    forms.push(init!.body as FormData);
    return new Response(JSON.stringify({status:"success", document:{md_content:`conversion-${forms.length}`},errors:[]}));
  }) as typeof fetch;
  try {
    const options = {fetchImpl, async:false, pageRange:[1,6] as [number,number], doOcr:false};
    const first = await convertWithDocling("pliego.pdf", "application/pdf", Buffer.from("fixture"), options);
    const again = await convertWithDocling("pliego.pdf", "application/pdf", Buffer.from("fixture"), options);
    const last = await convertWithDocling("pliego.pdf", "application/pdf", Buffer.from("fixture"), {...options,pageRange:[41,46],doOcr:true});
    assert.deepEqual(again,first);
    assert.notEqual(last.markdown,first.markdown);
    assert.equal(forms.length,2);
    assert.deepEqual(forms[0].getAll("page_range"),["1","6"]);
    assert.equal(forms[0].get("do_ocr"),"false");
    assert.deepEqual(forms[1].getAll("page_range"),["41","46"]);
    assert.equal(forms[1].get("do_ocr"),"true");
  } finally {
    if(before === undefined) delete process.env.DOCLING_CACHE_DIR; else process.env.DOCLING_CACHE_DIR=before;
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test("paridad: rechazo no recuperable conserva codigo e instruccion para evitar reintentos", async () => {
  const before=globalThis.fetch;
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({ok:false,error:"Sesion vencida",code:"auth_expired",retryable:false,userAction:"Renovar la sesion"}),{status:401});}) as typeof fetch;
  try {
    await assert.rejects(()=>runProviderTask("codex_vps",{jobId:"parity",stage:"market",prompt:"fixture"}),error=>{
      assert.ok(error instanceof ProviderTaskError);
      assert.ok(isNonRetryableProviderError(error));
      assert.equal(error.code,"auth_expired");
      assert.equal(error.userAction,"Renovar la sesion");
      return true;
    });
    assert.equal(calls,1);
  } finally {globalThis.fetch=before;}
});
