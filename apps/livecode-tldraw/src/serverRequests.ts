// Shared server-request helpers for the entity runtime providers
// (pianoRollRuntime, paramsRuntime). App.tsx and livecodeRuntime.tsx keep their
// own full-URL variants; those have a different signature and error text.

export function serverWebSocketUrl(
  serverBaseUrl: string,
  path: string,
): string {
  return `${serverBaseUrl.replace(/^http/, "ws")}${path}`;
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
