import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import { changeWorkProfileOutputContract, createWorkProfileDraftFromDocumentFoundation, MINIMUM_VALUE_INITIAL_ASSESSMENT, MINIMUM_VALUE_PREANALYSIS_VIABILITY, type PreparedProfileDocument, type WorkProfileRun } from "../lib/work-profile-contract";
import { documentBundleForSkill, hydrateDocumentsForSkill, prepareWorkProfileDocuments, relevantExtract } from "../lib/work-profile-documents";
import { convertWithDocling } from "../lib/docling-client";
import { buildSkillPrompt, consolidateSkillOutputs, ensureStructuredScopeCoverage, executeWorkProfileRun, validateFinalArtifact, validateFinalArtifactWithCoverage, validateViabilityArtifact } from "../lib/work-profile-runtime";
import { getWorkProfileRun, listWorkProfileRuns, saveWorkProfileRun } from "../lib/work-profile-store";
import { validateWorkProfileDefinition } from "../lib/work-profile-validation";
import { BUILTIN_WORK_PROTOCOLS, composeProtocolObjective } from "../lib/work-protocol-catalog";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-data-work-profiles");

test("perfil golden: conserva cinco responsabilidades y contrato de salida", () => {
  const validation = validateWorkProfileDefinition(MINIMUM_VALUE_INITIAL_ASSESSMENT);
  assert.equal(validation.ok, true, validation.checks.filter((entry) => !entry.ok).map((entry) => entry.message).join(" "));
  assert.deepEqual(MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.map((skill) => skill.kind), [
    "document_map", "requirements", "technical_scope", "economic_structure", "supervision"
  ]);
});

test("constructor: no publica una skill sin incertidumbre ni evidencia", () => {
  const unsafe = structuredClone(MINIMUM_VALUE_INITIAL_ASSESSMENT);
  unsafe.guardrails = ["Entrega una respuesta completa."];
  const validation = validateWorkProfileDefinition(unsafe);
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((entry) => entry.id === "evidence" && !entry.ok));
  assert.ok(validation.checks.some((entry) => entry.id === "uncertainty" && !entry.ok));
});

test("constructor desde cero: crea identidad nueva sin exponer la catalogacion", () => {
  const draft = createWorkProfileDraftFromDocumentFoundation();
  const validation = validateWorkProfileDefinition(draft);
  assert.match(draft.id, /^custom_profile_/);
  assert.equal(draft.status, "draft");
  assert.equal(draft.version, 1);
  // Catalogar y mapear la autoridad documental es un servicio del sistema:
  // no se configura, no se edita y no aparece entre las skills del borrador.
  assert.equal(draft.skills.some((skill) => skill.kind === "document_map"), false);
  assert.equal(draft.skills[0].kind, "requirements");
  assert.equal(draft.skills.at(-1)?.kind, "supervision");
  assert.equal(validation.ok, true, validation.checks.filter((entry) => !entry.ok).map((entry) => entry.message).join(" "));
});

test("constructor desde cero: cambia de informe integral a viabilidad sin perder la base", () => {
  const initial = createWorkProfileDraftFromDocumentFoundation();
  const viability = changeWorkProfileOutputContract(initial, "caf-project-viability-screen/v1");
  const validation = validateWorkProfileDefinition(viability);
  assert.equal(viability.id, initial.id);
  assert.deepEqual(viability.skills.map((skill) => skill.kind), ["document_map", "requirements", "supervision"]);
  assert.equal(viability.outputContract.id, "caf-project-viability-screen/v1");
  assert.equal(validation.ok, true, validation.checks.filter((entry) => !entry.ok).map((entry) => entry.message).join(" "));
});

test("perfil de pre-evaluacion: limita el trabajo a catalogo, requisitos y decision", () => {
  const validation = validateWorkProfileDefinition(MINIMUM_VALUE_PREANALYSIS_VIABILITY);
  assert.equal(validation.ok, true, validation.checks.filter((entry) => !entry.ok).map((entry) => entry.message).join(" "));
  assert.deepEqual(MINIMUM_VALUE_PREANALYSIS_VIABILITY.skills.map((entry) => entry.kind), ["document_map", "requirements", "supervision"]);
  assert.equal(MINIMUM_VALUE_PREANALYSIS_VIABILITY.outputContract.id, "caf-project-viability-screen/v1");
});

