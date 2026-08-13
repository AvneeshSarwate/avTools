// Shared HTTP + polling + `/sync` helpers for the livecode test suites. Kept
// dependency free (fetch, WebSocket, setTimeout, and type-only imports) so any
// test file can import it.

import type {
  SyncEntityChange,
  SyncMessage,
} from "../visualizer/protocol.ts";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** A `/sync` socket plus the message log a test reads its assertions from. */
export class SyncClient {
  readonly messages: SyncMessage[] = [];
  readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => {
      this.messages.push(JSON.parse(event.data as string) as SyncMessage);
    };
  }

  static async open(baseUrl: string): Promise<SyncClient> {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/sync`);
    const client = new SyncClient(socket);
    await waitFor(
      () => socket.readyState === WebSocket.OPEN,
      "sync socket open",
      5_000,
    );
    return client;
  }

  /** Subscribe and resolve with the reset message the server replies with. */
  async subscribe(entityTypes: string[]): Promise<SyncMessage> {
    const from = this.messages.length;
    this.socket.send(JSON.stringify({ type: "subscribe", entityTypes }));
    await waitFor(
      () => this.resetsSince(from) !== undefined,
      `subscribe reset for [${entityTypes.join(", ")}]`,
      5_000,
    );
    return this.resetsSince(from) as SyncMessage;
  }

  resetsSince(from: number): SyncMessage | undefined {
    return this.messages.slice(from).find((message) =>
      message.resets !== undefined
    );
  }

  changesSince(from: number, entityType?: string): SyncEntityChange[] {
    return this.messages
      .slice(from)
      .flatMap((message) => message.changes ?? [])
      .filter((change) =>
        entityType === undefined || change.entityType === entityType
      );
  }

  waitForChange(
    from: number,
    entityType: string,
    predicate: (change: SyncEntityChange) => boolean,
    label: string,
    timeoutMs = 5_000,
  ): Promise<void> {
    return waitFor(
      () => this.changesSince(from, entityType).some(predicate),
      label,
      timeoutMs,
    );
  }

  close(): void {
    this.socket.close();
  }
}
