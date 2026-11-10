import crypto from 'node:crypto';
import fs from 'node:fs';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';
const GOOGLE_SHORTCUT = 'application/vnd.google-apps.shortcut';
const EXPORTS = new Map([
  ['application/vnd.google-apps.document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['application/vnd.google-apps.spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);
const NATIVE_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/json',
  'application/xml',
]);
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const LIMITS = Object.freeze({ maxFileBytes: 10_000_000, maxTotalBytes: 25_000_000 });

function fail(message) { throw new Error(`Expediente Drive no autorizado: ${message}`); }
function validId(value) { return typeof value === 'string' && ID.test(value); }
function supported(file) {
  return NATIVE_TYPES.has(file.mimeType) || EXPORTS.has(file.mimeType) || /^text\//.test(file.mimeType || '') || /\.(txt|md|csv|tsv|log)$/i.test(file.name || '');
}
function bounded(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > LIMITS[name]) fail(`límite ${name} inválido`);
  return value;
}
function limits(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('límites inválidos');
  return Object.freeze({
    maxFileBytes: input.maxFileBytes === undefined ? LIMITS.maxFileBytes : bounded(input.maxFileBytes, 'maxFileBytes'),
    maxTotalBytes: input.maxTotalBytes === undefined ? LIMITS.maxTotalBytes : bounded(input.maxTotalBytes, 'maxTotalBytes'),
  });
}
function fields() { return 'id,name,mimeType,size,modifiedTime,parents,trashed,shortcutDetails(targetId,targetMimeType)'; }

export async function getExistingDriveAccessToken({ fetchImpl = globalThis.fetch } = {}) {
  const credentialFile = process.env.AI_DRIVE_OAUTH_FILE || '/data/google-drive-oauth.json';
  let credential;
  try { credential = JSON.parse(fs.readFileSync(credentialFile, 'utf8')); } catch { fail('OAuth de Drive no está configurado'); }
  for (const key of ['client_id', 'client_secret', 'refresh_token']) if (!credential[key]) fail('OAuth de Drive está incompleto');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credential.client_id, client_secret: credential.client_secret, refresh_token: credential.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail('OAuth de Drive fue rechazado');
  const token = await response.json();
  if (!token || typeof token.access_token !== 'string' || !token.access_token) fail('OAuth de Drive no devolvió token');
  return token.access_token;
}

async function readBytes(response, maximum) {
  if (!response.ok) fail(`Drive respondió HTTP ${response.status}`);
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) fail('el archivo supera el límite de bytes'); chunks.push(value); }
    } finally { reader.cancel?.().catch(() => {}); }
    return Buffer.concat(chunks);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximum) fail('el archivo supera el límite de bytes');
  return bytes;
}

