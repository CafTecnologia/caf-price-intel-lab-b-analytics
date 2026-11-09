const DEFAULT_ODOO_ORIGINS = [
  "http://127.0.0.1:18069",
  "http://localhost:18069"
];

export type OdooConnection = {
  baseUrl: string;
  db: string;
  token: string;
};

export function normalizeOdooConnection(input: {
  baseUrl?: unknown;
  db?: unknown;
  token?: unknown;
}): OdooConnection {
  const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  const db = String(input.db || "").trim();
  const token = String(input.token || "").trim();
  if (!baseUrl || !db || !token) throw new Error("Falta el contexto de conexión con Odoo.");
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(db)) throw new Error("La base Odoo no es válida.");
  if (!/^[a-zA-Z0-9_-]{16,160}$/.test(token)) throw new Error("El token Odoo no es válido.");

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("La URL de Odoo no es válida.");
  }
  const allowed = (process.env.ODOO_ALLOWED_ORIGINS || DEFAULT_ODOO_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (!["http:", "https:"].includes(parsed.protocol) || !allowed.includes(parsed.origin)) {
    throw new Error("El servidor Odoo no está autorizado para esta app.");
  }
  return { baseUrl: parsed.origin, db, token };
}

export async function fetchOdoo(
  connection: OdooConnection,
  pathname: string,
  init: RequestInit = {}
) {
  const separator = pathname.includes("?") ? "&" : "?";
  return fetch(`${connection.baseUrl}${pathname}${separator}db=${encodeURIComponent(connection.db)}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "X-Odoo-Database": connection.db
    },
    cache: "no-store"
  });
}
