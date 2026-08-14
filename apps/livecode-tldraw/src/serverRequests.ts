// Shared server-request helpers for the sync provider's write paths (piano-roll
// set/undo/redo, params set — writes stay ordinary HTTP; only watching moved to
// the socket) and for the generic durable-entity actions the TopBar and the
// debug surface both drive. App.tsx and livecodeRuntime.tsx keep their own
// full-URL variants; those have a different signature and error text.

import type {
  EntityMutationSuccess,
  ProjectSaveResponse,
  ProjectStatusResponse,
} from "./livecodeProtocol";

/** Wire ids of the registered durable entity types. */
export const PIANO_ROLL_ENTITY_TYPE = "pianoRoll";
export const PARAMS_ENTITY_TYPE = "params";

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

export function createEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
): Promise<EntityMutationSuccess> {
  return postServerJson<EntityMutationSuccess>(
    serverBaseUrl,
    "/entities/create",
    { type, name },
  );
}

export function duplicateEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
  targetName: string,
): Promise<EntityMutationSuccess> {
  return postServerJson<EntityMutationSuccess>(
    serverBaseUrl,
    "/entities/duplicate",
    { type, name, targetName },
  );
}

export function deleteEntity(
  serverBaseUrl: string,
  type: string,
  name: string,
): Promise<EntityMutationSuccess> {
  return postServerJson<EntityMutationSuccess>(
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