test("constructor: una macrotarea normaliza objetivo y criterios de terminacion", () => {
  const draft = createWorkProfileDraftFromDocumentFoundation();
  const protocol = BUILTIN_WORK_PROTOCOLS[0];
  draft.protocolScope = { protocolId: protocol.id, protocolName: protocol.label, macroStages: [protocol.macroStages[0]] };
  draft.objective = composeProtocolObjective(draft.protocolScope);
  const incompatible = validateWorkProfileDefinition(draft);
  assert.equal(incompatible.checks.find((entry) => entry.id === "protocol_output")?.ok, false);
  const aligned = changeWorkProfileOutputContract(draft, "caf-project-viability-screen/v1");
  const validation = validateWorkProfileDefinition(aligned);
  assert.match(draft.objective, /Pre-evaluacion/);
  assert.equal(validation.checks.find((entry) => entry.id === "protocol_scope")?.ok, true);
});

test("runtime: entrega alcance de protocolo a cada skill sin adelantar etapas", () => {
  const skill = MINIMUM_VALUE_PREANALYSIS_VIABILITY.skills[1];
  const prompt = buildSkillPrompt(MINIMUM_VALUE_PREANALYSIS_VIABILITY, skill, { processNumber: "MC-001" }, [], []);
  assert.match(prompt, /ALCANCE DEL PROTOCOLO/);
  assert.match(prompt, /criterio de terminacion/);
  assert.match(prompt, /Pre-evaluacion/);
});

test("perfil de pre-evaluacion: no confunde compras y logistica ordinarias con bloqueos", () => {
  const instructions = MINIMUM_VALUE_PREANALYSIS_VIABILITY.skills.flatMap((skill) => skill.instructions).join(" ");
  const guardrails = MINIMUM_VALUE_PREANALYSIS_VIABILITY.guardrails.join(" ");
  assert.match(instructions, /disponibilidad ordinaria de productos/i);
  assert.match(instructions, /marca o modelo solo es limitante/i);
  assert.match(guardrails, /entregar en el destino no es por si sola un limitante/i);
  assert.match(instructions, /ausencia generica de adendas como unico motivo/i);
});

test("viabilidad: no acepta un no viable sin conocimiento empresarial", () => {
  const document: PreparedProfileDocument = {
    id: "pliego", name: "invitacion.pdf", mimeType: "application/pdf", parser: "pdfjs", size: 20,
    text: "El proponente debe tener establecimiento de comercio en el municipio.", itemCandidates: 0, warnings: []
  };
  const { artifact } = validateViabilityArtifact({
    decision: "not_viable", summary: "No cumple territorialidad.", conditions: [], missingInformation: [], chatterSignals: [], warnings: [],
    limitingRequirements: [{ id: "R1", title: "Territorialidad", requirement: "Establecimiento local", impact: "high", companyFit: "not_supported", evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "establecimiento de comercio en el municipio" }] }],
    evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "establecimiento de comercio en el municipio" }]
  }, [document], {});
  assert.equal(artifact.decision, "indeterminate");
});

test("viabilidad: confirma no viable cuando requisito y conocimiento se contradicen", () => {
  const document: PreparedProfileDocument = {
    id: "pliego-fit", name: "invitacion.pdf", mimeType: "application/pdf", parser: "pdfjs", size: 20,
    text: "El proponente debe tener establecimiento de comercio en el municipio.", itemCandidates: 0, warnings: []
  };
  const { artifact } = validateViabilityArtifact({
    decision: "not_viable", summary: "Existe un requisito territorial incompatible.", conditions: [], missingInformation: [], chatterSignals: [], warnings: [],
    limitingRequirements: [{ id: "R1", title: "Territorialidad", requirement: "Establecimiento local", impact: "high", companyFit: "not_supported", evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "establecimiento de comercio en el municipio" }, { document: "companyKnowledge", location: "facts[0]", excerpt: "No tiene establecimiento en el municipio" }] }],
    evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "establecimiento de comercio en el municipio" }]
  }, [document], { companyKnowledge: { status: "ready", facts: [{ label: "Domicilio", value: "No tiene establecimiento en el municipio" }] } });
  assert.equal(artifact.decision, "not_viable");
  assert.equal(artifact.status, "ready");
});

