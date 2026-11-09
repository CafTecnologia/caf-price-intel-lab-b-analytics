import path from "node:path";
import { pathToFileURL } from "node:url";

export async function extractPdfText(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const document = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: string[] = [];
  const pageTexts: Array<{ page: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => "str" in item ? item.str : "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push({ page: pageNumber, text });
    if (text) pages.push(`[Pagina ${pageNumber}]\n${text}`);
  }
  return { text: pages.join("\n\n"), pages: document.numPages, pageTexts };
}
