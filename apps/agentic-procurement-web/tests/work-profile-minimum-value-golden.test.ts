import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import type { DoclingClientOptions, DoclingConversion } from "../lib/docling-client";
import {
  MINIMUM_VALUE_INITIAL_ASSESSMENT,
  type PreparedProfileDocument,
  type WorkProfileRun
} from "../lib/work-profile-contract";
import {
  documentBundleForSkill,
  hydrateDocumentsForSkill,
  prepareWorkProfileDocuments
} from "../lib/work-profile-documents";
import { executeWorkProfileRun, validateFinalArtifact } from "../lib/work-profile-runtime";
import { getWorkProfileRun, saveWorkProfileRun } from "../lib/work-profile-store";

type GoldenCase = {
  id: string;
  project: Record<string, string>;
  workbook?: { name: string; sheet: string; rows: unknown[][] };
  document?: { name: string; text?: string; pageCount?: number; role?: string };
  proposedRequirements?: Array<{ id: string; title: string; requirement: string; excerpt: string }>;
  expected: Record<string, unknown>;
};

type GoldenFixture = {
  contract: string;
  profileId: string;
  cases: GoldenCase[];
};

const dataDir = path.join(process.cwd(), ".test-data-work-profiles-golden");
process.env.CAF_AGENT_DATA_DIR = dataDir;

const fixturePath = path.join(process.cwd(), "fixtures", "golden-minimum-value-profile-cases.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;

function golden(id: string) {
  const value = fixture.cases.find((entry) => entry.id === id);
  assert.ok(value, `No existe el caso golden ${id}.`);
  return value;
}

function workbookBuffer(input: NonNullable<GoldenCase["workbook"]>) {
  const sheet = XLSX.utils.aoa_to_sheet(input.rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, input.sheet);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function parsedItems(document: PreparedProfileDocument) {
  return (JSON.parse(document.text) as { items: Array<Record<string, unknown>> }).items;
}

test("golden minima cuantia: fixture usa el perfil publicado y cuatro riesgos explicitos", () => {
  assert.equal(fixture.contract, "caf-work-profile-golden/v1");
  assert.equal(fixture.profileId, MINIMUM_VALUE_INITIAL_ASSESSMENT.id);
  assert.deepEqual(fixture.cases.map((entry) => entry.id), [
    "multi-lot-unit-reference-prices",
    "unit-reference-price-header-variant",
    "total-budget-without-unit-prices",
    "supported-and-invented-requirements",
    "long-scanned-governing-document"
  ]);
});

test("golden minima cuantia: conserva precios de la variante Precio de referencia unitario", async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  const input = golden("unit-reference-price-header-variant");
  const documents = await prepareWorkProfileDocuments([{
    name: input.workbook!.name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookBuffer(input.workbook!)
  }]);
  const expected = input.expected as { ceilingPrices: string[] };
  const actual = parsedItems(documents[0]).map((entry) => entry.ceilingPrice);
  assert.deepEqual(actual, expected.ceilingPrices);
});

test("golden minima cuantia: conserva cobertura, lote e importe unitario del inventario estructurado", async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  const input = golden("multi-lot-unit-reference-prices");
  const documents = await prepareWorkProfileDocuments([{
    name: input.workbook!.name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookBuffer(input.workbook!)
  }]);
  const expected = input.expected as {
    itemCount: number;
    lots: string[];
    items: string[];
    ceilingPrices: string[];
  };
  const items = parsedItems(documents[0]);

  assert.equal(documents[0].itemCandidates, expected.itemCount);
  assert.equal(items.length, expected.itemCount);
  assert.deepEqual(items.map((entry) => entry.lot), expected.lots);
  assert.deepEqual(items.map((entry) => entry.id), expected.items);
  assert.deepEqual(items.map((entry) => entry.ceilingPrice), expected.ceilingPrices);

  const now = new Date().toISOString();
  const run: WorkProfileRun = {
    contract: "caf-work-profile-run/v1",
    id: "profile_run_golden_multi_lot",
    name: input.project.projectName,
    profileId: MINIMUM_VALUE_INITIAL_ASSESSMENT.id,
    profileVersion: MINIMUM_VALUE_INITIAL_ASSESSMENT.version,
    providerId: "mock",
    status: "draft",
    project: input.project,
    documents,
    skills: [],
    createdAt: now,
    updatedAt: now
  };
  await saveWorkProfileRun(run);
  await executeWorkProfileRun(run.id);
  const saved = await getWorkProfileRun(run.id);

  const artifact = saved?.finalArtifact;
  assert.ok(artifact && "requestedScope" in artifact);
  assert.equal(artifact.requestedScope.length, expected.itemCount);
  assert.deepEqual(artifact.requestedScope.map((entry) => entry.lot), expected.lots);
  assert.deepEqual(artifact.requestedScope.map((entry) => entry.ceilingPrice), expected.ceilingPrices);
});