test("viabilidad: conserva evidencia empresarial solo si coincide con el contexto recibido", () => {
  const document: PreparedProfileDocument = {
    id: "pliego-company", name: "invitacion.pdf", mimeType: "application/pdf", parser: "pdfjs", size: 20,
    text: "El proponente debe tener experiencia en dos contratos similares.", itemCandidates: 0, warnings: []
  };
  const project = { companyKnowledge: { status: "ready", facts: [{ label: "Experiencia", value: "CAF acredita dos contratos similares" }] } };
  const { artifact, warnings } = validateViabilityArtifact({
    decision: "viable", summary: "Puede continuar.", conditions: [], missingInformation: ["Confirmar logistica de entrega"], chatterSignals: [], warnings: [],
    limitingRequirements: [{ id: "R1", title: "Experiencia", requirement: "Dos contratos", impact: "high", companyFit: "supported", evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "experiencia en dos contratos similares" }, { document: "companyKnowledge", location: "facts[0]", excerpt: "CAF acredita dos contratos similares" }] }],
    evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "experiencia en dos contratos similares" }]
  }, [document], project);
  assert.equal(artifact.decision, "viable");
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.missingInformation.length, 0);
  assert.equal(artifact.limitingRequirements[0].companyFit, "supported");
  assert.equal(warnings.length, 0);
});

test("viabilidad: no acepta contraste empresarial sin citar un hecho recibido", () => {
  const document: PreparedProfileDocument = {
    id: "pliego-company-missing", name: "invitacion.pdf", mimeType: "application/pdf", parser: "pdfjs", size: 20,
    text: "El proponente debe tener experiencia en dos contratos similares.", itemCandidates: 0, warnings: []
  };
  const { artifact, warnings } = validateViabilityArtifact({
    decision: "viable", summary: "Puede continuar.", conditions: [], missingInformation: [], chatterSignals: [], warnings: [],
    limitingRequirements: [{ id: "R1", title: "Experiencia", requirement: "Dos contratos", impact: "high", companyFit: "supported", evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "experiencia en dos contratos similares" }] }],
    evidence: [{ document: "invitacion.pdf", location: "pagina 8", excerpt: "experiencia en dos contratos similares" }]
  }, [document], { companyKnowledge: { status: "ready", facts: [{ label: "Experiencia", value: "CAF acredita dos contratos similares" }] } });
  assert.equal(artifact.decision, "indeterminate");
  assert.equal(artifact.limitingRequirements[0].companyFit, "not_evaluated");
  assert.match(warnings.join(" "), /no cita un hecho recibido/i);
});

test("viabilidad: el chatter solo entra si coincide con una nota real de Odoo", () => {
  const { artifact } = validateViabilityArtifact({
    decision: "indeterminate", summary: "Falta leer adenda.", limitingRequirements: [], conditions: [], missingInformation: ["Adenda pendiente"], evidence: [], warnings: [],
    chatterSignals: [{ text: "Se publico una adenda inventada", relevance: "Cambio" }, { text: "SECOP publico ADENDA 01", relevance: "Revisar cambio" }]
  }, [], { notes: [{ at: "2026-08-09", author: "OdooBot", text: "SECOP publico ADENDA 01" }] });
  assert.equal(artifact.chatterSignals.length, 1);
  assert.equal(artifact.chatterSignals[0].author, "OdooBot");
});

test("documentos: Excel conserva lote, item, unidad y precio como candidatos", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["No. de lote", "Item", "Nombre", "Und de medida", "Cant", "Precio techo unitario"],
    ["Lote 2", 7, "Bateria alcalina AA", "PAC", 4, "$ 32.500"]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Listado");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const documents = await prepareWorkProfileDocuments([{ name: "lista.xlsx", buffer }]);
  assert.equal(documents[0].itemCandidates, 1);
  assert.match(documents[0].text, /Bateria alcalina AA/);
  assert.match(documents[0].text, /Lote 2/);
});

