import { copyFileSync, existsSync, readFileSync } from "node:fs";

function sanitizeJsonText(rawText: string): string {
  return rawText.replace(/^\uFEFF/, "").trim();
}

export function readSanitizedJsonText(targetPath: string): string | null {
  if (!existsSync(targetPath)) {
    return null;
  }

  return sanitizeJsonText(readFileSync(targetPath, "utf8"));
}

export function backupCorruptedJsonFile(targetPath: string): string | null {
  if (!existsSync(targetPath)) {
    return null;
  }

  const backupPath = `${targetPath}.corrupt-${Date.now()}.bak`;

  try {
    copyFileSync(targetPath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}