export function createDriveExpedientBroker({ fetchImpl = globalThis.fetch, getAccessToken = () => getExistingDriveAccessToken({ fetchImpl }) } = {}) {
  if (typeof fetchImpl !== 'function' || typeof getAccessToken !== 'function') throw new TypeError('fetchImpl y getAccessToken son obligatorios');
  async function request(token, path, query = {}) {
    const url = new URL(`${DRIVE}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  }
  async function metadata(token, id) {
    if (!validId(id)) fail('identificador de Drive inválido');
    const response = await request(token, `files/${encodeURIComponent(id)}`, { fields: fields(), supportsAllDrives: 'true' });
    const file = JSON.parse((await readBytes(response, 100_000)).toString('utf8'));
    if (!file || file.id !== id || file.trashed || file.mimeType === GOOGLE_SHORTCUT || file.shortcutDetails) fail('recurso de Drive inválido, en papelera o shortcut');
    return file;
  }
  async function assertDescendant(token, file, rootFolderId, maxDepth) {
    let frontier = [{ id: file.id, parents: file.parents }], seen = new Set();
    for (let depth = 0; frontier.length; depth += 1) {
      const next = [];
      for (const node of frontier) {
        if (node.id === rootFolderId) return true;
        for (const parentId of node.parents || []) {
          if (!validId(parentId) || seen.has(parentId)) continue;
          seen.add(parentId);
          if (parentId === rootFolderId) return true;
          const parent = await metadata(token, parentId);
          if (parent.mimeType !== GOOGLE_FOLDER) fail('ancestro que no es carpeta');
          next.push(parent);
        }
      }
      frontier = next;
    }
    fail('el archivo dejó de pertenecer a la carpeta autorizada');
  }
  async function listChildren(token, folderId) {
    const all = [], seenPages = new Set(); let pageToken;
    do {
      if (seenPages.has(pageToken)) fail('Drive repitió un cursor de página');
      seenPages.add(pageToken);
      const response = await request(token, 'files', { q: `'${folderId}' in parents and trashed = false`, fields: `nextPageToken,files(${fields()})`, pageToken: pageToken || '', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      const page = JSON.parse((await readBytes(response, 500_000)).toString('utf8'));
      all.push(...(Array.isArray(page.files) ? page.files : [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  }
  async function scan({ rootFolderId, fileIds, limits: requestedLimits } = {}) {
    if (!validId(rootFolderId)) fail('carpeta raíz inválida');
    if (fileIds !== undefined && (!Array.isArray(fileIds) || fileIds.some(id => !validId(id)) || new Set(fileIds).size !== fileIds.length)) fail('lista de archivos inválida');
    const cap = limits(requestedLimits), selectedIds = fileIds === undefined ? null : new Set(fileIds), token = await getAccessToken();
    const root = await metadata(token, rootFolderId);
    if (root.mimeType !== GOOGLE_FOLDER) fail('la raíz autorizada no es carpeta');
    const queue = [{ id: rootFolderId, depth: 0 }], candidates = [], discovered = new Map(), known = new Set([rootFolderId]);
    while (queue.length) {
      const current = queue.shift();
      for (const raw of await listChildren(token, current.id)) {
        if (!raw || !validId(raw.id)) fail('listado contiene recurso inválido');
        const selected = selectedIds === null || selectedIds.has(raw.id);
        if (raw.trashed || raw.mimeType === GOOGLE_SHORTCUT || raw.shortcutDetails) { if (selected) fail('archivo seleccionado está en papelera o es shortcut'); continue; }
        if (raw.mimeType === GOOGLE_FOLDER) { if (!known.has(raw.id)) { known.add(raw.id); queue.push({ id: raw.id, depth: current.depth + 1 }); } continue; }
        if (!selected) continue;
        discovered.set(raw.id, raw);
        if (!supported(raw)) fail('archivo seleccionado con tipo no permitido');
        if (!Number.isSafeInteger(Number(raw.size || 0)) || Number(raw.size || 0) < 0 || Number(raw.size || 0) > cap.maxFileBytes) fail('tamaño de archivo no permitido');
        candidates.push(raw);
      }
    }
    const byId = new Map(candidates.map(file => [file.id, file]));
    const selected = fileIds === undefined ? candidates : fileIds.map(id => byId.get(id) || (discovered.has(id) ? fail('archivo seleccionado con tipo no permitido') : fail('archivo declarado fuera del expediente autorizado')));
    return { token, cap, files: selected };
  }
  function publicMetadata(file) {
    return Object.freeze({ id: file.id, name: file.name || 'Archivo de Drive', mimeType: file.mimeType, modifiedTime: file.modifiedTime || null, sourceSize: Number(file.size || 0) });
  }
  async function list(scope) {
    const { files } = await scan(scope);
    return Object.freeze(files.map(publicMetadata));
  }
  async function readExpedient(scope) {
    const { token, cap, files } = await scan(scope); let total = 0;
    const results = [];
    for (const listed of files) {
      const file = await metadata(token, listed.id);
      await assertDescendant(token, file, scope.rootFolderId, cap.maxDepth);
      if (file.mimeType === GOOGLE_FOLDER || !supported(file)) fail('tipo de archivo no permitido');
      const expectedSize = Number(file.size || 0);
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > cap.maxFileBytes) fail('tamaño de archivo no permitido');
      let response, exportMimeType = null;
      if (EXPORTS.has(file.mimeType)) { exportMimeType = EXPORTS.get(file.mimeType); response = await request(token, `files/${encodeURIComponent(file.id)}/export`, { mimeType: exportMimeType, supportsAllDrives: 'true' }); }
      else response = await request(token, `files/${encodeURIComponent(file.id)}`, { alt: 'media', supportsAllDrives: 'true' });
      const bytes = await readBytes(response, Math.min(cap.maxFileBytes, cap.maxTotalBytes - total)); total += bytes.length;
      if (total > cap.maxTotalBytes) fail('se excedió total de bytes autorizado');
      results.push(Object.freeze({ id: file.id, name: file.name || 'Archivo de Drive', mimeType: file.mimeType, modifiedTime: file.modifiedTime || null, size: bytes.length, sourceSize: expectedSize, exportedMimeType: exportMimeType, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes }));
    }
    return Object.freeze(results);
  }
  async function assertAllowedRoot(rootFolderId, allowedRoots) {
    if (!validId(rootFolderId) || !Array.isArray(allowedRoots) || !allowedRoots.length || allowedRoots.some(id => !validId(id))) fail('raíces CAF permitidas no configuradas');
    const token = await getAccessToken();
    const root = await metadata(token, rootFolderId);
    if (root.mimeType !== GOOGLE_FOLDER) fail('la raíz solicitada no es carpeta');
    for (const allowed of allowedRoots) {
      try { await assertDescendant(token, root, allowed, 12); return true; }
      catch { /* Try another independently configured CAF root. */ }
    }
    fail('la carpeta no pertenece a una raíz CAF permitida');
  }
  return Object.freeze({ list, readExpedient, assertAllowedRoot });
}