test("lectura dirigida: conserva encabezado y seccion relevante sin enviar el documento entero", () => {
  const text = Array.from({ length: 500 }, (_, index) => index === 330
    ? "GARANTIA DE SERIEDAD: presentar poliza antes del cierre"
    : `Linea irrelevante ${index}`).join("\n");
  const result = relevantExtract(text, ["garantia"], 3500);
  assert.ok(result.length < text.length);
  assert.match(result, /GARANTIA DE SERIEDAD/);
  assert.match(result, /Linea irrelevante 0/);
});

test("auditoria: retira requisitos y precios sin fragmento literal", () => {
  const documents: PreparedProfileDocument[] = [{
    id: "doc-1", name: "invitacion.pdf", mimeType: "application/pdf", parser: "test", size: 100,
    itemCandidates: 0, warnings: [], text: "El proponente debe presentar garantia de seriedad del diez por ciento."
  }];
  const { artifact, warnings } = validateFinalArtifact({
    status: "ready",
    executiveSummary: "Resumen",
    documentAuthority: [],
    relevantRequirements: [
      { id: "R1", title: "Garantia", requirement: "Debe presentar garantia", evidence: [{ document: "invitacion.pdf", location: "p. 3", excerpt: "garantia de seriedad del diez por ciento" }] },
      { id: "R2", title: "Inventado", requirement: "Visita obligatoria", evidence: [{ document: "invitacion.pdf", location: "p. 9", excerpt: "visita obligatoria" }] }
    ],
    requestedScope: [{ description: "Producto inventado", evidence: [{ document: "invitacion.pdf", location: "p. 12", excerpt: "precio unitario 999" }] }],
    economicStructure: { hasUnitReferencePrices: true, notes: [], evidence: [{ document: "invitacion.pdf", location: "p. 12", excerpt: "precio unitario 999" }] },
    missingInformation: [], humanQuestions: [], warnings: []
  }, documents);
  assert.equal(artifact.relevantRequirements.length, 1);
  assert.equal(artifact.requestedScope.length, 0);
  assert.equal(artifact.economicStructure.evidence.length, 0);
  assert.equal(artifact.status, "needs_review");
  assert.ok(warnings.length >= 3);
});

test("auditoria: valida evidencia de Excel aunque el fragmento contenga comillas", () => {
  const excerpt = 'Display OLED 0.96" con interfaz I2C';
  const documents: PreparedProfileDocument[] = [{
    id: "xlsx-1", name: "lista.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "AI-first source mapper + workbook inventory", size: 200, itemCandidates: 1, warnings: [],
    text: JSON.stringify({ items: [{ id: "12", name: excerpt, source: { excerpt } }] }, null, 2)
  }];
  const { artifact, warnings } = validateFinalArtifact({
    status: "ready", executiveSummary: "Resumen", documentAuthority: [], relevantRequirements: [],
    requestedScope: [{ item: "12", description: excerpt, evidence: [{ document: "lista.xlsx", location: "fila 13", excerpt }] }],
    economicStructure: { hasUnitReferencePrices: null, hasTotalBudgetOnly: null, notes: [], evidence: [] },
    missingInformation: [], humanQuestions: [], warnings: []
  }, documents);
  assert.equal(artifact.requestedScope.length, 1);
  assert.equal(warnings.length, 0);
});

