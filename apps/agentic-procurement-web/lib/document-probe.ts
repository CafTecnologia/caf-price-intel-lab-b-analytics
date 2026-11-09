import path from "node:path";
import { PDFDocument } from "pdf-lib";

export type DocumentPriority = "high" | "medium" | "low";

export type DocumentProbe = {
  priority: DocumentPriority;
  hints: string[];
  totalPages: number;
  selectedPages: number[];
  text: string;
  focusedText: string;
  hasMachineText: boolean;
  shouldDeepParse: boolean;
  reason: string;
};

const HIGH_NAME_HINTS = [
  /oferta.*econom/i,
  /formato.*econom/i,
  /lista.*precio/i,
  /precio.*referencia/i,
  /estudio.*mercado/i,
  /estudio.*previo/i,
  /presupuesto/i,
  /adenda/i
];

const MEDIUM_NAME_HINTS = [
  /anexo.*tecn/i,
  /especificacion/i,
  /solicitud.*cotizacion/i,
  /concepto.*financier/i,
  /ficha.*tecn/i
];

const LOW_NAME_HINTS = [
  /certificado/i,
  /\bcdp\b/i,
  /cronograma/i,
  /minuta/i,
  /garantia/i,
  /poliza/i
];

const PAGE_SIGNALS: Array<[RegExp, number, string]> = [
  [/\bprecios?\s+de\s+referencia\b/i, 12, "precio de referencia"],
  [/\bvalor(?:es)?\s+unitarios?\b/i, 10, "valor unitario"],
  [/\bprecios?\s+unitarios?\b/i, 10, "precio unitario"],
  [/\boferta\s+economica\b/i, 8, "oferta economica"],
  [/\bpresupuesto\s+oficial\b/i, 8, "presupuesto oficial"],
  [/\bprecio\s+techo\b/i, 8, "precio techo"],
  [/\b(item|ítem)\b/i, 3, "item"],
  [/\b(cantidad|cant\.?)\b/i, 3, "cantidad"],
  [/\b(unidad|und\.?|u\/m)\b/i, 3, "unidad"],
  [/\b(descripcion|descripción|especificaciones)\b/i, 2, "descripcion"],
  [/(?:\$|COP\b|valor\s+total|subtotal)/i, 3, "valor monetario"]
];

export function priorityFromName(fileName: string): DocumentPriority {
  const normalized = path.basename(fileName).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (HIGH_NAME_HINTS.some((pattern) => pattern.test(normalized))) return "high";
  if (LOW_NAME_HINTS.some((pattern) => pattern.test(normalized))) return "low";
  if (MEDIUM_NAME_HINTS.some((pattern) => pattern.test(normalized))) return "medium";
  return "medium";
}

export async function probePdf(fileName: string, buffer: Buffer): Promise<DocumentProbe> {
  const priority = priorityFromName(fileName);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true
  });
  const document = await loadingTask.promise;
  const totalPages = document.numPages;
  const pages = await mapLimit(
    Array.from({ length: totalPages }, (_, index) => index + 1),
    4,
    async (pageNumber) => {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? String(item.str || "") : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { pageNumber, text, ...scorePage(text) };
    }
  );
  await loadingTask.destroy();

  const extractedCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);
  const hasMachineText = extractedCharacters >= Math.max(80, totalPages * 8);
  const ranked = pages
    .filter((page) => page.score >= 6)
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber);
  const corePages = ranked.slice(0, 6).map((page) => page.pageNumber);
  const selectedPages = expandPageWindow(corePages, totalPages, 1, 10);
  const hints = unique(ranked.flatMap((page) => page.hints)).slice(0, 12);
  const text = pages.map((page) => `[[PAGINA ${page.pageNumber}]]\n${page.text}`).join("\n\n");
  const focusedText = pages
    .filter((page) => selectedPages.includes(page.pageNumber))
    .map((page) => `[[PAGINA ORIGINAL ${page.pageNumber}]]\n${page.text}`)
    .join("\n\n");
  const shouldDeepParse = !hasMachineText
    || selectedPages.length > 0
    || priority === "high";
  const reason = !hasMachineText
    ? "No se detecto texto de maquina; requiere OCR o conversion profunda."
    : selectedPages.length
      ? `Se localizaron ${selectedPages.length} pagina(s) alrededor de secciones comerciales.`
      : priority === "high"
        ? "El nombre indica una fuente documental prioritaria."
        : "No se hallaron señales comerciales suficientes para conversion profunda inicial.";

  return {
    priority,
    hints,
    totalPages,
    selectedPages,
    text,
    focusedText: focusedText || sampledText(text, 12_000),
    hasMachineText,
    shouldDeepParse,
    reason
  };
}

export async function focusedPdfBuffer(buffer: Buffer, selectedPages: number[]) {
  if (!selectedPages.length) return buffer;
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  if (selectedPages.length >= source.getPageCount()) return buffer;
  const target = await PDFDocument.create();
  const indexes = selectedPages
    .map((page) => page - 1)
    .filter((page) => page >= 0 && page < source.getPageCount());
  const copied = await target.copyPages(source, indexes);
  copied.forEach((page) => target.addPage(page));
  return Buffer.from(await target.save());
}

export function focusText(content: string, limit = 16_000) {
  if (content.length <= limit) return content;
  const sections = content
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((text, index) => ({ text: text.trim(), index, ...scorePage(text) }))
    .filter((section) => section.text);
  const selected = sections
    .filter((section) => section.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!selected.length) return sampledText(content, limit);
  const indexes = new Set<number>();
  for (const section of selected) {
    indexes.add(section.index);
    if (section.index > 0) indexes.add(section.index - 1);
    if (section.index + 1 < sections.length) indexes.add(section.index + 1);
  }
  const output = sections
    .filter((section) => indexes.has(section.index))
    .sort((left, right) => left.index - right.index)
    .map((section) => section.text)
    .join("\n\n");
  return output.slice(0, limit);
}

export function sampledText(content: string, limit: number) {
  if (content.length <= limit) return content;
  const head = Math.floor(limit * 0.5);
  const middle = Math.floor(limit * 0.25);
  const tail = limit - head - middle;
  const middleStart = Math.max(0, Math.floor(content.length / 2) - Math.floor(middle / 2));
  return [
    content.slice(0, head),
    content.slice(middleStart, middleStart + middle),
    content.slice(-tail)
  ].join("\n\n[...]\n\n");
}

function scorePage(text: string) {
  let score = 0;
  const hints: string[] = [];
  for (const [pattern, weight, hint] of PAGE_SIGNALS) {
    if (!pattern.test(text)) continue;
    score += weight;
    hints.push(hint);
  }
  const numericRows = text.split(/\n/).filter((line) => /\d/.test(line) && /(?:\$|COP|UND|UN\b|cantidad)/i.test(line)).length;
  if (numericRows >= 2) {
    score += 3;
    hints.push("estructura tabular numerica");
  }
  return { score, hints: unique(hints) };
}

function expandPageWindow(core: number[], total: number, radius: number, limit: number) {
  const pages = new Set<number>();
  for (const page of core) {
    for (let candidate = page - radius; candidate <= page + radius; candidate += 1) {
      if (candidate >= 1 && candidate <= total) pages.add(candidate);
    }
  }
  return [...pages].sort((left, right) => left - right).slice(0, limit);
}

async function mapLimit<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>) {
  const output: R[] = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await task(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
