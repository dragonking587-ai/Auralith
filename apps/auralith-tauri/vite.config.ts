import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const configDir = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(configDir, "package.json"), "utf8"));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __AURALITH_VERSION__: JSON.stringify(packageJson.version) },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        host: resolve(__dirname, "host.html")
      }
    }
  }
});
