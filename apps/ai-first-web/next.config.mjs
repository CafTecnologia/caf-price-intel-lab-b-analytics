import { resolve } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  outputFileTracingRoot: resolve(process.cwd(), "..", ".."),
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
