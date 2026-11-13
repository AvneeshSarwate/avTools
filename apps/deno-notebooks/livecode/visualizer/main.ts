// run from apps/deno-notebooks with:
// deno run --unstable-webgpu --unstable-ffi --allow-all livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug

import {
  createLivecodeVisualizerServer,
  type LivecodeVisualizerServer,
} from "./server.ts";

const args = parseArgs(Deno.args);

const host = args.host ?? "127.0.0.1";
// --engine remote: no engine in this process; a browser tab opens /engine/
// and attaches over /engine/uplink.
let engineMode: "local" | "remote" = args.engine === "remote"
  ? "remote"
  : "local";
// After the first bind, the actual port is reused so an engine-mode restart
// keeps the same base URL.
let port = args.port ? Number(args.port) : 0;

let server: LivecodeVisualizerServer | null = null;
let closing = false;
const FORCE_EXIT_AFTER_MS = 3_000;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => {
    // Second Ctrl-C: don't wait on a graceful close that may be stuck.
    if (closing) Deno.exit(130);
    closing = true;
    // Graceful close can wait indefinitely on open connections (a UI tab's
    // reconnecting socket, an in-flight shadow `deno check`), so bound it:
    // Ctrl-C must always kill the process.
    setTimeout(() => {
      console.error(
        `[livecode] close did not finish within ${FORCE_EXIT_AFTER_MS}ms; forcing exit`,
      );
      Deno.exit(130);
    }, FORCE_EXIT_AFTER_MS);
    void (server?.close() ?? Promise.resolve())
      .catch((error) => console.error("[livecode] close failed", error))
      .finally(() => Deno.exit(0));
  });
}

// The server cannot change engine mode in place (the execution plane and the
// generated-code import URLs are fixed at creation), so /server/engine-mode
// resolves this loop's promise and the process re-creates the server in the
// requested mode on the same host/port.
while (!closing) {
  let resolveNextMode!: (mode: "local" | "remote") => void;
  const nextMode = new Promise<"local" | "remote">((resolve) => {
    resolveNextMode = resolve;
  });
  server = await createLivecodeVisualizerServer({
    host,
    port,
    sessionRoot: args["session-root"],
    logLevel: args["log-level"] === "debug" ? "debug" : "info",
    engineMode,
    // --ui-dist <path>: serve a built tldraw client at this origin.
    uiDist: args["ui-dist"],
    // --projects-root <dir[,dir...]>: extra directories for /projects/list.
    projectsRoots: args["projects-root"]
      ?.split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    prewarmBrowserHost: args["prewarm-browser-host"] === "true",
    onEngineModeChangeRequest: (mode) => resolveNextMode(mode),
  });
  port = server.port;
  engineMode = await nextMode;
  if (closing) break;
  await server.close();
}

function parseArgs(args: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
