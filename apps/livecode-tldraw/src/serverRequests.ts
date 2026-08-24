// Shared server-request helpers for the sync provider's write paths (piano-roll
// set/undo/redo, params set — writes stay ordinary HTTP; only watching moved to
// the socket) and for the generic durable-entity actions the TopBar and the
// debug surface both drive. App.tsx and livecodeRuntime.tsx keep their own
// full-URL variants; those have a different signature and error text.

import type {
  EngineEntityActionResult,
  EngineEntityCapture,
  EngineEntityLoadEntry,
  EngineOp,
  EntityMutationSuccess,
  ProjectSaveResponse,
  ProjectStatusResponse,
} from "./livecodeProtocol";

/** Wire ids of the registered durable entity types. */
export const PIANO_ROLL_ENTITY_TYPE = "pianoRoll";
export const PARAMS_ENTITY_TYPE = "params";
export const ANIMATION_TIMELINE_ENTITY_TYPE = "animationTimeline";

/**
 * "broadcast" routes entity/roll/params actions over the engine tab's
 * BroadcastChannel (URL param `actions=broadcast`) instead of HTTP — the
 * serverless baked topology, where there is no server to POST to. Everything
 * else (analysis, project, LSP) is server-only and simply absent there.
 */
export const ACTIONS_TRANSPORT: "http" | "broadcast" =
  new URLSearchParams(window.location.search).get("actions") === "broadcast"
    ? "broadcast"
    : "http";
const ACTIONS_CHANNEL = "livecode-actions";
const ACTION_TIMEOUT_MS = 10_000;

/** One request/response round trip on the actions channel. The engine host
 * answers with the same `engineResult` envelope the server uplink uses. */
export function broadcastEngineAction(op: EngineOp): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(ACTIONS_CHANNEL);
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      channel.close();
      reject(
        new Error(
          `engine action ${op.kind} timed out (is the engine tab open?)`,
        ),
      );
    }, ACTION_TIMEOUT_MS);
    channel.onmessage = (event) => {
      const message = event.data as
        | { type?: string; requestId?: string; ok?: boolean; body?: unknown; error?: string }
        | undefined;
      if (message?.type !== "engineResult" || message.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timer);
      channel.close();
      if (message.ok) resolve(message.body);
      else reject(new Error(message.error ?? "engine action failed"));
    };
    channel.postMessage({ type: "engineRequest", requestId, op });
  });
}

/**
 * The baked topology's save: capture every durable entity the engine tab holds
 * right now, over the broadcast actions channel, as the same `{type, name,
 * data}` rows baked.json carries. Deliberately omitted rows such as the
 * pristine demo roll are counted but not exported; capture errors abort.
 */
export async function captureBakedEntities(): Promise<{
  entities: EngineEntityLoadEntry[];
  skippedCount: number;
}> {
  const rows = await broadcastEngineAction({
    kind: "captureEntities",
  }) as EngineEntityCapture[];
  const failed = rows.filter((row) => row.error !== undefined);
  if (failed.length > 0) {
    throw new Error(
      `Entity export aborted: ${
        failed.map((row) => `${row.type} "${row.name}": ${row.error}`)
          .join("; ")
      }`,
    );
  }
  const entities = rows
    .filter((row) => row.payload !== null)
    .map((row) => ({ type: row.type, name: row.name, data: row.payload }));
  return { entities, skippedCount: rows.length - entities.length };
}

/** Perform one engine action over the configured transport. */
export async function engineAction<T>(
  op: EngineOp,
  serverBaseUrl: string,
  httpPath: string,
  httpBody: unknown,
): Promise<T> {
  if (ACTIONS_TRANSPORT === "broadcast") {
    return await broadcastEngineAction(op) as T;
  }
  return await postServerJson<T>(serverBaseUrl, httpPath, httpBody);
}

function entityActionResult(
  result: EngineEntityActionResult,
): EntityMutationSuccess {
  if (!result.ok || !result.entity) {
    throw new Error(result.error ?? "entity action failed");
  }
  return { ok: true, entity: result.entity };
}

export function serverWebSocketUrl(
  serverBaseUrl: string,
  path: string,
): string {
  return `${serverBaseUrl.replace(/^http/, "ws")}${path}`;
}

export async function fetchServerJson<T>(
  serverBaseUrl: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${serverBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(
      `${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export async function postServerJson<T>(
  serverBaseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${serverBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

// The entity routes answer a rejected action with a non-2xx `{ ok: false,
// error }` body, so the throw above already carries the server's wording;
// callers surface it rather than re-deriving one.

export async function createEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
): Promise<EntityMutationSuccess> {
  if (ACTIONS_TRANSPORT === "broadcast") {
    return entityActionResult(
      await broadcastEngineAction({
        kind: "entityCreate",
        request: { type, name },
      }) as EngineEntityActionResult,
    );
  }
  return await postServerJson<EntityMutationSuccess>(
    serverBaseUrl,
    "/entities/create",
    { type, name },
  );
}

export async function duplicateEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
  targetName: string,
): Promise<EntityMutationSuccess> {
  if (ACTIONS_TRANSPORT === "broadcast") {
    return entityActionResult(
      await broadcastEngineAction({
        kind: "entityDuplicate",
        request: { type, name, targetName },
      }) as EngineEntityActionResult,
    );
  }
  return await postServerJson<EntityMutationSuccess>(
    serverBaseUrl,
    "/entities/duplicate",
    { type, name, targetName },
  );
}

export async function deleteEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
): Promise<EntityMutationSuccess> {
  if (ACTIONS_TRANSPORT === "broadcast") {
    return entityActionResult(
      await broadcastEngineAction({
        kind: "entityDelete",
        request: { type, name },
      }) as EngineEntityActionResult,
    );
  }
  return await postServerJson<EntityMutationSuccess>(
    serverBaseUrl,
    "/entities/delete",
    { type, name },
  );
}

/** Explicit save: the manifest plus one JSON file per durable entity. */
export function saveProject(
  serverBaseUrl: string,
): Promise<ProjectSaveResponse> {
  return postServerJson<ProjectSaveResponse>(
    serverBaseUrl,
    "/project/save",
    {},
  );
}

export function fetchProjectStatus(
  serverBaseUrl: string,
): Promise<ProjectStatusResponse> {
  return fetchServerJson<ProjectStatusResponse>(
    serverBaseUrl,
    "/project/status",
  );
}
