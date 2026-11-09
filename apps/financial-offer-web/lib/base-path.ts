export function normalizeBasePath(value?: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function appPath(path: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBasePath(basePath)}${normalizedPath}`;
}
