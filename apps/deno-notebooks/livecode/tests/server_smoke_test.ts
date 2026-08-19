import { assertEquals } from "jsr:@std/assert@1";
import { dirname, fromFileUrl } from "jsr:@std/path@1";

Deno.test("server CLI prints serverReady and responds to health", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-cli-smoke-" });
  const serverMain = fromFileUrl(
    new URL("../visualizer/main.ts", import.meta.url),
  );
  const notebookRoot = dirname(dirname(dirname(serverMain)));
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      serverMain,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--session-root",
      sessionRoot,
      "--log-level",
      "debug",
    ],
    cwd: notebookRoot,
    stdout: "piped",
    stderr: "piped",
  });

  const child = command.spawn();
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const stderrTask = collectLines(child.stderr, stderrLines);

  try {
    const ready = await waitForServerReady(
      child.stdout,
      stdoutLines,
      stderrLines,
    );
    const health = await fetchJson(`${ready.baseUrl}/health`);
    assertEquals(health.ok, true);
    assertEquals(health.sessionRoot, sessionRoot);
  } finally {
    child.kill("SIGTERM");
    await child.status.catch(() => undefined);
    await stderrTask.catch(() => undefined);
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

interface ServerReadyLine {
  type: "serverReady";
  baseUrl: string;
  sessionRoot: string;
}

// `deno test` type-checks every test root as one program, so when a dom-lib
// test (project_p5gpu_e2e_test.ts) lands in the batch, dom's TextDecoderStream
// (BufferSource writable) clashes with deno's pipeThrough signature. The cast
// pins the shape both worlds agree the value actually has.
function textDecoderPipe(): {
  readable: ReadableStream<string>;
  writable: WritableStream<Uint8Array>;
} {
  return new TextDecoderStream() as unknown as {
    readable: ReadableStream<string>;
    writable: WritableStream<Uint8Array>;
  };
}

async function waitForServerReady(
  stream: ReadableStream<Uint8Array>,
  lines: string[],
  stderrLines: string[],
): Promise<ServerReadyLine> {
  const deadline = Date.now() + 20_000;
  const reader = stream.pipeThrough(textDecoderPipe()).getReader();
  let buffer = "";
  let pendingRead = reader.read();
  while (Date.now() < deadline) {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 100)
    );
    const result = await Promise.race([pendingRead, timeout]);
    if (result === null) continue;
    pendingRead = reader.read();
    if (result.done) break;
    buffer += result.value;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        lines.push(line);
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "serverReady") return parsed;
        } catch {
          // Deno.serve also prints human-oriented "Listening on..." lines.
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
  throw new Error(
    `Timed out waiting for serverReady.\nstdout:\n${
      lines.join("\n")
    }\nstderr:\n${stderrLines.join("\n")}`,
  );
}

async function collectLines(
  stream: ReadableStream<Uint8Array>,
  lines: string[],
) {
  const reader = stream.pipeThrough(textDecoderPipe()).getReader();
  let buffer = "";
  while (true) {
    const result = await reader.read();
    if (result.done) return;
    buffer += result.value;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      if (line) lines.push(line);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}
