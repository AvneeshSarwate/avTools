// Client side of server/projectFiles.ts: projects/<name>/project.json on disk.
export async function loadProject<T>(name: string): Promise<T | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`load ${name}: ${response.status}`);
  return (await response.json()) as T;
}

export async function saveProject(name: string, data: unknown): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data, null, 2),
  });
  if (!response.ok) throw new Error(`save ${name}: ${response.status}`);
}

/** Debounced saver: schedule() after every change, the latest data is written. */
export function createAutosave(name: string, read: () => unknown, onStatus: (status: "saved" | "saving" | "error") => void, delayMs = 800) {
  let timer: number | undefined;
  let writing = Promise.resolve();
  const flush = () => {
    timer = undefined;
    const data = read();
    onStatus("saving");
    writing = writing.then(() => saveProject(name, data)).then(
      () => onStatus("saved"),
      (error) => {
        console.error("[autosave]", error);
        onStatus("error");
      },
    );
  };
  return {
    schedule() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(flush, delayMs);
    },
    flush() {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        flush();
      }
    },
  };
}
