import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { convertWithDocling } from "./docling-client";
import { parseDocument } from "./document-parser";
import { extractPdfText } from "./pdf-text";
import { getCachedDocumentCatalog, getDocumentIdentity, saveDocumentCatalog, saveDocumentIdentity, saveDocumentSource } from "./work-profile-store";
import type { PreparedProfileDocument, WorkSkill, WorkSkillKind } from "./work-profile-contract";

const STRUCTURED = new Set([".xlsx", ".xls", ".csv", ".json"]);
const TEXT = new Set([".txt", ".md", ".html", ".htm"]);
// 5: los escaneados se convierten completos con OCR asincrono, no por ventanas.
const CATALOG_VERSION = 5;

export type WorkProfileInputFile = {
  id?: string;
  name: string;
  mimeType?: string;
  buffer: Buffer;
  /** md5 que Drive entrega en el listado, antes de descargar. */
  md5?: string;
};

export async function prepareWorkProfileDocuments(files: WorkProfileInputFile[]) {
  const documents: PreparedProfileDocument[] = [];
  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();
    const sourceHash = createHash("sha256").update(file.buffer).digest("hex");
    const sourceRef = await saveDocumentSource(sourceHash, extension, file.buffer);
    const base = {
      id: file.id || sourceHash.slice(0, 16),
      name: file.name,
      mimeType: file.mimeType || "application/octet-stream",
      size: file.buffer.length,
      warnings: [] as string[],
      sourceHash,
      sourceRef,
      catalogVersion: CATALOG_VERSION
    };
    const computedMd5 = createHash("md5").update(file.buffer).digest("hex");
    const declaredMd5 = (file.md5 || "").trim().toLowerCase();
    if (declaredMd5 && declaredMd5 !== computedMd5) {
      base.warnings.push(
        "El md5 declarado por Drive no coincide con el contenido del archivo; se registro la identidad con el md5 real."
      );
    }
    await saveDocumentIdentity({ md5: computedMd5, sourceHash, name: file.name, size: file.buffer.length });
    const cached = await getCachedDocumentCatalog(sourceHash);
    if (cached?.catalogVersion === CATALOG_VERSION) {
      // base trae warnings vacio; las advertencias del catalogo deben sobrevivir
      // al reuso o el usuario deja de ver por que un documento quedo diferido.
      documents.push({ ...cached, ...base, warnings: [...base.warnings, ...(cached.warnings || [])] });
      continue;
    }
    let document: PreparedProfileDocument;
    try {
      if (STRUCTURED.has(extension)) {
        const parsed = parseDocument(file.name, file.buffer, "source");
        const text = JSON.stringify({ inventory: parsed.inventory, items: parsed.items }, null, 2);
        document = {
          ...base,
          parser: parsed.inventory.parser,
          itemCandidates: parsed.items.length,
          text,
          contentState: "ready",
          catalogStatus: parsed.inventory.warnings.length ? "cataloged_with_warnings" : "cataloged",
          roleCandidates: inferRoles(file.name, text.slice(0, 8_000)),
          sections: parsed.inventory.sheets.map((sheet) => ({
            title: sheet.name,
            location: `Hoja ${sheet.name}`,
            hints: inferHints(sheet.name)
          })),
          tables: parsed.inventory.sheets.map((sheet) => ({
            name: sheet.name,
            location: `Hoja ${sheet.name}`,
            rows: sheet.rows,
            columns: sheet.columns,
            hints: inferHints(`${sheet.name} ${text.slice(0, 4_000)}`)
          })),
          warnings: parsed.inventory.warnings
        };
      } else if (TEXT.has(extension) || (file.mimeType || "").startsWith("text/")) {
        const text = file.buffer.toString("utf8");
        document = {
          ...base,
          parser: "text-direct catalog",
          itemCandidates: 0,
          text,
          contentState: "ready",
          catalogStatus: "cataloged",
          roleCandidates: inferRoles(file.name, text.slice(0, 8_000)),
          sections: sectionIndex(text),
          tables: []
        };
      } else if (extension === ".pdf") {
        const extracted = await extractPdfText(file.buffer);
        const useful = usefulTextLength(extracted.text);
        if (useful >= 400) {
          document = {
            ...base,
            parser: `PDF.js indice de texto (${extracted.pages} paginas)`,
            pageCount: extracted.pages,
            itemCandidates: 0,
            text: extracted.text,
            contentState: "ready",
            catalogStatus: "cataloged",
            roleCandidates: inferRoles(file.name, extracted.text.slice(0, 12_000)),
            sections: pdfSectionIndex(extracted.pageTexts),
            tables: []
          };
        } else {
          // Escaneado: se convierte entero una sola vez. El catalogo guarda por
          // sourceHash, asi que este OCR no se repite nunca mas.
          let ocrCompleto: Awaited<ReturnType<typeof convertWithDocling>> | null = null;
          let avisoOcr = "";
          try {
            ocrCompleto = await convertWithDocling(file.name, file.mimeType || "application/pdf", file.buffer, {
              doOcr: true,
              async: true,
              tableMode: "accurate",
              includeImages: false,
              documentTimeout: 900
            });
          } catch (error) {
            avisoOcr = error instanceof Error ? error.message : String(error);
          }
          const textoCompleto = ocrCompleto ? (ocrCompleto.markdown || ocrCompleto.text) : "";
          if (usefulTextLength(textoCompleto) >= 400) {
            document = {
              ...base,
              parser: `Docling OCR completo (${extracted.pages} paginas)`,
              pageCount: extracted.pages,
              itemCandidates: 0,
              text: textoCompleto,
              contentState: "ready",
              catalogStatus: "cataloged",
              roleCandidates: inferRoles(file.name, textoCompleto.slice(0, 12_000)),
              sections: sectionIndex(textoCompleto),
              tables: markdownTableIndex(textoCompleto),
              warnings: []
            };
          } else {
            document = {
              ...base,
              parser: `PDF.js catalogo escaneado (${extracted.pages} paginas)`,
              pageCount: extracted.pages,
              itemCandidates: 0,
              text: "",
              contentState: "deferred",
              catalogStatus: "cataloged_with_warnings",
              roleCandidates: inferRoles(file.name, ""),
              sections: [],
              tables: [],
              warnings: [
                avisoOcr
                  ? `No se pudo leer el documento completo (${avisoOcr.slice(0, 160)}). Queda una lectura dirigida por ventanas, que no permite responder por ausencia.`
                  : "Documento escaneado sin texto util tras el OCR completo. Queda una lectura dirigida por ventanas."
              ]
            };
          }
        }
      } else {
        const converted = await convertWithDocling(file.name, file.mimeType || "application/octet-stream", file.buffer, {
          doOcr: false,
          tableMode: "fast",
          includeImages: false,
          documentTimeout: 180
        });
        const text = converted.markdown || converted.text;
        document = {
          ...base,
          parser: `Docling indice ${converted.status}`,
          itemCandidates: 0,
          text,
          contentState: text ? "ready" : "partial",
          catalogStatus: converted.warnings.length ? "cataloged_with_warnings" : "cataloged",
          roleCandidates: inferRoles(file.name, text.slice(0, 8_000)),
          sections: sectionIndex(text),
          tables: markdownTableIndex(text),
          warnings: converted.warnings
        };
      }
    } catch (error) {
      document = {
        ...base,
        parser: "catalog failed",
        itemCandidates: 0,
        text: "",
        contentState: "failed",
        catalogStatus: "failed",
        roleCandidates: inferRoles(file.name, ""),
        sections: [],
        tables: [],
        warnings: [error instanceof Error ? error.message : String(error)]
      };
    }
    document.warnings = [...base.warnings, ...(document.warnings || [])];
    await saveDocumentCatalog(sourceHash, document);
    documents.push(document);
  }
  return documents;
}

