import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

function pruneHostedChrome() {
  return {
    name: "prune-hosted-chrome",
    closeBundle() {
      for (const rel of ["__grok", "og.jpg", "x-banner.jpg"]) {
        rmSync(resolve("dist-desktop", rel), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  root: resolve("src/desktop"),
  base: "/",
  plugins: [viteReact(), tailwindcss(), pruneHostedChrome()],
  resolve: {
    alias: {
      "@": resolve("src"),
    },
  },
  publicDir: resolve("public"),
  build: {
    outDir: resolve("dist-desktop"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
});
