import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@avtools/piano-roll": fileURLToPath(
        new URL(
          "../../webcomponents/piano-roll/dist/piano-roll.js",
          import.meta.url,
        ),
      ),
      "@avtools/animation-editor": fileURLToPath(
        new URL(
          "../../webcomponents/animation-editor/dist/animation-editor.js",
          import.meta.url,
        ),
      ),
      // Raw-TS workspace package: the shared wire contract, compiled by Vite
      // straight from source (the same mechanism browser-projections uses for
      // @avtools/core-timing).
      "@avtools/livecode-protocol": fileURLToPath(
        new URL("../../packages/livecode-protocol/mod.ts", import.meta.url),
      ),
    },
  },
});
