// Vite dev-server middleware: GET/PUT /api/projects/<name> reads and writes
// projects/<name>/project.json on disk. Disk persistence, not localStorage.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";

const projectsDir = fileURLToPath(new URL("../projects/", import.meta.url));
const NAME = /^[a-zA-Z0-9_-]+$/;

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function projectFilesPlugin(): Plugin {
  return {
    name: "music-runners-project-files",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://local");
        if (!url.pathname.startsWith("/api/projects")) return next();
        res.setHeader("content-type", "application/json");
        try {
          const rest = url.pathname.slice("/api/projects".length).replace(/^\//, "");
          if (rest === "") {
            await mkdir(projectsDir, { recursive: true });
            const entries = await readdir(projectsDir, { withFileTypes: true });
            const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
            res.end(JSON.stringify({ projects: names }));
            return;
          }
          if (!NAME.test(rest)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "bad project name" }));
            return;
          }
          const file = path.join(projectsDir, rest, "project.json");
          if (req.method === "GET") {
            try {
              res.end(await readFile(file, "utf8"));
            } catch {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "not found" }));
            }
            return;
          }
          if (req.method === "PUT") {
            const body = await readBody(req);
            JSON.parse(body); // validate before touching disk
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, body, "utf8");
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "method not allowed" }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}
