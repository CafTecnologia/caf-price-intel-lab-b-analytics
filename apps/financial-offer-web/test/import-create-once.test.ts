import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importProject } from "../lib/store";
import { sampleImportPayload } from "../lib/contract";
describe("persistent create-once import",()=>{
 it("serializes concurrent retries, preserves human edits and rejects changed content",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"caf-import-"));const cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
  try{
   const input:any=sampleImportPayload();input.create_once=true;input.calculation.external_id="run-fixed";input.calculation.source_system="odoo-qa";
   const results=await Promise.all(Array.from({length:6},()=>importProject(input)));
   expect(new Set(results.map(r=>r.id)).size).toBe(1);
   const file=path.join(dir,"data/financial-offer/projects.json");
   const stored=JSON.parse(await fs.readFile(file,"utf8"));expect(stored.projects).toHaveLength(1);
   stored.projects[0].name="Revision humana";await fs.writeFile(file,JSON.stringify(stored));
   const retry=await importProject(input);expect(retry.id).toBe(results[0].id);expect(retry.name).toBe("Revision humana");
   const changed=structuredClone(input);changed.calculation.name="Otro contenido";
   await expect(importProject(changed)).rejects.toThrow(/otro contenido/);
   expect(JSON.parse(await fs.readFile(file,"utf8")).projects).toHaveLength(1);
  }finally{cwd.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
 });
 it("fails closed when the store cannot be parsed",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"caf-import-corrupt-"));const cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
  try{
   const folder=path.join(dir,"data/financial-offer");await fs.mkdir(folder,{recursive:true});const file=path.join(folder,"projects.json");
   await fs.writeFile(file,"CORRUPT-SENTINEL");
   await expect(importProject(sampleImportPayload())).rejects.toThrow(/proteger/);
   expect(await fs.readFile(file,"utf8")).toBe("CORRUPT-SENTINEL");
  }finally{cwd.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
 });
});