test("golden minima cuantia: presupuesto total no se declara precio unitario", () => {
  const input = golden("total-budget-without-unit-prices");
  const document: PreparedProfileDocument = {
    id: input.id,
    name: input.document!.name,
    mimeType: "text/plain",
    parser: "golden",
    size: input.document!.text!.length,
    text: input.document!.text!,
    itemCandidates: 0,
    warnings: [],
    contentState: "ready",
    catalogStatus: "cataloged"
  };
  const expected = input.expected as {
    hasUnitReferencePrices: boolean;
    hasTotalBudgetOnly: boolean;
    totalBudget: string;
    status: string;
  };
  const excerpt = input.document!.text!;
  const { artifact, warnings } = validateFinalArtifact({
    status: "ready",
    executiveSummary: "El documento solo sustenta un presupuesto global.",
    documentAuthority: [],
    relevantRequirements: [],
    requestedScope: [],
    economicStructure: {
      hasUnitReferencePrices: false,
      hasTotalBudgetOnly: true,
      totalBudget: expected.totalBudget,
      currency: "COP",
      notes: ["No se publican valores unitarios."],
      evidence: [{ document: document.name, location: "seccion presupuesto", excerpt }]
    },
    missingInformation: [],
    humanQuestions: [],
    warnings: []
  }, [document]);

  assert.equal(artifact.economicStructure.hasUnitReferencePrices, expected.hasUnitReferencePrices);
  assert.equal(artifact.economicStructure.hasTotalBudgetOnly, expected.hasTotalBudgetOnly);
  assert.equal(artifact.economicStructure.totalBudget, expected.totalBudget);
  assert.equal(artifact.status, expected.status);
  assert.equal(warnings.length, 0);
});

test("golden minima cuantia: conserva el requisito sustentado y elimina el inventado", () => {
  const input = golden("supported-and-invented-requirements");
  const document: PreparedProfileDocument = {
    id: input.id,
    name: input.document!.name,
    mimeType: "text/plain",
    parser: "golden",
    size: input.document!.text!.length,
    text: input.document!.text!,
    itemCandidates: 0,
    warnings: []
  };
  const { artifact, warnings } = validateFinalArtifact({
    status: "ready",
    executiveSummary: "Revision de requisitos.",
    documentAuthority: [],
    relevantRequirements: input.proposedRequirements!.map((entry) => ({
      ...entry,
      category: "habilitante",
      normality: "normal_actionable",
      impact: "medium",
      companyFit: "not_evaluated",
      action: "Revisar antes del cierre.",
      evidence: [{ document: document.name, location: "seccion requisitos", excerpt: entry.excerpt }],
      confidence: "high"
    })),
    requestedScope: [],
    economicStructure: { hasUnitReferencePrices: null, hasTotalBudgetOnly: null, notes: [], evidence: [] },
    missingInformation: [],
    humanQuestions: [],
    warnings: []
  }, [document]);
  const expected = input.expected as { acceptedRequirementIds: string[]; status: string };

  assert.deepEqual(artifact.relevantRequirements.map((entry) => entry.id), expected.acceptedRequirementIds);
  assert.equal(artifact.status, expected.status);
  assert.ok(warnings.some((entry) => /Oficina local/.test(entry)));
});

test("golden minima cuantia: un PDF largo diferido no se lee completo y requisitos usa ventanas inicial, central y final acotadas", async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  const input = golden("long-scanned-governing-document");
  const sourceRef = path.join(dataDir, "golden-long-scan.pdf");
  await fs.mkdir(path.dirname(sourceRef), { recursive: true });
  await fs.writeFile(sourceRef, Buffer.from("golden scanned source"));
  const document: PreparedProfileDocument = {
    id: input.id,
    name: input.document!.name,
    mimeType: "application/pdf",
    parser: "PDF.js catalogo escaneado",
    size: 21,
    text: "",
    itemCandidates: 0,
    warnings: ["Documento escaneado catalogado."],
    sourceHash: "golden-long-scanned-governing-document",
    sourceRef,
    pageCount: input.document!.pageCount,
    contentState: "deferred",
    catalogStatus: "cataloged_with_warnings",
    roleCandidates: [{ role: "governing", confidence: "high", signal: "nombre de invitacion" }],
    sections: [],
    tables: []
  };
  const expected = input.expected as {
    documentMapOcrCalls: number;
    supervisionOcrCalls: number;
    requirementsPageRanges: Array<[number, number]>;
    economicOcrCalls: number;
  };
  let calls = 0;
  const ranges: Array<[number, number]> = [];
  const convert = async (
    _name: string,
    _mime: string,
    _buffer: Buffer,
    options: DoclingClientOptions = {}
  ): Promise<DoclingConversion> => {
    calls += 1;
    if (options.pageRange) ranges.push(options.pageRange);
    return {
      status: "success" as const,
      markdown: "## Garantia\nEl proponente debe presentar garantia de seriedad.",
      text: "",
      processingTime: 1,
      warnings: []
    };
  };

  const map = MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.find((skill) => skill.kind === "document_map")!;
  const requirements = MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.find((skill) => skill.kind === "requirements")!;
  const economics = MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.find((skill) => skill.kind === "economic_structure")!;
  const supervision = MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.find((skill) => skill.kind === "supervision")!;

  await hydrateDocumentsForSkill([document], map, { convert });
  assert.equal(calls, expected.documentMapOcrCalls);
  const deferredBundle = documentBundleForSkill([document], map);
  assert.equal(deferredBundle[0].contentState, "deferred");
  assert.equal(deferredBundle[0].content, "");

  await hydrateDocumentsForSkill([document], supervision, { convert });
  assert.equal(calls, expected.documentMapOcrCalls + expected.supervisionOcrCalls);

  await hydrateDocumentsForSkill([document], requirements, { convert });
  assert.equal(calls, expected.requirementsPageRanges.length);
  assert.deepEqual(ranges, expected.requirementsPageRanges);
  assert.equal(document.chunks?.[0].location, "Paginas 1-6");
  assert.deepEqual(document.chunks?.[0].skills, ["requirements"]);

  await hydrateDocumentsForSkill([document], economics, { convert });
  assert.equal(calls, expected.requirementsPageRanges.length + expected.economicOcrCalls);
});
