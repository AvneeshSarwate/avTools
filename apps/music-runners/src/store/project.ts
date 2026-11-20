// Project persistence. One JSON file per project holds the tldraw snapshot,
// every instance's clip and the bpm.
//
// Two backends, chosen at startup by asking for the project list:
//   disk    the dev server's /api/projects middleware answers; projects load
//           from and autosave to projects/<name>/project.json.
//   manual  no such server (a static build); nothing is saved automatically.
//           The project lives in memory and is saved to and loaded from a
//           JSON file by hand. Saving and loading a file works on both.
import { type Editor, getSnapshot, loadSnapshot } from "tldraw";
import { type Clip, DEFAULT_BPM, type ProjectFile } from "../model/types";
import { proxy, subscribe } from "valtio";
import { clipsStore, replaceAllClips } from "./clips";
import { isRunnerShapeType } from "../shapes";
import { clockStore, setBpm } from "./clock";
import { displayStore, setPitchLabels } from "./display";
import { stopAll } from "./playback";

export interface ProjectState {
  backend: "unknown" | "disk" | "manual";
  name: string;
  available: string[];
  status: "idle" | "loading" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  lastSavedAt: number | null;
}

export const projectStore = proxy<ProjectState>({
  backend: "unknown",
  name: "default",
  available: [],
  status: "idle",
  error: null,
  lastSavedAt: null,
});

let editorRef: Editor | null = null;
let loading = false;
let saveTimer: number | undefined;
let savePending = false;

const AUTOSAVE_DELAY_MS = 1200;

function patch(next: Partial<ProjectState>): void {
  Object.assign(projectStore, next);
}

export async function listProjects(): Promise<string[]> {
  if (projectStore.backend === "manual") return [];
  try {
    const response = await fetch("/api/projects");
    // A static host answers with its 404 page or an index.html fallback.
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("no project server");
    const body = (await response.json()) as { projects?: string[] };
    const available = body.projects ?? [];
    patch({ available, backend: "disk" });
    return available;
  } catch (error) {
    // Once the server has answered, a later failure is a hiccup, not a static host.
    if (projectStore.backend === "unknown") patch({ available: [], backend: "manual" });
    return projectStore.available as string[];
  }
}

function applyFile(editor: Editor, file: ProjectFile): void {
  replaceAllClips(file.clips);
  setBpm(file.bpm);
  setPitchLabels(file.pitchLabels);
  if (file.canvas) loadSnapshot(editor.store, file.canvas);
}

export function projectNameFromUrl(): string {
  const name = new URL(window.location.href).searchParams.get("project");
  return name && /^[a-zA-Z0-9_-]+$/.test(name) ? name : "default";
}

export async function loadProject(editor: Editor, name: string): Promise<void> {
  editorRef = editor;
  if (projectStore.backend === "manual") {
    // Nothing to load from: start empty, with nothing to save yet.
    replaceAllClips({});
    setBpm(DEFAULT_BPM);
    patch({ name, status: "idle", error: null });
    return;
  }
  loading = true;
  patch({ name, status: "loading", error: null });
  try {
    const response = await fetch(`/api/projects/${name}`);
    if (response.status === 404) {
      replaceAllClips({});
      setBpm(DEFAULT_BPM);
      patch({ status: "dirty" });
      scheduleSave();
      return;
    }
    if (!response.ok) throw new Error(`load failed: ${response.status}`);
    const file = (await response.json()) as ProjectFile;
    applyFile(editor, file);
    patch({ status: "saved", lastSavedAt: file.savedAt });
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    loading = false;
  }
}

function buildFile(editor: Editor): ProjectFile {
  // Clips of deleted instances stay in memory for undo but are not saved.
  const clips: Record<string, Clip> = {};
  for (const id of editor.store.query.ids("shape").get()) {
    const shape = editor.getShape(id);
    const clip = shape && isRunnerShapeType(shape.type) ? clipsStore.clips[id] : undefined;
    if (clip) clips[id] = clip;
  }
  return {
    name: projectStore.name,
    bpm: clockStore.bpm,
    pitchLabels: displayStore.pitchLabels,
    clips,
    canvas: getSnapshot(editor.store),
    savedAt: Date.now(),
  };
}

