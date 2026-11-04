import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { projectFilesPlugin } from "./server/projectFiles";

export default defineConfig({
  plugins: [react(), projectFilesPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5190,
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
      "@avtools/music-types": fileURLToPath(
        new URL("../../packages/music-types/mod.ts", import.meta.url),
      ),
    },
  },
});
