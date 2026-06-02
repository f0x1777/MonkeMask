import { defineConfig } from "vitest/config";

// Unit tests for the /v2 platform (crypto, auth helpers, etc.). The Playwright e2e
// suite under e2e/ runs separately via `npm run e2e`.
export default defineConfig({
  test: {
    environment: "node", // Node 22 exposes WebCrypto on globalThis.crypto
    include: ["lib/**/*.test.ts"],
  },
});
