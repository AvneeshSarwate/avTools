import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "jsr:@std/path@1";
import { DEFAULT_LIVECODE_SOURCE } from "../../../browser-projections/src/sketches/livecodeVisualizer/defaultSource.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

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
  const socket = new WebSocket(
    `${server.baseUrl.replace("http", "ws")}/lsp?session=lsp-smoke`,
  );
  const messages: JsonRpcMessage[] = [];
  let buffer = "";

  socket.onmessage = async (event) => {
    buffer += await eventDataToString(event.data);
    const parsed = parseLspFrames(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      messages.push(message);
      respondToServerRequest(socket, message);
    }
  };

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
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

function sendLspMessage(socket: WebSocket, message: JsonRpcMessage) {
  const body = JSON.stringify(message);
  const byteLength = new TextEncoder().encode(body).length;
  socket.send(`Content-Length: ${byteLength}\r\n\r\n${body}`);
}

function lspCompletionItems(
  result: unknown,
): Array<{ label: string }> {
  return Array.isArray(result)
    ? result as Array<{ label: string }>
    : result && typeof result === "object" &&
        Array.isArray((result as { items?: unknown }).items)
    ? (result as { items: Array<{ label: string }> }).items
    : [];
}

function lspDiagnosticMessages(message: JsonRpcMessage): string[] {
  if (message.method !== "textDocument/publishDiagnostics") return [];
  const params = message.params as {
    diagnostics?: Array<{ message?: string }>;
  };
  return (params.diagnostics ?? [])
    .map((diagnostic) => diagnostic.message)
    .filter((message): message is string => typeof message === "string");
}

function lspHoverText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const contents = (result as { contents?: unknown }).contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map(lspHoverContentText).join(
      "\n\n",
    );
  }
  return lspHoverContentText(contents);
}

function lspHoverContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const value = (content as { value?: unknown }).value;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function respondToServerRequest(socket: WebSocket, message: JsonRpcMessage) {
  if (message.id === undefined || !message.method) return;

  if (message.method === "workspace/configuration") {
    const params = message.params as { items?: unknown[] };
    sendLspMessage(socket, {
      jsonrpc: "2.0",
      id: message.id,
      result: (params.items ?? []).map(() => null),
    });
    return;
  }

  sendLspMessage(socket, {
    jsonrpc: "2.0",
    id: message.id,
    result: null,
  });
}

async function eventDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return await data.text();
  throw new Error(`Unsupported WebSocket payload: ${typeof data}`);
}

function parseLspFrames(input: string): {
  messages: JsonRpcMessage[];
  rest: string;
} {
  const messages: JsonRpcMessage[] = [];
  let rest = input;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  while (true) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;

    const header = rest.slice(0, headerEnd);
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch?.[1]) {
      throw new Error(`Missing Content-Length header: ${header}`);
    }

    const bodyStart = headerEnd + 4;
    const contentLength = Number(lengthMatch[1]);
    const headerByteLength = encoder.encode(rest.slice(0, bodyStart)).length;
    const restBytes = encoder.encode(rest);
    const bodyEnd = headerByteLength + contentLength;
    if (restBytes.length < bodyEnd) break;

    const body = decoder.decode(restBytes.slice(headerByteLength, bodyEnd));
    messages.push(JSON.parse(body));
    rest = decoder.decode(restBytes.slice(bodyEnd));
  }

  return { messages, rest };
}

async function waitForMessage(
  messages: JsonRpcMessage[],
  predicate: (message: JsonRpcMessage) => boolean,
  label: string,
  timeoutMs: number,
): Promise<JsonRpcMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const message = messages.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 1_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assertEquals(predicate(), true, `Timed out waiting for ${label}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