test("ejecucion: una skill fallida no borra las anteriores", async () => {
  await fs.rm(process.env.CAF_AGENT_DATA_DIR!, { recursive: true, force: true });
  const now = new Date().toISOString();
  const run: WorkProfileRun = {
    contract: "caf-work-profile-run/v1", id: "profile_run_isolation", name: "Aislamiento",
    profileId: MINIMUM_VALUE_INITIAL_ASSESSMENT.id, profileVersion: MINIMUM_VALUE_INITIAL_ASSESSMENT.version,
    providerId: "mock", status: "draft", project: {},
    documents: [{ id: "d1", name: "lista.txt", mimeType: "text/plain", parser: "test", size: 20, text: "Item 1 bateria AA", itemCandidates: 0, warnings: [] }],
    skills: [], createdAt: now, updatedAt: now
  };
  await saveWorkProfileRun(run);
  let call = 0;
  await executeWorkProfileRun(run.id, async (_provider, request) => {
    call += 1;
    if (call === 2) throw new Error("Falla sintetica aislada");
    return { ok: true, contract: "caf-agent-task/v1", jobId: request.jobId, status: "completed", stage: request.stage, rawResponse: JSON.stringify(request.mockResponse) };
  });
  const saved = await getWorkProfileRun(run.id);
  assert.equal(saved?.skills.length, 5);
  assert.equal(saved?.skills[0].status, "completed");
  assert.equal(saved?.skills[1].status, "failed");
  assert.equal(saved?.skills[2].status, "completed");
  assert.ok(saved?.finalArtifact);
  assert.equal(saved?.status, "needs_review");
});

test("reanudacion: continua desde la primera skill fallida sin duplicar resultados", async () => {
  await fs.rm(process.env.CAF_AGENT_DATA_DIR!, { recursive: true, force: true });
  const now = new Date().toISOString();
  const run: WorkProfileRun = {
    contract: "caf-work-profile-run/v1", id: "profile_run_resume", name: "Reanudacion",
    profileId: MINIMUM_VALUE_INITIAL_ASSESSMENT.id, profileVersion: MINIMUM_VALUE_INITIAL_ASSESSMENT.version,
    providerId: "mock", status: "draft", project: { projectId: "77" },
    documents: [{ id: "d1", name: "lista.txt", mimeType: "text/plain", parser: "test", size: 20, text: "Item 1 bateria AA", itemCandidates: 0, warnings: [] }],
    skills: [], createdAt: now, updatedAt: now
  };
  await saveWorkProfileRun(run);
  let firstCalls = 0;
  await executeWorkProfileRun(run.id, async (_provider, request) => {
    firstCalls += 1;
    if (firstCalls === 2) throw new Error("Falla recuperable");
    return { ok: true, contract: "caf-agent-task/v1", jobId: request.jobId, status: "completed", stage: request.stage, rawResponse: JSON.stringify(request.mockResponse) };
  });
  const first = await getWorkProfileRun(run.id);
  const preservedHash = first?.skills[0].promptHash;
  let resumedCalls = 0;
  const resumed = await executeWorkProfileRun(run.id, async (_provider, request) => {
    resumedCalls += 1;
    return { ok: true, contract: "caf-agent-task/v1", jobId: request.jobId, status: "completed", stage: request.stage, rawResponse: JSON.stringify(request.mockResponse) };
  });
  assert.equal(resumedCalls, 4);
  assert.equal(resumed.skills.length, 5);
  assert.equal(resumed.skills[0].promptHash, preservedHash);
  assert.equal(new Set(resumed.skills.map((entry) => entry.skillId)).size, 5);
  assert.match(resumed.skills[1].prompt || "", /RESULTADOS PREVIOS NORMALIZADOS/);
});

test("normalizacion: preguntas estructuradas no aparecen como object Object", () => {
  const { artifact } = validateFinalArtifact({
    status: "needs_review", executiveSummary: "Resumen", documentAuthority: [], relevantRequirements: [], requestedScope: [],
    economicStructure: { hasUnitReferencePrices: null, hasTotalBudgetOnly: null, notes: [{ text: "Confirmar IVA" }], evidence: [] },
    missingInformation: [{ message: "Falta anexo economico" }],
    humanQuestions: [{ question: "¿Cual documento gobierna?" }, { unknown: "no mostrar" }], warnings: []
  }, []);
  assert.deepEqual(artifact.economicStructure.notes, ["Confirmar IVA"]);
  assert.deepEqual(artifact.missingInformation, ["Falta anexo economico"]);
  assert.deepEqual(artifact.humanQuestions, ["¿Cual documento gobierna?"]);
  assert.doesNotMatch(JSON.stringify(artifact), /\[object Object\]/);
});

