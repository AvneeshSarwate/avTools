import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

/** Serve factory presets and optional engine files in development and on build. */
export function sixSinesUiAssets({ engine = false } = {}) {
  const root = fileURLToPath(
    new URL("../../packages/six-sines/ui", import.meta.url),
  );
  const engineFiles = ["six-sines-worklet.js", "six-sines.js", "six-sines.wasm"];
  let outDir = "";
  let isBuild = false;
  return {
    name: "six-sines-ui-assets",
    configResolved(config: { root: string; build: { outDir: string }; command: string }) {
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === "build";
    },
    configureServer(server: { middlewares: { use(handler: Middleware): unknown } }) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const prefix = "/six-sines-ui/";
        if (!url.pathname.startsWith(prefix)) return next();
        let relative: string;
        try {
          relative = decodeURIComponent(url.pathname.slice(prefix.length));
        } catch {
          response.statusCode = 400;
          response.end("Invalid asset path");
          return;
        }
        const assetRoot = engine && engineFiles.includes(relative) ? resolve(root, "..") : root;
        const file = resolve(assetRoot, relative);
        if (
          !file.startsWith(assetRoot + sep) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          response.statusCode = 404;
          response.end("Preset not found");
          return;
        }
        response.setHeader(
          "Content-Type",
          MIME_TYPES[extname(file)] ?? "application/xml",
        );
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      if (!isBuild) return;
      const presets = resolve(root, "presets");
      if (!existsSync(presets))
        throw new Error(
          "Missing packages/six-sines/ui/presets; copy the Six Sines webcomponent distribution first",
        );
      if (engine) {
        cpSync(resolve(root, "init.sxsnp"), resolve(outDir, "six-sines-ui/init.sxsnp"));
        for (const file of engineFiles) {
          cpSync(resolve(root, "..", file), resolve(outDir, "six-sines-ui", file));
        }
      }
      cpSync(presets, resolve(outDir, "six-sines-ui/presets"), {
        recursive: true,
      });
    },
  };
}