/**
 * Arma los documentos de una corrida a partir de hashes ya catalogados.
 * Es lo que permite pedir apoyo IA por segunda vez sin volver a subir nada.
 */
export async function documentsFromHashes(sourceHashes: string[]) {
  const documents: PreparedProfileDocument[] = [];
  const missing: string[] = [];
  for (const sourceHash of sourceHashes) {
    const normalized = String(sourceHash || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      missing.push(sourceHash);
      continue;
    }
    const cached = await getCachedDocumentCatalog(normalized);
    if (cached?.catalogVersion === CATALOG_VERSION) documents.push(cached);
    else missing.push(sourceHash);
  }
  return { documents, missing };
}

/** Resuelve que archivos de Drive ya estan catalogados, sin descargar nada. */
export async function resolveCatalogByMd5(entries: Array<{ driveId?: string; md5?: string }>) {
  const known: Array<{ driveId?: string; md5: string; sourceHash: string }> = [];
  const missing: Array<{ driveId?: string; md5?: string }> = [];
  for (const entry of entries) {
    const md5 = (entry.md5 || "").trim().toLowerCase();
    if (!md5) { missing.push(entry); continue; }
    const identity = await getDocumentIdentity(md5);
    if (!identity) { missing.push(entry); continue; }
    const cached = await getCachedDocumentCatalog(identity.sourceHash);
    if (cached?.catalogVersion === CATALOG_VERSION) known.push({ driveId: entry.driveId, md5, sourceHash: identity.sourceHash });
    else missing.push(entry);
  }
  return { known, missing };
}

