import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLivecodeVisualizerServer } from "../livecode_visualizer/server.ts";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

Deno.test("deno lsp bridge initializes and publishes diagnostics", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-lsp-smoke-" });
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
      diagnostics: Array<{ message: string }>;
    };
    assert(
      params.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("number") &&
        diagnostic.message.includes("string")
      ),
    );
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
    const bodyEnd = bodyStart + contentLength;
    if (rest.length < bodyEnd) break;

    const body = rest.slice(bodyStart, bodyEnd);
    messages.push(JSON.parse(body));
    rest = rest.slice(bodyEnd);
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
