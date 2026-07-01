// run from apps/deno-notebooks with:
// deno run --unstable-webgpu --unstable-ffi --allow-all livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug

import { createLivecodeVisualizerServer } from "./server.ts";

const args = parseArgs(Deno.args);

const server = await createLivecodeVisualizerServer({
  host: args.host ?? "127.0.0.1",
  port: args.port ? Number(args.port) : 0,
  sessionRoot: args["session-root"],
  logLevel: args["log-level"] === "debug" ? "debug" : "info",
});

let closing = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, async () => {
    if (closing) return;
    closing = true;
    await server.close();
    Deno.exit(0);
  });
}

await new Promise(() => {
  // Keep the server process alive until it receives a signal.
});

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
