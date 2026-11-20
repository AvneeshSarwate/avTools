import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

import { sixSinesUiAssets } from "../livecode-tldraw/sixSinesUiAssets";

export default defineConfig({
  plugins: [react(), sixSinesUiAssets({ engine: true })],
  server: {
    host: "0.0.0.0",
    port: 5191,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  resolve: {
    // The piano roll is imported as source from apps/music-runners, which has
    // no node_modules of its own here: resolve its packages from this app.
    dedupe: ["react", "react-dom", "konva", "valtio"],
  },
});
