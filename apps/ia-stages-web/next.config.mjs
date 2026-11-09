import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" }
];

const nextConfig = {
  experimental: { cpus: 1 },
  basePath: process.env.NEXT_BASE_PATH?.trim() || "",
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx", "better-sqlite3"],
  turbopack: {
    root,
  },
  async headers() {
    return [
      { source: "/", headers: noStoreHeaders },
      { source: "/finanzas", headers: noStoreHeaders }
    ];
  }
};

export default nextConfig;
