import path from "node:path";
import { loadEnv } from "vite";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  // Miniflare does not inherit the process environment, and vitest-pool-workers
  // does not read .env — secrets must be passed through explicitly as bindings.
  // The "" prefix loads unprefixed vars too (Vite defaults to VITE_ only).
  // Absent key => empty string, so the key-independent tests still run.
  const env = loadEnv("test", __dirname, "");

  return {
    resolve: {
      alias: {
        "@shared": path.join(__dirname, "src", "shared"),
      },
    },
    test: {
      name: "worker",
      // test/app/** runs under jsdom in the other workspace project — workerd
      // has no DOM and no IndexedDB.
      exclude: ["test/app/**", "**/node_modules/**"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
            },
          },
        },
      },
    },
  };
});
