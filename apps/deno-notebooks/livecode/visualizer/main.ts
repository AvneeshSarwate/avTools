// run from apps/deno-notebooks with:
// deno run --unstable-webgpu --unstable-ffi --allow-all livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug

import { createLivecodeVisualizerServer } from "./server.ts";

const args = parseArgs(Deno.args);

await createLivecodeVisualizerServer({
  host: args.host ?? "127.0.0.1",
  port: args.port ? Number(args.port) : 0,
  sessionRoot: args["session-root"],
  logLevel: args["log-level"] === "debug" ? "debug" : "info",
});

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
