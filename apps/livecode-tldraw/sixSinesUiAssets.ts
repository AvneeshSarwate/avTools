import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Serve the packaged factory presets in development and copy them on build. */
export function sixSinesUiAssets(): Plugin {
  const root = fileURLToPath(
    new URL("../../packages/six-sines/ui", import.meta.url),
  );
  let outDir = "";
  let isBuild = false;
  return {
    name: "six-sines-ui-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/six-sines-ui/")) return next();
        let file: string;
        try {
          file = resolve(
            root,
            decodeURIComponent(url.pathname.slice("/six-sines-ui/".length)),
          );
        } catch {
          response.statusCode = 400;
          response.end("Invalid asset path");
          return;
        }
        if (
          !file.startsWith(root + sep) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          response.statusCode = 404;
          response.end("Preset not found");
          return;
        }
        response.setHeader(
          "Content-Type",
          file.endsWith(".json") ? "application/json" : "application/xml",
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
      cpSync(presets, resolve(outDir, "six-sines-ui/presets"), {
        recursive: true,
      });
    },
  };
}
