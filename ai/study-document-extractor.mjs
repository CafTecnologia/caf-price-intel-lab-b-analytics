import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = Object.freeze({ maxFileBytes: 10_000_000, maxTextChars: 350_000, maxTotalTextChars: 2_000_000, maxDocuments: 25 });
const SHA256 = /^[a-f0-9]{64}$/;
const OFFICE = new Map([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
]);

function fail(message) { throw new Error(`Extractor de originales: ${message}`); }
function limit(value, key) {
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULTS[key]) fail(`límite ${key} inválido`);
  return value;
}
function resolvedOptions(storageDir, agentUid, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('opciones inválidas');
  if (typeof storageDir !== 'string' || !path.isAbsolute(storageDir)) fail('storageDir absoluto es obligatorio');
  return Object.freeze({
    storageDir: path.resolve(storageDir), agentUid,
    maxFileBytes: options.maxFileBytes === undefined ? DEFAULTS.maxFileBytes : limit(options.maxFileBytes, 'maxFileBytes'),
    maxTextChars: options.maxTextChars === undefined ? DEFAULTS.maxTextChars : limit(options.maxTextChars, 'maxTextChars'),
    maxTotalTextChars: options.maxTotalTextChars === undefined ? DEFAULTS.maxTotalTextChars : limit(options.maxTotalTextChars, 'maxTotalTextChars'),
    maxDocuments: options.maxDocuments === undefined ? DEFAULTS.maxDocuments : limit(options.maxDocuments, 'maxDocuments'),
    pythonPath: options.pythonPath || 'python3',
    pdftotextPath: options.pdftotextPath || 'pdftotext',
    parserUid: options.parserUid ?? (process.getuid?.() === 0 ? 10004 : process.getuid?.()),
    parserGid: options.parserGid ?? (process.getuid?.() === 0 ? 1002 : process.getgid?.()),
  });
}
function asBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('bytes inválidos');
  return Buffer.from(value);
}
function classify(file) {
  const mime = file.exportedMimeType || file.mimeType || '';
  if (mime === 'application/pdf') return 'pdf';
  if (OFFICE.has(mime)) return OFFICE.get(mime);
  if (/^text\//.test(mime) || mime === 'application/json' || mime === 'application/xml' || /\.(?:txt|md|csv|tsv|log|json|xml)$/i.test(file.name || '')) return 'text';
  fail(`formato binario no permitido: ${mime || 'sin MIME'}`);
}
function assertSignature(format, bytes) {
  if (format === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('PDF sin firma válida');
  if ((format === 'docx' || format === 'xlsx') && !(bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04')) || bytes.subarray(0, 4).equals(Buffer.from('PK\x05\x06')))) fail('Office ZIP sin firma válida');
}
function safeStem(name) {
  const stem = String(name || 'original').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return stem || 'original';
}
function safeOriginalPath(dir, index, name) {
  const candidate = path.resolve(dir, `${String(index + 1).padStart(3, '0')}-${safeStem(name)}`);
  if (path.dirname(candidate) !== dir) fail('ruta de original insegura');
  return candidate;
}
function textFromOffice(format, filePath, settings) {
  let output;
  try {
    output = execFileSync(settings.pythonPath, [path.join(MODULE_DIR, 'study_document_extractor.py'), '--format', format, '--path', filePath, '--max-chars', String(settings.maxTextChars)], { uid: settings.parserUid, gid: settings.parserGid, cwd: path.dirname(filePath), env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, encoding: 'utf8', maxBuffer: settings.maxTextChars * 8 + 4096, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { fail(`${format.toUpperCase()} no se pudo extraer: ${String(error.stderr || error.message).trim()}`); }
  try { return JSON.parse(output).text; } catch { fail(`${format.toUpperCase()} devolvió una respuesta inválida`); }
}
function extractText(format, filePath, bytes, settings) {
  if (format === 'text') {
    if (bytes.includes(0)) fail('texto contiene NUL o es binario');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { fail('texto no está codificado en UTF-8'); }
  }
  if (format === 'pdf') {
    try { return execFileSync(settings.pdftotextPath, ['-enc', 'UTF-8', '-layout', filePath, '-'], { uid: settings.parserUid, gid: settings.parserGid, cwd: path.dirname(filePath), env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, encoding: 'utf8', maxBuffer: settings.maxTextChars * 8 + 4096, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { fail(`PDF no se pudo extraer con pdftotext: ${String(error.stderr || error.message).trim()}`); }
  }
  return textFromOffice(format, filePath, settings);
}

/** Persist broker originals and return bounded, extracted text for a study run. */
export function extractStudyDocuments(files, storageDir, agentUid = 10001, options = {}) {
  if (!Array.isArray(files) || files.length < 1 || files.length > DEFAULTS.maxDocuments) fail('lista de originales inválida');
  const settings = resolvedOptions(storageDir, agentUid, options);
  if (files.length > settings.maxDocuments) fail('se excedió máximo de documentos');
  const originalsDir = path.resolve(settings.storageDir, 'originals');
  if (path.dirname(originalsDir) !== settings.storageDir) fail('directorio de originales inseguro');
  fs.mkdirSync(originalsDir, { recursive: true, mode: 0o755 });
  fs.chmodSync(originalsDir, 0o755);
  const documents = [], originals = [], seenIds = new Set(); let totalTextChars = 0;
  files.forEach((file, index) => {
    if (!file || typeof file !== 'object' || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !file.name || seenIds.has(file.id)) fail('metadatos de original inválidos');
    seenIds.add(file.id);
    const bytes = asBytes(file.bytes);
    if (!bytes.length || bytes.length > settings.maxFileBytes) fail('tamaño de original no permitido');
    if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) fail('sha256 inválido');
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== file.sha256) fail('sha256 no coincide con bytes');
    const format = classify(file);
    assertSignature(format, bytes);
    const destination = safeOriginalPath(originalsDir, index, file.name);
    fs.writeFileSync(destination, bytes, { mode: 0o644, flag: 'wx' });
    fs.chmodSync(destination, 0o644);
    const parserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-parser-'));
    let text;
    try {
      fs.chmodSync(parserDir, 0o700);
      if (process.getuid?.() === 0) fs.chownSync(parserDir, settings.parserUid, settings.parserGid);
      const parserFile = path.join(parserDir, 'input.' + format);
      fs.writeFileSync(parserFile, bytes, { mode: 0o600, flag: 'wx' });
      if (process.getuid?.() === 0) fs.chownSync(parserFile, settings.parserUid, settings.parserGid);
      text = extractText(format, parserFile, bytes, settings).replace(/\u0000/g, '').trim();
    } finally {
      fs.rmSync(parserDir, { recursive: true, force: true });
    }
    if (!text) fail(`texto esencial vacío en ${file.name}`);
    if (text.length > settings.maxTextChars) fail(`texto extraído supera ${settings.maxTextChars} caracteres en ${file.name}`);
    totalTextChars += text.length;
    if (totalTextChars > settings.maxTotalTextChars) fail(`texto extraído supera ${settings.maxTotalTextChars} caracteres totales`);
    documents.push(Object.freeze({ id: file.id, name: file.name, text }));
    originals.push(Object.freeze({ id: file.id, name: file.name, file: destination, sha256: actualHash, mimeType: file.mimeType || file.exportedMimeType || null, format }));
  });
  return Object.freeze({ documents: Object.freeze(documents), originals: Object.freeze(originals) });
}

export const STUDY_DOCUMENT_LIMITS = DEFAULTS;
