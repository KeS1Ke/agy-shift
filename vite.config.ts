import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fs.realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  root: projectRoot,
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "scheduler"],
    preserveSymlinks: false,
  },
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "react-vendor";
            }
            if (id.includes("/@tauri-apps/")) {
              return "tauri-vendor";
            }
            if (id.includes("/lucide-react/")) {
              return "ui-vendor";
            }
            return "vendor";
          }
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
}));
