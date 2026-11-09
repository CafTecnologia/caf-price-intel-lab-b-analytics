import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./store";

/**
 * Mapa documental del proyecto.
 *
 * Saber que documento manda, cual lo modifica y cual solo acompana es trabajo
 * transversal: no depende de la macrotarea ni de lo que el usuario configure.
 * Se resuelve una vez por conjunto de documentos y se reutiliza en los analisis
 * siguientes del mismo proyecto mientras la carpeta no cambie.
 */
export type DocumentMap = {
  documents?: Array<{ document: string; role: string; authority: string; reason?: string }>;
  conflicts?: string[];
  warnings?: string[];
};

export type StoredDocumentMap = DocumentMap & {
  key: string;
  sourceHashes: string[];
  createdAt: string;
};

/** La identidad del mapa es el conjunto de documentos, sin importar el orden. */
export function documentMapKey(sourceHashes: string[]) {
  const limpios = sourceHashes.filter(Boolean).map((entry) => entry.trim().toLowerCase());
  return createHash("sha256").update([...new Set(limpios)].sort().join("|")).digest("hex");
}

function mapDir() {
  return path.join(dataDirectory(), "document-maps");
}

export async function getDocumentMap(key: string): Promise<StoredDocumentMap | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(mapDir(), `${key}.json`), "utf8")) as StoredDocumentMap;
  } catch {
    return null;
  }
}

export async function saveDocumentMap(key: string, sourceHashes: string[], value: DocumentMap) {
  await fs.mkdir(mapDir(), { recursive: true });
  const target = path.join(mapDir(), `${key}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const stored: StoredDocumentMap = { ...value, key, sourceHashes, createdAt: new Date().toISOString() };
  await fs.writeFile(temporary, JSON.stringify(stored, null, 2), "utf8");
  try {
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(temporary, { force: true });
  }
  return stored;
}
