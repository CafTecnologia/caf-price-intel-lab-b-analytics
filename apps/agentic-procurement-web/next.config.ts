import type { NextConfig } from "next";

const configuredBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: process.cwd(),
  experimental: { cpus: 1 },
  ...(basePath ? { basePath } : {})
};

export default nextConfig;
