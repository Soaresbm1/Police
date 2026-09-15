import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Phase U5.1 — see test/stubs/server-only.ts's own doc comment: tests
      // run server-side code only, so this mirrors Next.js's own no-op
      // server-bundle treatment of the real "server-only" package.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
