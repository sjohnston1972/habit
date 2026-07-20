import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { PRODUCT } from "./src/shared/branding";

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
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.svg", "icons/icon-512.svg"],
      manifest: {
        name: PRODUCT,
        short_name: PRODUCT,
        description: "Build tiny habits that stick.",
        theme_color: "#2F6F5E",
        background_color: "#FFFDF7",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icons/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icons/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
});