test("persistencia: filtra las ejecuciones por proyecto Odoo", async () => {
  await fs.rm(process.env.CAF_AGENT_DATA_DIR!, { recursive: true, force: true });
  const now = new Date().toISOString();
  for (const [id, projectId] of [["run_project_a", "A"], ["run_project_b", "B"]]) {
    await saveWorkProfileRun({
      contract: "caf-work-profile-run/v1", id, name: id,
      profileId: MINIMUM_VALUE_INITIAL_ASSESSMENT.id, profileVersion: 1, providerId: "mock", status: "draft",
      project: { projectId }, documents: [], skills: [], createdAt: now, updatedAt: now
    });
  }
  const filtered = await listWorkProfileRuns({ projectId: "A" });
  assert.deepEqual(filtered.map((entry) => entry.id), ["run_project_a"]);
});

test("bundle: supervision ve resultados relevantes con limite de contexto", () => {
  const document: PreparedProfileDocument = { id: "d", name: "pliego.txt", mimeType: "text/plain", parser: "text", size: 200000, itemCandidates: 0, warnings: [], text: "cabecera\n" + "x".repeat(200000) };
  const bundle = documentBundleForSkill([document], MINIMUM_VALUE_INITIAL_ASSESSMENT.skills[0], 5000);
  assert.ok(bundle[0].content.length <= 5000);
});

