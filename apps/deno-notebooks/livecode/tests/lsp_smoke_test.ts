import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "jsr:@std/path@1";
import { DEFAULT_LIVECODE_SOURCE } from "../../../browser-projections/src/sketches/livecodeVisualizer/defaultSource.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import {
  lspCompletionItems,
  lspDiagnosticMessages,
  lspHoverText,
  openLspSocket,
  sendLspMessage,
  sleep,
  waitFor,
  waitForMessage,
} from "./lsp_test_client.ts";

Deno.test("deno lsp bridge initializes and publishes diagnostics", async () => {
  const repoLocalSessionParent = fromFileUrl(
    new URL("../../.avtools-livecode-sessions", import.meta.url),
  );
  await Deno.mkdir(repoLocalSessionParent, { recursive: true });
  const sessionRoot = await Deno.makeTempDir({
    dir: repoLocalSessionParent,
    prefix: "tcv-lsp-smoke-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const { socket, messages } = openLspSocket(server.baseUrl, "lsp-smoke");

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
        workspaceFolders: [{ uri: "file:///", name: "Livecode Smoke" }],
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: true },
            synchronization: { dynamicRegistration: false },
          },
          workspace: {
            configuration: true,
          },
        },
        initializationOptions: {},
      },
    });

    const initializeResponse = await waitForMessage(
      messages,
      (message) => message.id === 1,
      "initialize response",
      15_000,
    );
    assert("result" in initializeResponse);

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    });

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: "file:///main.ts",
          languageId: "typescript",
          version: 1,
          text: "const value: string = 1;\n",
        },
      },
    });

    const diagnostics = await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as {
          uri?: string;
          diagnostics?: Array<{ message?: string }>;
        };
        return params.uri === "file:///main.ts" &&
          Boolean(params.diagnostics?.length);
      },
      "publishDiagnostics",
      15_000,
    );

    const params = diagnostics.params as {
      version?: number;
      diagnostics: Array<{ message: string }>;
    };
    assertEquals(params.version, 1);
    assert(
      params.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("number") &&
        diagnostic.message.includes("string")
      ),
    );

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: {
          uri: "file:///main.ts",
          version: 2,
        },
        contentChanges: [{
          text:
            'const objectForCompletion = { alphaValue: 1, betaValue: "two" };\nobjectForCompletion.alphaValue;\n',
        }],
      },
    });

    await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; version?: number };
        return params.uri === "file:///main.ts" && params.version === 2;
      },
      "version 2 diagnostics",
      15_000,
    );

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/completion",
      params: {
        textDocument: { uri: "file:///main.ts" },
        position: { line: 1, character: 20 },
        context: {
          triggerKind: 2,
          triggerCharacter: ".",
        },
      },
    });

    const completion = await waitForMessage(
      messages,
      (message) => message.id === 2,
      "completion response",
      15_000,
    );
    const completionParams = completion.result as
      | {
        items?: Array<{ label: string }>;
      }
      | Array<{ label: string }>
      | null;
    const completionItems = Array.isArray(completionParams)
      ? completionParams
      : completionParams?.items ?? [];
    assert(
      completionItems.some((item) => item.label === "alphaValue"),
      "completion response should include alphaValue",
    );
    assert(
      completionItems.some((item) => item.label === "betaValue"),
      "completion response should include betaValue",
    );

    const timeContextStartIndex = messages.length;
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: {
          uri: "file:///main.ts",
          version: 3,
        },
        contentChanges: [{
          text:
            'import type { TimeContext } from "@avtools/core-timing";\n\nexport default async function(ctx: TimeContext) {\n  await ctx.waitSec(1);\n}\n',
        }],
      },
    });

    await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; version?: number };
        return params.uri === "file:///main.ts" && params.version === 3;
      },
      "version 3 TimeContext diagnostics",
      15_000,
    );
    await sleep(250);

    const dependencyDiagnostics = messages.slice(timeContextStartIndex)
      .flatMap((message) => lspDiagnosticMessages(message))
      .filter((message) =>
        message.includes("not a dependency") ||
        message.includes("Cannot find module") ||
        message.includes("@avtools/core-timing") ||
        message.includes("midi-helpers") ||
        message.includes("piano-roll-helpers") ||
        message.includes("@avtools/music-types") ||
        message.includes("seedrandom")
      );
    assertEquals(dependencyDiagnostics, []);

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      id: 4,
      method: "textDocument/hover",
      params: {
        textDocument: { uri: "file:///main.ts" },
        position: { line: 0, character: 40 },
      },
    });

    const timeContextHover = await waitForMessage(
      messages,
      (message) => message.id === 4,
      "TimeContext import hover response",
      15_000,
    );
    const timeContextHoverText = lspHoverText(timeContextHover.result);
    assert(
      !timeContextHoverText.includes("[errored]") &&
        !timeContextHoverText.includes("not a dependency"),
      `TimeContext import hover should resolve cleanly, got: ${timeContextHoverText}`,
    );
    assert(
      timeContextHoverText.includes("/packages/core-timing/mod.ts"),
      `TimeContext import hover should point at core-timing/mod.ts, got: ${timeContextHoverText}`,
    );

    sendLspMessage(socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/completion",
      params: {
        textDocument: { uri: "file:///main.ts" },
        position: { line: 3, character: 12 },
        context: {
          triggerKind: 2,
          triggerCharacter: ".",
        },
      },
    });

    const timeContextCompletion = await waitForMessage(
      messages,
      (message) => message.id === 3,
      "TimeContext completion response",
      15_000,
    );
    const timeContextCompletionItems = lspCompletionItems(
      timeContextCompletion.result,
    );
    assert(
      timeContextCompletionItems.some((item) => item.label === "waitSec"),
      "TimeContext completion response should include waitSec",
    );
    assert(
      timeContextCompletionItems.some((item) => item.label === "wait"),
      "TimeContext completion response should include wait",
    );

    await sleep(250);
    const lateDependencyDiagnostics = messages.slice(timeContextStartIndex)
      .flatMap((message) => lspDiagnosticMessages(message))
      .filter((message) =>
        message.includes("not a dependency") ||
        message.includes("Cannot find module") ||
        message.includes("@avtools/core-timing") ||
        message.includes("midi-helpers") ||
        message.includes("piano-roll-helpers") ||
        message.includes("@avtools/music-types") ||
        message.includes("seedrandom")
      );
    assertEquals(lateDependencyDiagnostics, []);

    const defaultSourceStartIndex = messages.length;
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: {
          uri: "file:///main.ts",
          version: 4,
        },
        contentChanges: [{ text: DEFAULT_LIVECODE_SOURCE }],
      },
    });

    await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; version?: number };
        return params.uri === "file:///main.ts" && params.version === 4;
      },
      "version 4 default source diagnostics",
      15_000,
    );
    await sleep(250);

    const defaultSourceDependencyDiagnostics = messages.slice(
      defaultSourceStartIndex,
    )
      .flatMap((message) => lspDiagnosticMessages(message))
      .filter((message) =>
        message.includes("not a dependency") ||
        message.includes("Cannot find module") ||
        message.includes("@avtools/core-timing") ||
        message.includes("midi-helpers") ||
        message.includes("piano-roll-helpers") ||
        message.includes("@avtools/music-types") ||
        message.includes("seedrandom")
      );
    assertEquals(defaultSourceDependencyDiagnostics, []);

    const sampleSketchUrl = new URL(
      "../../../livecode-tldraw/example-projects/minimal-p5gpu/modules/sketch.orig.ts",
      import.meta.url,
    );
    const sampleSketchUri = sampleSketchUrl.href;
    const sampleSketchStartIndex = messages.length;
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: sampleSketchUri,
          languageId: "typescript",
          version: 1,
          text: await Deno.readTextFile(fromFileUrl(sampleSketchUrl)),
        },
      },
    });

    await waitForMessage(
      messages,
      (message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; version?: number };
        return params.uri === sampleSketchUri && params.version === 1;
      },
      "sample project sketch diagnostics",
      15_000,
    );
    await sleep(250);

    const sampleNoLocalDiagnostics = messages.slice(sampleSketchStartIndex)
      .flatMap((message) => lspDiagnosticMessages(message))
      .filter((message) =>
        message.includes("Unable to load a local module") &&
        (message.includes("/apps/deno-notebooks/tools/p5gpu.ts") ||
          message.includes(
            "/apps/deno-notebooks/libraryIntegrationTetsts/raw-webgpu-helpers.ts",
          ) ||
          message.includes(
            "/apps/livecode-tldraw/example-projects/minimal-p5gpu/modules/state.ts",
          ))
      );
    assertEquals(sampleNoLocalDiagnostics, []);
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});
