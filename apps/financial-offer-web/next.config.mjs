import { resolve } from "node:path";

const frameAncestors =
  process.env.FINANCIAL_FRAME_ANCESTORS?.trim() ||
  "'self' http://127.0.0.1:18031 http://localhost:18031 http://127.0.0.1:18032 http://localhost:18032 http://127.0.0.1:3000 http://localhost:3000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
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