export { CATALOG_VERSION };

export function documentBundleForSkill(documents: PreparedProfileDocument[], skill: WorkSkill, maxChars = 90_000) {
  const ordered = documents
    .map((document, index) => ({ document, index, score: documentRelevance(document, skill) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const perDocument = Math.max(2_000, Math.floor(maxChars / Math.max(1, documents.length)));
  let remaining = maxChars;
  return ordered.map(({ document, score }) => {
    const contentLimit = skill.kind === "document_map" ? Math.min(2_500, remaining) : Math.min(perDocument, remaining);
    const selected = relevantExtract(document.text, skill.sourceHints, contentLimit);
    remaining = Math.max(0, remaining - selected.length);
    return {
      id: document.id,
      name: document.name,
      mimeType: document.mimeType,
      parser: document.parser,
      pageCount: document.pageCount,
      contentState: document.contentState,
      roleCandidates: document.roleCandidates,
      sections: document.sections,
      tables: document.tables,
      chunks: (document.chunks || []).filter((chunk) => chunk.skills.includes(skill.kind)).map((chunk) => ({
        location: chunk.location,
        method: chunk.method,
        hints: chunk.hints
      })),
      itemCandidates: document.itemCandidates,
      warnings: document.warnings,
      relevance: score,
      content: selected
    };
  });
}

export async function hydrateDocumentsForSkill(
  documents: PreparedProfileDocument[],
  skill: WorkSkill,
  options: { convert?: typeof convertWithDocling } = {}
) {
  if (skill.kind === "document_map" || skill.kind === "supervision") return { documents, warnings: [] as string[] };
  const convert = options.convert || convertWithDocling;
  const warnings: string[] = [];
  for (const document of documents) {
    if (!shouldHydrate(document, skill)) continue;
    const ranges = directedPageRanges(document, skill.kind, skill.sourceHints || []);
    if (ranges.every((pageRange) => (document.chunks || []).some((chunk) =>
      chunk.location === `Paginas ${pageRange[0]}-${pageRange[1]}` && chunk.skills.includes(skill.kind)
    ))) continue;
    if (!document.sourceRef || !document.sourceHash) {
      warnings.push(`${document.name}: no conserva una referencia local para lectura dirigida.`);
      continue;
    }
    const buffer = await fs.readFile(document.sourceRef);
    for (const pageRange of ranges) {
      const location = `Paginas ${pageRange[0]}-${pageRange[1]}`;
      const reusable = (document.chunks || []).find((chunk) => chunk.location === location);
      if (reusable) {
        reusable.skills = [...new Set([...reusable.skills, skill.kind])];
        await saveDocumentCatalog(document.sourceHash, document);
        continue;
      }
      try {
        const converted = await convert(document.name, document.mimeType || "application/pdf", buffer, {
          doOcr: true,
          async: true,
          ocrPreset: "auto",
          tableMode: "fast",
          doTableStructure: skill.kind === "economic_structure" || skill.kind === "technical_scope",
          includeImages: false,
          imagesScale: 1,
          documentTimeout: 300,
          pageRange
        });
        const text = converted.markdown || converted.text;
        if (!text.trim()) throw new Error("la lectura dirigida no produjo texto");
        const chunk = {
          id: createHash("sha1").update(document.sourceHash).update(skill.kind).update(pageRange.join("-")).digest("hex").slice(0, 16),
          location,
          text,
          method: "ocr" as const,
          skills: [skill.kind],
          hints: inferHints(text.slice(0, 12_000))
        };
        document.chunks = [...(document.chunks || []), chunk];
        document.text = [document.text, `[${chunk.location} - OCR dirigido]\n${text}`].filter(Boolean).join("\n\n");
        document.contentState = "partial";
        if (!document.parser.includes("OCR dirigido")) document.parser = `${document.parser} + OCR dirigido`;
        document.sections = [...(document.sections || []), ...sectionIndex(text).map((section) => ({
          ...section,
          location: `${chunk.location}, ${section.location}`
        }))].slice(0, 200);
        document.warnings = document.warnings.filter((warning) => !warning.includes("OCR queda diferido"));
        document.warnings.push(`Lectura dirigida aplicada a ${chunk.location}; el resto del documento no se recorrio.`);
        await saveDocumentCatalog(document.sourceHash, document);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(`${document.name} (${pageRange[0]}-${pageRange[1]}): ${detail}`);
      }
    }
  }
  return { documents, warnings };
}

export function relevantExtract(text: string, hints: string[], limit: number) {
  if (!text || limit <= 0) return "";
  if (text.length <= limit) return text;
  const normalizedHints = hints.map(normalize).filter(Boolean);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const scored = lines.map((line, index) => ({
    index,
    score: normalizedHints.reduce((sum, hint) => sum + (normalize(line).includes(hint) ? 1 : 0), 0)
  })).filter((entry) => entry.score > 0);
  const picked = new Set<number>();
  scored.sort((left, right) => right.score - left.score).forEach(({ index }) => {
    for (let offset = -4; offset <= 10; offset += 1) {
      if (index + offset >= 0 && index + offset < lines.length) picked.add(index + offset);
    }
  });
  for (let index = 0; index < Math.min(lines.length, 50); index += 1) picked.add(index);
  const ordered = [...picked].sort((left, right) => left - right);
  let output = "";
  let previous = -2;
  for (const index of ordered) {
    if (index > previous + 1) output += "\n[...seccion omitida...]\n";
    const next = `${lines[index]}\n`;
    if (output.length + next.length > limit) break;
    output += next;
    previous = index;
  }
  return output || text.slice(0, limit);
}

function documentRelevance(document: PreparedProfileDocument, skill: WorkSkill) {
  if (skill.kind === "supervision") return 1;
  const searchable = normalize([
    document.name,
    ...(document.roleCandidates || []).map((entry) => entry.role),
    ...(document.sections || []).flatMap((entry) => [entry.title, ...entry.hints]),
    ...(document.tables || []).flatMap((entry) => [entry.name, ...entry.hints])
  ].join(" "));
  return skill.sourceHints.reduce((score, hint) => score + (searchable.includes(normalize(hint)) ? 2 : 0), 0)
    + (document.itemCandidates > 0 && ["technical_scope", "economic_structure"].includes(skill.kind) ? 5 : 0);
}

function shouldHydrate(document: PreparedProfileDocument, skill: WorkSkill) {
  if (!["deferred", "partial"].includes(document.contentState || "") || !document.pageCount || !/pdf/i.test(document.mimeType)) return false;
  const roles = new Set<string>((document.roleCandidates || []).map((entry) => entry.role));
  if (skill.kind === "requirements") {
    const likelyRequirementsSource = /estudios?[\s_-]*previos?|invitacion|pliego|terminos?[\s_-]*de[\s_-]*referencia/i.test(document.name);
    return likelyRequirementsSource || ["governing", "amendment", "requirements"].some((role) => roles.has(role));
  }
  if (skill.kind === "technical_scope") return ["technical", "economic"].some((role) => roles.has(role));
  if (skill.kind === "economic_structure") return roles.has("economic");
  return false;
}

// Las paginas que el propio indice del documento senala para lo que se busca.
function pagesFromIndex(document: PreparedProfileDocument, hints: string[]): number[] {
  if (!hints.length) return [];
  const wanted = hints.map((hint) => normalize(hint)).filter(Boolean);
  const pages = new Set<number>();
  for (const section of document.sections || []) {
    const haystack = normalize(`${section.title} ${(section.hints || []).join(" ")}`);
    if (!wanted.some((hint) => haystack.includes(hint))) continue;
    // "Pagina 12" y tambien "Paginas 20-25, Linea 8": interesa el primer numero.
    const match = /p[aá]ginas?\s+(\d+)/i.exec(section.location || "");
    if (match) pages.add(Number(match[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

// Paginas sueltas agrupadas en tramos legibles, sin pasarse de ancho.
function groupPages(pages: number[], total: number, span = 5): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const page of pages) {
    const last = ranges[ranges.length - 1];
    if (last && page <= last[1] + 1 && page - last[0] <= span) {
      last[1] = Math.min(total, Math.max(last[1], page));
      continue;
    }
    ranges.push([Math.max(1, page), Math.min(total, page + 1)]);
  }
  return ranges.map(([from, to]) => [from, Math.min(total, Math.max(to, from + 2))] as [number, number]);
}

function directedPageRanges(
  document: PreparedProfileDocument,
  kind: WorkSkillKind,
  hints: string[] = []
): Array<[number, number]> {
  const pages = Math.max(1, document.pageCount || 1);
  if (pages <= 8) return [[1, pages]];

  // Lo que el indice del documento dice sobre donde esta lo que se busca.
  const indicadas = groupPages(pagesFromIndex(document, hints), pages);
  if (indicadas.length) {
    // La tabla de contenido vive al principio: entra siempre, es el mapa.
    const portada: [number, number] = [1, Math.min(4, pages)];
    const conPortada = indicadas.some((r) => r[0] <= portada[1]) ? indicadas : [portada, ...indicadas];
    return conPortada.slice(0, 5);
  }

  // Sin indice util, la aritmetica de siempre: mejor muestrear que no leer.
  const primary: [number, number] = kind === "economic_structure"
    ? [Math.max(1, pages - 5), pages]
    : [1, Math.min(6, pages)];
  const last: [number, number] = [Math.max(1, pages - 5), pages];
  if (kind === "requirements" && pages <= 18) {
    return last[0] === primary[0] ? [primary] : [primary, last];
  }
  if (pages <= 18) return [primary];
  const middleStart = Math.max(1, Math.min(pages - 5, Math.floor(pages / 2) - 2));
  const middle: [number, number] = [middleStart, Math.min(pages, middleStart + 5)];
  const ranges = middle[0] === primary[0] && middle[1] === primary[1] ? [primary] : [primary, middle];
  if (kind === "requirements" && !ranges.some((range) => range[0] === last[0] && range[1] === last[1])) ranges.push(last);
  return ranges;
}

function inferRoles(name: string, sample: string): NonNullable<PreparedProfileDocument["roleCandidates"]> {
  const value = normalize(`${name} ${sample.slice(0, 4_000)}`);
  const patterns: Array<[NonNullable<PreparedProfileDocument["roleCandidates"]>[number]["role"], RegExp, string]> = [
    ["amendment", /adenda|modificacion|alcance/, "nombre o encabezado de adenda"],
    ["governing", /invitacion|pliego|terminos de referencia/, "nombre o encabezado rector"],
    ["economic", /precio|econom|presupuesto|oferta|cotiz/, "senales economicas"],
    ["technical", /anexo tecnico|ficha tecnica|especificacion|item|lote/, "senales de alcance tecnico"],
    ["requirements", /habilitante|requisito|experiencia|garantia|capacidad/, "senales de requisitos"],
    ["supporting", /estudio previo|soporte|certificado|cdp/, "documento de soporte"]
  ];
  const matches = patterns.filter(([, pattern]) => pattern.test(value)).map(([role, , signal], index) => ({
    role,
    confidence: (index === 0 ? "high" : "medium") as "high" | "medium",
    signal
  }));
  return matches.length ? matches.slice(0, 3) : [{ role: "unknown", confidence: "low", signal: "solo metadatos; requiere clasificacion posterior" }];
}

function sectionIndex(text: string): NonNullable<PreparedProfileDocument["sections"]> {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.flatMap((line, index) => {
    const clean = line.replace(/^#+\s*/, "").trim();
    const looksLikeHeading = /^#{1,6}\s+/.test(line) || (/^[A-Z0-9][A-Z0-9 .()/-]{5,100}$/.test(clean) && clean.split(/\s+/).length <= 14);
    return looksLikeHeading ? [{ title: clean.slice(0, 140), location: `Linea ${index + 1}`, hints: inferHints(clean) }] : [];
  }).slice(0, 120);
}

function pdfSectionIndex(pages: Array<{ page: number; text: string }>): NonNullable<PreparedProfileDocument["sections"]> {
  return pages.flatMap(({ page, text }) => {
    const candidates = text.split(/(?<=[.:])\s+/).filter((line) => /requis|experien|garantia|lote|item|precio|presupuesto|especific|cronograma|forma de pago/i.test(line));
    return candidates.slice(0, 8).map((title) => ({ title: title.slice(0, 180), location: `Pagina ${page}`, hints: inferHints(title) }));
  }).slice(0, 160);
}

function markdownTableIndex(text: string): NonNullable<PreparedProfileDocument["tables"]> {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tables: NonNullable<PreparedProfileDocument["tables"]> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue;
    tables.push({ name: lines[index].replace(/\|/g, " ").trim().slice(0, 140), location: `Linea ${index + 1}`, hints: inferHints(lines[index]) });
  }
  return tables.slice(0, 100);
}

function inferHints(value: string) {
  const normalized = normalize(value);
  return ["lote", "item", "descripcion", "unidad", "cantidad", "precio", "presupuesto", "requisito", "experiencia", "garantia", "especificacion"]
    .filter((hint) => normalized.includes(hint));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function usefulTextLength(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").length;
}
