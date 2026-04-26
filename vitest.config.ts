import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const emptyModulePath = fileURLToPath(new URL("./test-support/empty-module.ts", import.meta.url));
const appRoot = fileURLToPath(new URL("./apps/ai-first-web/", import.meta.url));
const contractsRoot = fileURLToPath(new URL("./packages/ai-first-contracts/src/", import.meta.url));
const coreRoot = fileURLToPath(new URL("./packages/ai-first-core/src/", import.meta.url));
const odooRoot = fileURLToPath(new URL("./integrations/odoo/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "server-only": emptyModulePath,
      "@web": appRoot,
      "@ai-first-contracts": contractsRoot,
      "@ai-first-core": coreRoot,
      "@odoo": odooRoot,
    },
  },
});
