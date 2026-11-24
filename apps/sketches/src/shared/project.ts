// Project persistence, after music-runners' store/project.ts. One JSON file
// per project.
//
// Two backends, chosen at startup by asking for the project list:
//   disk    the dev server's /api/projects middleware answers; projects load
//           from and autosave to projects/<name>/project.json.
//   manual  no such server (a static build); nothing is saved automatically.
//           The project lives in memory and is saved to and loaded from a
//           JSON file by hand, with a warning on leaving while unsaved.
// Saving to and loading from a file work on both.
import { proxy } from "valtio";

export interface ProjectState {
  backend: "unknown" | "disk" | "manual";
  name: string;
  available: string[];
  status: "idle" | "loading" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  lastSavedAt: number | null;
}

/** What a sketch plugs in: its data to save, and how to take a loaded file. */
export interface ProjectBinding<T> {
  /** Written into the file and checked on load, so files of other sketches are refused. */
  kind: string;
  read(): T;
  /** Replace the open project; `null` starts an empty one. */
  apply(data: T | null): void;
  isValid(data: unknown): data is T;
}

interface ProjectFile<T> {
  kind: string;
  name: string;
  savedAt: number;
  data: T;
}

export const projectStore = proxy<ProjectState>({
  backend: "unknown",
  name: "default",
  available: [],
  status: "idle",
  error: null,
  lastSavedAt: null,
});

const AUTOSAVE_DELAY_MS = 1000;
const NAME = /^[a-zA-Z0-9_-]+$/;

const patch = (next: Partial<ProjectState>) => Object.assign(projectStore, next);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function projectNameFromUrl(fallback: string): string {
  const name = new URL(window.location.href).searchParams.get("project");
  return name && NAME.test(name) ? name : fallback;
}

export function switchProject(name: string): void {
  if (!NAME.test(name)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("project", name);
  window.location.href = url.toString();
}

export async function listProjects(): Promise<string[]> {
  if (projectStore.backend === "manual") return [];
  try {
    const response = await fetch("/api/projects");
    // A static host answers with its 404 page or an index.html fallback.
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("no project server");
    const body = (await response.json()) as { projects?: string[] };
    patch({ available: body.projects ?? [], backend: "disk" });
  } catch {
    // Once the server has answered, a later failure is a hiccup, not a static host.
    if (projectStore.backend === "unknown") patch({ available: [], backend: "manual" });
  }
  return projectStore.available as string[];
}

export function createProject<T>(binding: ProjectBinding<T>) {
  let applying = false;
  let saveTimer: number | undefined;
  let savePending = false;

  const apply = (data: T | null) => {
    applying = true;
    try {
      binding.apply(data);
    } finally {
      // Stores notify their subscribers a tick later: those notifications are
      // the load itself, not edits.
      window.setTimeout(() => (applying = false), 0);
    }
  };

  const build = (): ProjectFile<T> => ({ kind: binding.kind, name: projectStore.name, savedAt: Date.now(), data: binding.read() });

  /** Accepts this format, and bare data from before the wrapper existed. */
  const unwrap = (raw: unknown): ProjectFile<T> | null => {
    if (raw && typeof raw === "object" && "data" in raw && (raw as ProjectFile<T>).kind === binding.kind && binding.isValid((raw as ProjectFile<T>).data)) {
      return raw as ProjectFile<T>;
    }
    if (binding.isValid(raw)) return { kind: binding.kind, name: projectStore.name, savedAt: 0, data: raw };
    return null;
  };

  async function saveNow(): Promise<void> {
    if (projectStore.backend === "manual") return saveToFile();
    if (projectStore.backend !== "disk") return;
    if (projectStore.status === "saving") {
      savePending = true;
      return;
    }
    window.clearTimeout(saveTimer);
    patch({ status: "saving" });
    const file = build();
    try {
      const response = await fetch(`/api/projects/${file.name}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(file, null, 2),
      });
      if (!response.ok) throw new Error(`save failed: ${response.status}`);
      patch({ status: "saved", lastSavedAt: file.savedAt, error: null });
    } catch (error) {
      patch({ status: "error", error: errorText(error) });
    }
    if (savePending) {
      savePending = false;
      changed();
    }
  }

  /** Call after every change: autosaves on disk, marks unsaved on manual. */
  function changed(): void {
    if (applying || projectStore.status === "loading") return;
    if (projectStore.status !== "saving") patch({ status: "dirty" });
    // No autosave without the project server: the change stays marked
    // unsaved until the project is saved to a file.
    if (projectStore.backend !== "disk") return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
  }

  /** Save the project as a JSON file through the browser's download. */
  function saveToFile(): void {
    const file = build();
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.name}.json`;
    link.click();
    URL.revokeObjectURL(url);
    // On the manual backend the file is the only copy, so this is the save.
    if (projectStore.backend === "manual") patch({ status: "saved", lastSavedAt: file.savedAt, error: null });
  }

  /** Replace the open project with a JSON file; on disk it then autosaves into the current project. */
  async function loadFromFile(source: File): Promise<void> {
    try {
      const file = unwrap(JSON.parse(await source.text()));
      if (!file) throw new Error(`not a ${binding.kind} project file`);
      apply(file.data);
      if (projectStore.backend === "manual") {
        const name = NAME.test(file.name ?? "") ? file.name : projectStore.name;
        patch({ name, status: "saved", lastSavedAt: file.savedAt || null, error: null });
      } else {
        changed();
      }
    } catch (error) {
      patch({ status: "error", error: errorText(error) });
    }
  }

  /** Pick the backend and open the project named in the URL. */
  async function start(fallbackName: string): Promise<void> {
    const name = projectNameFromUrl(fallbackName);
    await listProjects();
    if (projectStore.backend === "manual") {
      // Nothing to load from: start empty, with nothing to save yet.
      apply(null);
      patch({ name, status: "idle", error: null });
    } else {
      patch({ name, status: "loading", error: null });
      try {
        const response = await fetch(`/api/projects/${name}`);
        if (response.status === 404) {
          apply(null);
          patch({ status: "idle" });
          // A new project: write it once the load's own notifications have passed.
          window.setTimeout(changed, 0);
        } else {
          if (!response.ok) throw new Error(`load failed: ${response.status}`);
          const file = unwrap(await response.json());
          if (!file) throw new Error(`projects/${name}/project.json is not a ${binding.kind} project`);
          apply(file.data);
          patch({ status: "saved", lastSavedAt: file.savedAt || null });
        }
      } catch (error) {
        apply(null);
        patch({ status: "error", error: errorText(error) });
      }
    }
    window.addEventListener("beforeunload", (event) => {
      if (projectStore.backend === "manual" && projectStore.status === "dirty") event.preventDefault();
      else if (projectStore.backend === "disk" && saveTimer !== undefined && projectStore.status === "dirty") void saveNow();
    });
  }

  return { start, changed, saveNow, saveToFile, loadFromFile };
}
