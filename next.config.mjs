import { resolve } from "node:path";

const frameAncestors =
  process.env.FINANCIAL_FRAME_ANCESTORS?.trim() ||
  "'self' http://127.0.0.1:18031 http://localhost:18031 http://127.0.0.1:18032 http://localhost:18032 http://127.0.0.1:3000 http://localhost:3000";

const rawBasePath = process.env.NEXT_BASE_PATH?.trim() || "";
const basePath = rawBasePath && rawBasePath !== "/"
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    externalDir: true,
    ...(process.env.CAF_BUILD_CPUS === "1" ? { cpus: 1 } : {}),
  },
  outputFileTracingRoot: resolve(process.cwd(), "..", ".."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
        ],
      },
    ];
  },
};

export default nextConfig;
