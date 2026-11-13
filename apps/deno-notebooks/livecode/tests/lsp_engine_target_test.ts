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
    await initializeLsp(socket, messages);

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
      denoWorld.some((message) =>
        message.includes("Cannot find name 'document'")
      ),
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
      flipped = browserWorld.some((message) =>
        message.includes("Cannot find name 'Deno'")
      ) &&
        !browserWorld.some((message) =>
          message.includes("Cannot find name 'document'")
        );
      if (flipped) {
        break;
      }
      await sleep(1_000);
    }
    assert(
      flipped,
      `browser target should reject Deno and accept document, got: ${
        JSON.stringify(browserWorld)
      }`,
    );

    // A fresh LSP workspace must resolve p5 through the shared Deno cache.
    // The project source uses both npm and repository-local dependencies.
    const p5Uri = new URL(
      "../../../livecode-tldraw/example-projects/timing-composition/modules/phrases.orig.ts",
      import.meta.url,
    ).href;
    const p5Source = await Deno.readTextFile(fromFileUrl(p5Uri));
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: p5Uri,
          languageId: "typescript",
          version: 1,
          text: p5Source,
        },
      },
    });
    await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as {
          uri?: string;
          diagnostics: Array<{ severity?: number }>;
        };
        return params.uri === p5Uri &&
          !params.diagnostics.some((diagnostic) => diagnostic.severity === 1);
      },
      "timing-composition p5 dependencies resolve automatically",
      60_000,
    );

    // Check p5's actual types, not just the absence of a missing-package error.
    // A second document must reuse the dependency installed for the first.
    const typedP5Uri = "file:///typed-p5-probe.ts";
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: typedP5Uri,
          languageId: "typescript",
          version: 1,
          text: 'import p5 from "p5";\n' +
            'new p5((p) => { p.createCanvas("wrong", 100); });\n',
        },
      },
    });
    const p5Diagnostics = await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string };
        return params.uri === typedP5Uri &&
          lspDiagnosticMessages(message).some((text) =>
            text.includes("string") && text.includes("number")
          );
      },
      "p5 argument types are checked",
      15_000,
    );
    const p5Errors = lspDiagnosticMessages(p5Diagnostics);
    assert(
      !p5Errors.some((text) =>
        text.includes("not installed") ||
        text.includes("implicitly has an 'any'")
      ),
      `p5 must resolve with typed callbacks, got: ${JSON.stringify(p5Errors)}`,
    );
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("browser LSP resolves npm imports across a whole project on startup and edit", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-lsp-npm-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    engineMode: "remote",
  });
  const { socket, messages } = openLspSocket(server.baseUrl, "lsp-npm");
  const documents = await Promise.all(
    ["tempo", "sequence", "barrier", "branches", "cancel"].map(async (name) => {
      const url = new URL(
        `../../../livecode-tldraw/example-projects/timing-examples/modules/${name}.orig.ts`,
        import.meta.url,
      );
      return {
        uri: `file:///npm-project/${name}.ts`,
        text: await Deno.readTextFile(url),
      };
    }),
  );

  try {
    await initializeLsp(socket, messages);
    // Project restore mounts all editors together, and CodeMirror may reopen
    // documents as extensions settle. The single-document test misses Deno's
    // stale npm-resolution behavior with temporary node_modules ("auto").
    for (const version of [1, 2]) {
      for (const doc of documents) {
        sendLspMessage(socket, {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: { ...doc, languageId: "typescript", version },
          },
        });
      }
    }
    await waitForCleanProject(2);
    for (const doc of documents) {
      sendLspMessage(socket, {
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri: doc.uri, version: 3 },
          contentChanges: [{ text: `${doc.text}\n// edited\n` }],
        },
      });
    }
    await waitForCleanProject(3);
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }

  async function waitForCleanProject(version: number) {
    await waitFor(
      () =>
        documents.every((doc) => {
          const latest = messages.findLast((message) => {
            if (
              message.method !== "textDocument/publishDiagnostics"
            ) return false;
            const params = message.params as { uri?: string };
            return params.uri === doc.uri;
          });
          if (!latest) return false;
          const params = latest.params as {
            version?: number;
            diagnostics: Array<{ severity?: number }>;
          };
          return params.version === version &&
            !params.diagnostics.some((diagnostic) => diagnostic.severity === 1);
        }),
      `all project npm imports resolve at version ${version}`,
      30_000,
    );
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

async function initializeLsp(
  socket: WebSocket,
  messages: Parameters<typeof waitForMessage>[0],
) {
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
  sendLspMessage(socket, {
    jsonrpc: "2.0",
    method: "initialized",
    params: {},
  });
}