/** Save the project as a JSON file through the browser's download. */
export function saveProjectToFile(): void {
  const editor = editorRef;
  if (!editor || loading) return;
  const file = buildFile(editor);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${file.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
  // On the manual backend the file is the only copy, so this is the save.
  if (projectStore.backend === "manual") patch({ status: "saved", lastSavedAt: file.savedAt, error: null });
}

/**
 * Replace the open project with one read from a JSON file. On the disk
 * backend the result autosaves into the current project like any other edit.
 */
export async function loadProjectFromFile(source: File): Promise<void> {
  const editor = editorRef;
  if (!editor) return;
  try {
    const file = JSON.parse(await source.text()) as ProjectFile;
    if (!file || typeof file !== "object" || typeof file.clips !== "object" || typeof file.bpm !== "number") {
      throw new Error("not a music runners project file");
    }
    stopAll();
    loading = true;
    try {
      applyFile(editor, file);
      // The stores notify their subscribers a tick later; do not count those
      // notifications as edits. (Shapes that write view state as they mount
      // can still mark a freshly loaded project unsaved.)
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    } finally {
      loading = false;
    }
    if (projectStore.backend === "manual") {
      const name = /^[a-zA-Z0-9_-]+$/.test(file.name ?? "") ? file.name : projectStore.name;
      patch({ name, status: "saved", lastSavedAt: file.savedAt ?? null, error: null });
    } else {
      scheduleSave();
    }
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export async function saveProject(): Promise<void> {
  if (projectStore.backend === "manual") return saveProjectToFile();
  const editor = editorRef;
  if (!editor || loading) return;
  if (projectStore.status === "saving") {
    savePending = true;
    return;
  }
  window.clearTimeout(saveTimer);
  patch({ status: "saving" });
  const file = buildFile(editor);
  try {
    const response = await fetch(`/api/projects/${file.name}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(file),
    });
    if (!response.ok) throw new Error(`save failed: ${response.status}`);
    patch({ status: "saved", lastSavedAt: file.savedAt, error: null });
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : String(error) });
  }
  if (savePending) {
    savePending = false;
    scheduleSave();
  }
}

function scheduleSave(): void {
  if (loading) return;
  if (projectStore.status !== "saving") patch({ status: "dirty" });
  // No autosave without the project server: the change stays marked unsaved
  // until the project is saved to a file.
  if (projectStore.backend !== "disk") return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveProject(), AUTOSAVE_DELAY_MS);
}

/**
 * Track clip edits, bpm changes and user document changes: autosave on the
 * disk backend, an unsaved mark (and a warning on leaving) on the manual one.
 * Returns a cleanup.
 */
export function startAutosave(editor: Editor): () => void {
  editorRef = editor;
  const unsubscribeClips = subscribe(clipsStore, scheduleSave);
  let lastBpm = clockStore.bpm;
  const unsubscribeClock = subscribe(clockStore, () => {
    if (clockStore.bpm !== lastBpm) {
      lastBpm = clockStore.bpm;
      scheduleSave();
    }
  });
  const unsubscribeStore = editor.store.listen(scheduleSave, { scope: "document", source: "user" });
  const unsubscribeDisplay = subscribe(displayStore, scheduleSave);
  const warnUnsaved = (event: BeforeUnloadEvent) => {
    if (projectStore.backend === "manual" && projectStore.status === "dirty") event.preventDefault();
  };
  window.addEventListener("beforeunload", warnUnsaved);
  return () => {
    window.removeEventListener("beforeunload", warnUnsaved);
    unsubscribeDisplay();
    unsubscribeClips();
    unsubscribeClock();
    unsubscribeStore();
    window.clearTimeout(saveTimer);
  };
}

export function switchProject(name: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("project", name);
  window.location.href = url.toString();
}
