import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite-plugin-pwa (manifest + service worker + icons) is wired in during
// PLAN.md step 12 (Minimal UI shell), once real icon assets exist.
export default defineConfig({
  root: "src/app",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": new URL("./src/shared", import.meta.url).pathname,
    },
  },
  plugins: [react()],
});
