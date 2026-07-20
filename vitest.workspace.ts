import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineWorkspace } from "vitest/config";

/**
 * Two test environments, because the code under test runs in two places.
 *
 * Worker code (D1, Hono routes, shared pure logic) runs in workerd via
 * vitest-pool-workers — the same runtime as production, so a test that passes
 * there means something. Frontend code needs a DOM and IndexedDB, neither of
 * which workerd has, so it runs under jsdom instead.
 *
 * The split is by directory: `test/app/**` is the browser side, everything
 * else is the Worker side.
 */
export default defineWorkspace([
  "./vitest.config.ts",
  {
    plugins: [react()],
    resolve: {
      alias: { "@shared": path.join(__dirname, "src", "shared") },
    },
    test: {
      name: "app",
      root: __dirname,
      include: ["test/app/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      globals: true,
      setupFiles: ["./test/app/setup.ts"],
    },
  },
]);
