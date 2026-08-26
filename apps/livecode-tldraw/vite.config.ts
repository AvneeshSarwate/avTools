import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        projects: fileURLToPath(new URL("./projects.html", import.meta.url)),
      },
    },
  },
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
