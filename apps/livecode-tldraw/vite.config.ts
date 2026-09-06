import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const livecodeServerTarget = process.env.LIVECODE_SERVER_TARGET ??
  "http://localhost:7777";

const livecodeRoutePrefixes = [
  "/health",
  "/server",
  "/projects",
  "/client",
  "/lsp",
  "/sync",
  "/engine",
  "/engine-assets",
  "/entities",
  "/piano-roll",
  "/params",
  "/animation-timeline",
  "/signals",
  "/runtime",
  "/project",
];

function routeMatcher(prefix: string): string {
  // Vite matches proxy contexts against the full request URL, including its
  // query string. `/lsp?session=...` therefore needs `?` to count as a route
  // boundary, while `/projects.html` must still not match the `/projects` API.
  return `^${prefix}(?:[/?]|$)`;
}

function projectsLandingPage(): Plugin {
  return {
    name: "livecode-projects-landing-page",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://livecode.local");
        if (url.pathname !== "/") {
          next();
          return;
        }
        response.statusCode = 302;
        response.setHeader(
          "location",
          `/projects.html${url.search}`,
        );
        response.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [projectsLandingPage(), react()],
  server: {
    host: "0.0.0.0",
    strictPort: true,
    // Vite's supported wildcard is a leading-dot domain suffix. This allows
    // any Worker name in this account without trusting the shared workers.dev
    // domain as a whole.
    allowedHosts: [".gritty-questions.workers.dev"],
    proxy: Object.fromEntries(
      livecodeRoutePrefixes.map((prefix) => [
        routeMatcher(prefix),
        {
          target: livecodeServerTarget,
          changeOrigin: true,
          ws: true,
        },
      ]),
    ),
  },
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
      "@avtools/handwriting-canvas": fileURLToPath(
        new URL(
          "../../webcomponents/handwriting-canvas/dist/handwriting-canvas.js",
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