test("preparacion: un PDF escaneado se cataloga sin disparar OCR completo", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  try {
    const result = await prepareWorkProfileDocuments([{ name: "invitacion.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-test") }]);
    assert.equal(calls, 0);
    assert.equal(result[0].contentState, "failed");
    assert.doesNotMatch(result[0].parser, /OCR/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("catalogo: reutiliza una hoja estructurada por huella sin perder sus candidatos", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([["Item", "Nombre", "Cant"], [1, "Marcador", 2]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Items");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const first = await prepareWorkProfileDocuments([{ name: "uno.xlsx", buffer }]);
  const second = await prepareWorkProfileDocuments([{ name: "renombrado.xlsx", buffer }]);
  assert.equal(first[0].sourceHash, second[0].sourceHash);
  assert.equal(second[0].name, "renombrado.xlsx");
  assert.equal(second[0].itemCandidates, 1);
  assert.equal(second[0].catalogStatus, "cataloged");
});

test("docling: un PDF largo puede enviarse por rangos de paginas", async () => {
  let pages: string[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    pages = (init?.body as FormData).getAll("page_range").map(String);
    return new Response(JSON.stringify({
      status: "success", processing_time: 0.1,
      document: { md_content: "fragmento", text_content: "fragmento" }, errors: []
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await convertWithDocling("largo.pdf", "application/pdf", Buffer.from("pdf"), { fetchImpl, pageRange: [13, 24] });
  assert.deepEqual(pages, ["13", "24"]);
});

test("lectura diferida: requisitos hidrata ventanas acotadas de un pliego largo", async () => {
  const sourceRef = path.join(process.env.CAF_AGENT_DATA_DIR!, "pliego-source.pdf");
  await fs.mkdir(path.dirname(sourceRef), { recursive: true });
  await fs.writeFile(sourceRef, Buffer.from("pdf"));
  const selectedRanges: Array<[number, number]> = [];
  const document: PreparedProfileDocument = {
    id: "scan-1", name: "invitacion.pdf", mimeType: "application/pdf", parser: "PDF.js catalogo escaneado",
    size: 3, text: "", itemCandidates: 0, warnings: [], sourceHash: "scan-hash", sourceRef,
    pageCount: 46, contentState: "deferred", catalogStatus: "cataloged",
    roleCandidates: [{ role: "governing", confidence: "high", signal: "nombre" }], sections: [], tables: []
  };
  const result = await hydrateDocumentsForSkill([document], MINIMUM_VALUE_INITIAL_ASSESSMENT.skills[1], {
    convert: async (_name, _mime, _buffer, options) => {
      if (options?.pageRange) selectedRanges.push(options.pageRange);
      return { status: "success", markdown: "## Garantia\nDebe presentar garantia de seriedad.", text: "", processingTime: 1, warnings: [] };
    }
  });
  assert.deepEqual(selectedRanges, [[1, 6], [21, 26], [41, 46]]);
  assert.equal(result.documents[0].contentState, "partial");
  assert.equal(result.documents[0].chunks?.[0].location, "Paginas 1-6");
  assert.match(result.documents[0].text, /garantia de seriedad/i);
});

test("consolidacion: el supervisor no puede perder items normalizados por una skill previa", () => {
  const now = new Date().toISOString();
  const skills: WorkProfileRun["skills"] = [
    {
      skillId: "scope", kind: "technical_scope", status: "completed", startedAt: now, completedAt: now,
      promptHash: "x", warnings: [], output: { items: [
        { item: "1", description: "Uno", evidence: [] },
        { item: "2", description: "Dos", evidence: [] }
      ], coverage: { complete: true }, warnings: [] }
    },
    {
      skillId: "supervisor", kind: "supervision", status: "completed", startedAt: now, completedAt: now,
      promptHash: "y", warnings: [], output: {}
    }
  ];
  const consolidated = consolidateSkillOutputs({
    status: "needs_review", requestedScope: [{ item: "1", description: "Uno", evidence: [] }],
    warnings: ["Revision parcial"]
  }, skills);
  assert.equal((consolidated.requestedScope as unknown[]).length, 2);
  assert.deepEqual(consolidated.warnings, ["Revision parcial"]);
});

test("cobertura: recupera filas estructuradas omitidas por la skill tecnica", () => {
  const now = new Date().toISOString();
  const document: PreparedProfileDocument = {
    id: "catalog-coverage", name: "alcance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "workbook", size: 100, itemCandidates: 2, warnings: [],
    text: JSON.stringify({ items: [
      { id: "1", lot: "Lote A", name: "Marcador", unit: "UN", quantity: "3", source: { sheet: "Items", row: 2, excerpt: "Marcador" } },
      { id: "2", lot: "Lote A", name: "Borrador", unit: "UN", quantity: "2", source: { sheet: "Items", row: 3, excerpt: "Borrador" } }
    ] })
  };
  const skills: WorkProfileRun["skills"] = [{
    skillId: "scope", kind: "technical_scope", status: "completed", startedAt: now, completedAt: now,
    promptHash: "coverage", warnings: [], output: {
      items: [{ item: "1", lot: "Lote A", description: "Marcador", evidence: [] }],
      coverage: { complete: true }, warnings: []
    }
  }];
  const consolidated = consolidateSkillOutputs({
    status: "ready", requestedScope: [{ item: "1", lot: "Lote A", description: "Marcador", evidence: [] }], warnings: []
  }, skills, [document]);
  const scope = consolidated.requestedScope as Array<Record<string, unknown>>;
  assert.equal(scope.length, 2);
  assert.equal(scope[1].description, "Borrador");
  assert.match(String((consolidated.warnings as string[])[0]), /recupero 1 fila/i);
});

test("cobertura: no duplica un item sin lote cuando la IA declara NO APLICA", () => {
  const document: PreparedProfileDocument = {
    id: "catalog-no-lot", name: "precios.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "workbook", size: 100, itemCandidates: 2, warnings: [],
    text: JSON.stringify({ items: [
      { id: "1", name: "Sensor de distancia", source: { sheet: "Items", row: 2, excerpt: "Sensor de distancia" } },
      { id: "2", name: "Sensor de humedad", source: { sheet: "Items", row: 3, excerpt: "Sensor de humedad" } }
    ] })
  };
  const consolidated = ensureStructuredScopeCoverage({
    requestedScope: [{ lot: "NO APLICA", item: "1", description: "Sensor distancia ToF", evidence: [] }], warnings: []
  }, [document]);
  const scope = consolidated.requestedScope as Array<Record<string, unknown>>;
  assert.equal(scope.length, 2);
  assert.equal(scope.filter((entry) => entry.item === "1").length, 1);
  assert.equal(scope[1].item, "2");
});

test("cobertura: conserva items distintos aunque compartan descripcion", () => {
  const document: PreparedProfileDocument = {
    id: "same-description", name: "oferta.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "workbook", size: 100, itemCandidates: 2, warnings: [],
    text: JSON.stringify({ items: [
      { id: "101", name: "Servicio de mantenimiento", source: { sheet: "Items", row: 2, excerpt: "Servicio de mantenimiento" } },
      { id: "102", name: "Servicio de mantenimiento", source: { sheet: "Items", row: 3, excerpt: "Servicio de mantenimiento" } }
    ] })
  };
  const consolidated = ensureStructuredScopeCoverage({ requestedScope: [], warnings: [] }, [document]);
  const scope = consolidated.requestedScope as Array<Record<string, unknown>>;
  assert.deepEqual(scope.map((entry) => entry.item), ["101", "102"]);
});

test("cobertura: un lote inferido por la IA no duplica items de una fuente sin lotes", () => {
  const document: PreparedProfileDocument = {
    id: "source-without-lots", name: "precios.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "workbook", size: 100, itemCandidates: 2, warnings: [],
    text: JSON.stringify({ items: [
      { id: "1", name: "Equipo A", source: { sheet: "Items", row: 2, excerpt: "Equipo A" } },
      { id: "2", name: "Equipo B", source: { sheet: "Items", row: 3, excerpt: "Equipo B" } }
    ] })
  };
  const consolidated = ensureStructuredScopeCoverage({
    requestedScope: [{ lot: "LOTE UNICO", item: "1", description: "Equipo A", evidence: [] }], warnings: []
  }, [document]);
  const scope = consolidated.requestedScope as Array<Record<string, unknown>>;
  assert.deepEqual(scope.map((entry) => entry.item), ["1", "2"]);
});

test("cobertura: repone desde Excel un item cuya evidencia de IA fue retirada", () => {
  const document: PreparedProfileDocument = {
    id: "replace-unsupported", name: "precios.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    parser: "workbook", size: 100, itemCandidates: 1, warnings: [],
    text: JSON.stringify({ items: [
      { id: "5", name: "Archivador metalico", unit: "UN", source: { sheet: "Items", row: 7, excerpt: "Archivador metalico" } }
    ] })
  };
  const { artifact } = validateFinalArtifactWithCoverage({
    contract: "caf-project-initial-assessment/v1", status: "needs_review", executiveSummary: "Prueba",
    documentAuthority: [], relevantRequirements: [], economicStructure: {}, missingInformation: [], humanQuestions: [], warnings: [],
    requestedScope: [{
      lot: "LOTE UNICO", item: "5", description: "Archivador metalico", unit: "UN",
      evidence: [{ document: "precios.xlsx", location: "fila desconocida", excerpt: "Texto inventado por el modelo" }]
    }]
  }, [document]);
  assert.equal(artifact.requestedScope.length, 1);
  assert.equal(artifact.requestedScope[0].item, "5");
  assert.equal(artifact.requestedScope[0].evidence[0].excerpt, "Archivador metalico");
});

test("prompt: hereda el alcance tecnico como resumen y no repite cientos de filas", () => {
  const now = new Date().toISOString();
  const items = Array.from({ length: 200 }, (_, index) => ({
    item: String(index + 1), description: `Producto extremadamente detallado ${index + 1}`,
    evidence: [{ document: "precios.xlsx", location: `fila ${index + 2}`, excerpt: `Producto ${index + 1}` }]
  }));
  const previous: WorkProfileRun["skills"] = [{
    skillId: "scope", kind: "technical_scope", status: "completed", startedAt: now, completedAt: now,
    promptHash: "scope", warnings: [], output: { items, coverage: { complete: true }, warnings: [] }
  }];
  const skill = MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.find((entry) => entry.kind === "supervision")!;
  const prompt = buildSkillPrompt(MINIMUM_VALUE_INITIAL_ASSESSMENT, skill, { projectId: "golden" }, [], previous);
  assert.match(prompt, /"itemCount": 200/);
  assert.doesNotMatch(prompt, /Producto extremadamente detallado 199/);
  assert.ok(prompt.length < 25_000, `Prompt heredado demasiado grande: ${prompt.length}`);
});
