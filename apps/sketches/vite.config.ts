import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { projectFilesPlugin } from "./server/projectFiles";

import { sixSinesUiAssets } from "../livecode-tldraw/sixSinesUiAssets";

export default defineConfig({
  plugins: [react(), projectFilesPlugin(), sixSinesUiAssets({ engine: true })],
  server: {
    host: "0.0.0.0",
    port: 5192,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
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
