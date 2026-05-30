import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type PluginOption } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function buildContentScriptPlugin(): PluginOption {
  return {
    name: "build-content-script-iife",
    apply: "build",
    closeBundle: async () => {
      await build({
        configFile: false,
        plugins: [],
        build: {
          emptyOutDir: false,
          outDir: resolve(rootDir, "dist/content"),
          lib: {
            entry: resolve(rootDir, "src/content/index.ts"),
            name: "BrowserAiAssistantContent",
            formats: ["iife"],
            fileName: () => "index.js",
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), buildContentScriptPlugin()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidePanel: resolve(rootDir, "index.html"),
        sandbox: resolve(rootDir, "sandbox.html"),
        "background/index": resolve(rootDir, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
