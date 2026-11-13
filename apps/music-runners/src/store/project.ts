// Disk persistence through the dev server's /api/projects middleware. One
// JSON file per project holds the tldraw snapshot, the banks and the bpm.
import { type Editor, getSnapshot, loadSnapshot } from "tldraw";
import { DEFAULT_BPM, type ProjectFile } from "../model/types";
import { proxy, subscribe } from "valtio";
import { banksStore, replaceAllBanks } from "./banks";
import { clockStore, setBpm } from "./clock";

export interface ProjectState {
  name: string;
  available: string[];
  status: "idle" | "loading" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  lastSavedAt: number | null;
}

export const projectStore = proxy<ProjectState>({
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
  const response = await fetch("/api/projects");
  const body = (await response.json()) as { projects?: string[] };
  const available = body.projects ?? [];
  patch({ available });
  return available;
}

export function projectNameFromUrl(): string {
  const name = new URL(window.location.href).searchParams.get("project");
  return name && /^[a-zA-Z0-9_-]+$/.test(name) ? name : "default";
}

export async function loadProject(editor: Editor, name: string): Promise<void> {
  editorRef = editor;
  loading = true;
  patch({ name, status: "loading", error: null });
  try {
    const response = await fetch(`/api/projects/${name}`);
    if (response.status === 404) {
      replaceAllBanks([]);
      setBpm(DEFAULT_BPM);
      patch({ status: "dirty" });
      scheduleSave();
      return;
    }
    if (!response.ok) throw new Error(`load failed: ${response.status}`);
    const file = (await response.json()) as ProjectFile;
    replaceAllBanks(file.banks ?? []);
    setBpm(file.bpm ?? DEFAULT_BPM);
    if (file.canvas) loadSnapshot(editor.store, file.canvas);
    patch({ status: "saved", lastSavedAt: file.savedAt ?? null });
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    loading = false;
  }
}

function buildFile(editor: Editor): ProjectFile {
  return {
    version: 1,
    name: projectStore.name,
    bpm: clockStore.bpm,
    banks: Object.values(banksStore.banks),
    canvas: getSnapshot(editor.store),
    savedAt: Date.now(),
  };
}

export async function saveProject(): Promise<void> {
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
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveProject(), AUTOSAVE_DELAY_MS);
}

/** Autosave on bank edits, bpm changes, and user document changes. Returns a cleanup. */
export function startAutosave(editor: Editor): () => void {
  editorRef = editor;
  const unsubscribeBanks = subscribe(banksStore, scheduleSave);
  let lastBpm = clockStore.bpm;
  const unsubscribeClock = subscribe(clockStore, () => {
    if (clockStore.bpm !== lastBpm) {
      lastBpm = clockStore.bpm;
      scheduleSave();
    }
  });
  const unsubscribeStore = editor.store.listen(scheduleSave, { scope: "document", source: "user" });
  return () => {
    unsubscribeBanks();
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
