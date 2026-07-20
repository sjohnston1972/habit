import type { Bindings } from "../src/worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
