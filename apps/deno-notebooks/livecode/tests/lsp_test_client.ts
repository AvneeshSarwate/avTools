// Shared LSP-over-WebSocket test client: Content-Length framing, message
// accumulation, and the standard replies the `deno lsp` bridge expects from an
// editor. Used by lsp_smoke_test.ts and lsp_engine_target_test.ts.

import { assertEquals } from "jsr:@std/assert@1";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface LspTestClient {
  socket: WebSocket;
  messages: JsonRpcMessage[];
}

/**
 * Open `/lsp?session=` and wire up frame parsing plus automatic responses to
 * server-to-client requests (workspace/configuration and the rest).
 */
export function openLspSocket(baseUrl: string, session: string): LspTestClient {
  const socket = new WebSocket(
    `${baseUrl.replace("http", "ws")}/lsp?session=${session}`,
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
  return { socket, messages };
}

export function sendLspMessage(socket: WebSocket, message: JsonRpcMessage) {
  const body = JSON.stringify(message);
  const byteLength = new TextEncoder().encode(body).length;
  socket.send(`Content-Length: ${byteLength}\r\n\r\n${body}`);
}

export function lspCompletionItems(
  result: unknown,
): Array<{ label: string }> {
  return Array.isArray(result)
    ? result as Array<{ label: string }>
    : result && typeof result === "object" &&
        Array.isArray((result as { items?: unknown }).items)
    ? (result as { items: Array<{ label: string }> }).items
    : [];
}

export function lspDiagnosticMessages(message: JsonRpcMessage): string[] {
  if (message.method !== "textDocument/publishDiagnostics") return [];
  const params = message.params as {
    diagnostics?: Array<{ message?: string }>;
  };
  return (params.diagnostics ?? [])
    .map((diagnostic) => diagnostic.message)
    .filter((message): message is string => typeof message === "string");
}

export function lspHoverText(result: unknown): string {
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

export function respondToServerRequest(
  socket: WebSocket,
  message: JsonRpcMessage,
) {
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

export async function eventDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return await data.text();
  throw new Error(`Unsupported WebSocket payload: ${typeof data}`);
}

export function parseLspFrames(input: string): {
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

export async function waitForMessage(
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

export async function waitFor(
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

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
