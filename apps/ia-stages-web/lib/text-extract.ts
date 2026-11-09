import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

const TEXT_EXTRACTION_ERROR =
  "No se pudo extraer texto del archivo. Intenta con PDF textual, Word, Excel o TXT.";

export async function extractTextFromFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = getExtension(file.name);

  try {
    if (extension === "txt" || extension === "csv") {
      return buffer.toString("utf8");
    }

    if (extension === "xlsx") {
      return extractXlsxText(buffer);
    }

    if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (extension === "pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }
  } catch {
    throw new Error(TEXT_EXTRACTION_ERROR);
  }

  throw new Error(TEXT_EXTRACTION_ERROR);
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function extractXlsxText(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return `Hoja: ${sheetName}\n${csv}`;
  })
    .filter(Boolean)
    .join("\n\n");
}
