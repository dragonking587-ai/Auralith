import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve, join } from "node:path";
import { rmSync, readdirSync, renameSync, existsSync, readFileSync, writeFileSync } from "node:fs";

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

/** Vite mirrors input path into outDir; move src/desktop/* → dist-desktop/. */
function flattenDesktopOut() {
  return {
    name: "flatten-desktop-out",
    closeBundle() {
      const nested = resolve("dist-desktop", "src", "desktop");
      const out = resolve("dist-desktop");
      if (!existsSync(nested)) return;
      for (const name of readdirSync(nested)) {
        const from = join(nested, name);
        const to = join(out, name);
        if (existsSync(to)) rmSync(to, { recursive: true, force: true });
        renameSync(from, to);
      }
      rmSync(resolve("dist-desktop", "src"), { recursive: true, force: true });
      const indexPath = join(out, "index.html");
      if (existsSync(indexPath)) {
        let html = readFileSync(indexPath, "utf8");
        html = html.replaceAll("../../assets/", "./assets/");
        html = html.replaceAll("../assets/", "./assets/");
        writeFileSync(indexPath, html);
      }
    },
  };
}

/**
 * Use repo root as Vite root so @tailwindcss/vite scans src/components.
 * (root: "src/desktop" previously produced ~6KB CSS with only DesktopApp utilities.)
 */
export default defineConfig({
  base: "./",
  plugins: [viteReact(), tailwindcss(), flattenDesktopOut(), pruneHostedChrome()],
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
    rollupOptions: {
      input: resolve("src/desktop/index.html"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // serve desktop index for dev
    open: false,
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
});
