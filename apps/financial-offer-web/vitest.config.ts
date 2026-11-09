import { resolve } from "node:path";
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  cacheDir: resolve(process.cwd(), ".cache/vitest"),
  resolve: { alias: { "@offer": resolve(process.cwd()), "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } },
  test: { exclude: [...configDefaults.exclude, "**/.next*/**"] },
});
