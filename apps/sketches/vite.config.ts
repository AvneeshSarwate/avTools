import react from "@vitejs/plugin-react";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { projectFilesPlugin } from "./server/projectFiles";

import { sixSinesUiAssets } from "../livecode-tldraw/sixSinesUiAssets";

// Pages: the landing page plus every folder with an index.html (one per sketch).
const root = fileURLToPath(new URL(".", import.meta.url));
const pages: Record<string, string> = { index: resolve(root, "index.html") };
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && !["node_modules", "src", "server", "projects", "dist"].includes(entry.name) && existsSync(resolve(root, entry.name, "index.html"))) {
    pages[entry.name] = resolve(root, entry.name, "index.html");
  }
}

export default defineConfig({
  build: { rollupOptions: { input: pages } },
  plugins: [react(), projectFilesPlugin(), sixSinesUiAssets({ engine: true })],
  server: {
    host: "0.0.0.0",
    port: 5192,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    // Autosave rewrites projects/*/project.json on every edit. Those files are
    // also bundled (store.ts's import.meta.glob, for static hosts), so a
    // watched save would hot-swap every module importing the store: a remount
    // of the whole UI per edit. In dev the project API reads them from disk.
    watch: { ignored: ["**/projects/**"] },
  },
  resolve: {
    alias: {
      // Raw-TS workspace packages, compiled by Vite straight from source.
      "@avtools/core-timing": fileURLToPath(
        new URL("../../packages/core-timing/mod.ts", import.meta.url),
      ),
      "@avtools/midi/browser": fileURLToPath(
        new URL("../../packages/midi/browser.ts", import.meta.url),
      ),
    },
    // Workspace packages imported as source resolve their deps from here.
    dedupe: ["react", "react-dom", "konva", "valtio", "seedrandom", "@midival/core"],
  },
});
