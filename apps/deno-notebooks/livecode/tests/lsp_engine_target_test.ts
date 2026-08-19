// Editor diagnostics must agree with the Run gate about which globals exist:
// under the default (deno) target, `document` is the type error and `Deno` is
// legal; once a browser-target project opens, the same open document must flip
// to the browser world — `Deno` flagged, `document` clean — without the editor
// reconnecting. Exercises the engine-target file the server publishes for LSP
// proxies plus the proxy's live watch + workspace/didChangeConfiguration path.

import { assert } from "jsr:@std/assert@1";
import { fromFileUrl, join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import {
  lspDiagnosticMessages,
  openLspSocket,
  sendLspMessage,
  sleep,
  waitFor,
  waitForMessage,
} from "./lsp_test_client.ts";

const PROBE_URI = "file:///target-probe.ts";
const PROBE_TEXT =
  "const width: number = document.body.clientWidth;\nconst cwd: string = Deno.cwd();\n";

Deno.test("lsp diagnostics follow the project engine target", async () => {
  const repoLocalSessionParent = fromFileUrl(
    new URL("../../.avtools-livecode-sessions", import.meta.url),
  );
  await Deno.mkdir(repoLocalSessionParent, { recursive: true });
  const sessionRoot = await Deno.makeTempDir({
    dir: repoLocalSessionParent,
    prefix: "tcv-lsp-target-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const { socket, messages } = openLspSocket(server.baseUrl, "lsp-target");

  try {
    await waitFor(
      () => socket.readyState === WebSocket.OPEN,
      "lsp socket open",
    );

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: null,
        rootUri: "file:///",
        workspaceFolders: [{ uri: "file:///", name: "Livecode Target" }],
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: true },
            synchronization: { dynamicRegistration: false },
          },
          workspace: { configuration: true },
        },
        initializationOptions: {},
      },
    });
    await waitForMessage(
      messages,
      (message) => message.id === 1,
      "initialize response",
      15_000,
    );
    sendLspMessage(socket, { jsonrpc: "2.0", method: "initialized", params: {} });

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: PROBE_URI,
          languageId: "typescript",
          version: 1,
          text: PROBE_TEXT,
        },
      },
    });

    // Default world (local engine mode, no project): Deno globals exist, DOM
    // globals do not.
    const denoWorld = await probeDiagnostics(messages, 1);
    assert(
      denoWorld.some((message) => message.includes("Cannot find name 'document'")),
      `deno target should reject document, got: ${JSON.stringify(denoWorld)}`,
    );
    assert(
      !denoWorld.some((message) => message.includes("Cannot find name 'Deno'")),
      `deno target should accept Deno, got: ${JSON.stringify(denoWorld)}`,
    );

    // Open a browser-target project. The already-connected LSP session must
    // flip worlds: the proxy notices the published target change, rewrites its
    // workspace config, and tells `deno lsp` its configuration changed.
    const projectRoot = join(sessionRoot, "browser-target-project");
    await Deno.mkdir(projectRoot, { recursive: true });
    await Deno.writeTextFile(
      join(projectRoot, "project.avtools-livecode.json"),
      JSON.stringify(
        {
          version: 1,
          name: "browser-target-probe",
          engineTarget: "browser",
          modules: [],
        },
        null,
        2,
      ),
    );
    const openResponse = await fetch(`${server.baseUrl}/project/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath: projectRoot }),
    });
    const openBody = await openResponse.text();
    assert(openResponse.ok, `project open failed: ${openBody}`);

    // Config propagation is async (fs watch -> config rewrite -> deno lsp
    // refresh), so re-probe with version bumps until the browser world shows.
    let browserWorld: string[] = [];
    let flipped = false;
    for (let version = 2; version <= 21; version++) {
      sendLspMessage(socket, {
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri: PROBE_URI, version },
          // Vary the text so every bump provably re-diagnoses.
          contentChanges: [{ text: `${PROBE_TEXT}// probe v${version}\n` }],
        },
      });
      browserWorld = await probeDiagnostics(messages, version);
      flipped =
        browserWorld.some((message) =>
          message.includes("Cannot find name 'Deno'")
        ) &&
        !browserWorld.some((message) =>
          message.includes("Cannot find name 'document'")
        );
      if (flipped) break;
      await sleep(1_000);
    }
    assert(
      flipped,
      `browser target should reject Deno and accept document, got: ${
        JSON.stringify(browserWorld)
      }`,
    );
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

async function probeDiagnostics(
  messages: Parameters<typeof waitForMessage>[0],
  version: number,
): Promise<string[]> {
  const published = await waitForMessage(
    messages,
    (message) => {
      if (message.method !== "textDocument/publishDiagnostics") return false;
      const params = message.params as { uri?: string; version?: number };
      return params.uri === PROBE_URI && params.version === version;
    },
    `version ${version} diagnostics`,
    30_000,
  );
  return lspDiagnosticMessages(published);
}
