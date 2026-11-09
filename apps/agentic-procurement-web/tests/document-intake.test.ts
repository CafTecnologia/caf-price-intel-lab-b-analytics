import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import {
  analyzeDocumentSet,
  DOCUMENT_INTAKE_ACCEPT,
  isSupportedDocumentName
} from "../lib/document-intake";
import { DOCUMENT_INTAKE_PROFILES } from "../lib/document-intake-contract";
import { parseMarkdownDocument } from "../lib/document-parser";

const markdownTable = `
# Anexo economico

| Item | Nombre | Descripcion | Und de medida | Cant | Precio techo unitario |
| --- | --- | --- | --- | --- | --- |
| 1 | Cable solar | Cable fotovoltaico rojo 6 mm | ML | 20 | $ 8.250 |
| 2 | Conector MC4 | Pareja de conectores para panel | PAR | 4 | $ 16.000 |
`;

test("registro de perfiles conserva un contrato extensible", () => {
  assert.equal(DOCUMENT_INTAKE_PROFILES[0].id, "procurement_items_v1");
  assert.equal(DOCUMENT_INTAKE_PROFILES[0].outputContract, "procurement_items");
  assert.ok(DOCUMENT_INTAKE_PROFILES[0].acceptedRoles.includes("item_list"));
});

test("formatos admiten PDF y Office sin quitar Excel", () => {
  assert.equal(isSupportedDocumentName("lista.xlsx"), true);
  assert.equal(isSupportedDocumentName("pliego.pdf"), true);
  assert.equal(isSupportedDocumentName("anexo.docx"), true);
  assert.equal(isSupportedDocumentName("foto.png"), true);
  assert.equal(isSupportedDocumentName("archivo.exe"), false);
  assert.match(DOCUMENT_INTAKE_ACCEPT, /\.pdf/);
});

test("parser Markdown conserva tabla y evidencia de un PDF convertido", () => {
  const parsed = parseMarkdownDocument("anexo.pdf", markdownTable, 1200);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].name, "Cable solar");
  assert.equal(parsed.items[0].source.file, "anexo.pdf");
  assert.match(parsed.items[0].source.excerpt || "", /Cable fotovoltaico/);
});

test("servicio convierte PDF local y entrega caf-document-intake/v1", async () => {
  const result = await analyzeDocumentSet([{
    name: "anexo-economico.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-test")
  }], {
    profileId: "procurement_items_v1",
    providerId: "mock",
    source: { kind: "upload" },
    convert: async () => ({
      markdown: markdownTable,
      text: "",
      status: "success",
      processingTime: 0.1,
      warnings: []
    })
  });

  assert.equal(result.contract, "caf-document-intake/v1");
  assert.equal(result.status, "ready");
  assert.equal(result.coverage.documentsFound, 1);
  assert.equal(result.coverage.documentsSelected, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].evidence[0].documentId, result.documents[0].id);
});

test("un archivo llamado PDF con contenido HTML no derriba la carpeta", async () => {
  let converterCalled = false;
  const result = await analyzeDocumentSet([{
    name: "informe.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<!DOCTYPE html><html><body><h1>Informe</h1></body></html>")
  }], {
    providerId: "mock",
    source: { kind: "upload" },
    convert: async () => {
      converterCalled = true;
      throw new Error("No debe invocar Docling");
    }
  });

  assert.equal(converterCalled, false);
  assert.equal(result.documents[0].status, "processed");
  assert.equal(result.documents[0].parser, "HTML directo");
  assert.ok(result.warnings.some((warning) => warning.includes("no coincide")));
});

test("carpeta conserva Excel util e ignora soporte sin items en respaldo determinista", async () => {
  const workbook = workbookBuffer([
    ["Item", "Nombre", "Descripcion", "Und de medida", "Cant", "Precio techo unitario"],
    [1, "Taladro", "Taladro 1/2 pulgada", "UND", 2, "$ 700.000"]
  ]);
  const result = await analyzeDocumentSet([
    { name: "lista.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook },
    { name: "cronograma.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }
  ], {
    providerId: "mock",
    source: { kind: "odoo_drive_folder", projectId: "42" },
    convert: async () => ({
      markdown: "# Cronograma\nCierre: viernes.",
      text: "Cronograma",
      status: "success",
      processingTime: 0.1,
      warnings: []
    })
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.documents.find((entry) => entry.name === "lista.xlsx")?.selected, true);
  assert.equal(result.documents.find((entry) => entry.name === "cronograma.pdf")?.selected, false);
  assert.equal(result.selection.method, "deterministic_fallback");
});

test("versiones con mismo item y distinta cantidad quedan en revision", async () => {
  const first = workbookBuffer([
    ["Item", "Nombre", "Und", "Cant"],
    [1, "Silla operativa", "UND", 10]
  ]);
  const second = workbookBuffer([
    ["Item", "Nombre", "Und", "Cant"],
    [1, "Silla operativa", "UND", 12]
  ]);
  const result = await analyzeDocumentSet([
    { name: "listado-original.xlsx", buffer: first },
    { name: "adenda-listado.xlsx", buffer: second }
  ], {
    providerId: "mock",
    source: { kind: "upload" }
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].evidence.length, 2);
  assert.equal(result.conflicts[0].code, "duplicate_item_mismatch");
});

test("fila narrativa de IA sin fragmento literal se descarta", async () => {
  const result = await analyzeDocumentSet([
    { name: "pliego.pdf", mimeType: "application/pdf", buffer: Buffer.from("a") },
    { name: "estudio.pdf", mimeType: "application/pdf", buffer: Buffer.from("b") }
  ], {
    providerId: "codex_vps",
    source: { kind: "upload" },
    convert: async (fileName) => ({
      markdown: fileName === "pliego.pdf" ? "# Pliego\nSe requiere mobiliario." : "# Estudio\nSin listado.",
      text: "",
      status: "success",
      processingTime: 0.1,
      warnings: []
    }),
    classify: async (input) => ({
      documents: input.documents.map((document, index) => ({
        id: document.id,
        role: index ? "supporting" : "item_list",
        relevance: index ? "low" : "high",
        selected: index === 0,
        reason: "Clasificacion de prueba."
      })),
      extractedItems: [{
        documentId: input.documents[0].id,
        name: "Computador inventado",
        quantity: 10,
        excerpt: "Diez computadores Core i9"
      }]
    })
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.status, "failed");
  assert.ok(result.warnings.some((warning) => warning.includes("evidencia literal")));
});

function workbookBuffer(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Listado");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
