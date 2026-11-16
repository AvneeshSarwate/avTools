// Disk persistence through the dev server's /api/projects middleware. One
// JSON file per project holds the tldraw snapshot, every instance's clip and
// the bpm.
import { type Editor, getSnapshot, loadSnapshot } from "tldraw";
import { type Clip, DEFAULT_BPM, type LegacyProjectFile, type ProjectFile } from "../model/types";
import { proxy, subscribe } from "valtio";
import { clipsStore, copyClip, replaceAllClips } from "./clips";
import { CLIP_OWNER_META, isRunnerShapeType } from "../shapes";
import { clockStore, setBpm } from "./clock";
import { displayStore, setPitchLabels } from "./display";

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
      replaceAllClips({});
      setBpm(DEFAULT_BPM);
      patch({ status: "dirty" });
      scheduleSave();
      return;
    }
    if (!response.ok) throw new Error(`load failed: ${response.status}`);
    const file = (await response.json()) as ProjectFile | LegacyProjectFile;
    replaceAllClips(prepareCanvas(file));
    setBpm(file.bpm ?? DEFAULT_BPM);
    setPitchLabels(file.pitchLabels ?? "name");
    if (file.canvas) loadSnapshot(editor.store, file.canvas);
    patch({ status: "saved", lastSavedAt: file.savedAt ?? null });
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    loading = false;
  }
}

interface RawShapeRecord {
  id: string;
  typeName: string;
  type: string;
  props: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * Before the snapshot loads (tldraw runs no side effects while loading):
 * every instance gets a clip and its own id as clip owner. A version 1 file
 * kept notes in banks that several instances could share; each instance gets
 * its own copy of its bank's clip, and the bank's name as its name (numbered
 * when a bank was shared). The shape migration then drops `bankId`.
 */
function prepareCanvas(file: ProjectFile | LegacyProjectFile): Record<string, Clip> {
  const clips: Record<string, Clip> = file.version === 2 ? { ...file.clips } : {};
  const banks = new Map(file.version === 2 ? [] : (file.banks ?? []).map((bank) => [bank.id, bank]));
  const store = (file.canvas?.document?.store ?? {}) as unknown as Record<string, RawShapeRecord>;
  const names = new Set<string>();
  for (const record of Object.values(store)) {
    if (record.typeName !== "shape" || !isRunnerShapeType(record.type)) continue;
    record.meta = { ...record.meta, [CLIP_OWNER_META]: record.id };
    if (file.version !== 2) {
      const bank = banks.get(record.props.bankId as string);
      clips[record.id] = copyClip(bank ?? {});
      // Numbered like a duplicate when taken ("melody", "melody 2")
      let name = bank?.name || String(record.props.runnerType ?? "runner");
      const base = name.replace(/\s+\d+$/, "").trim() || name;
      for (let n = 2; names.has(name); n += 1) name = `${base} ${n}`;
      record.props.name = name;
    }
    if (typeof record.props.name === "string") names.add(record.props.name);
    clips[record.id] ??= copyClip({});
  }
  return clips;
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
    version: 2,
    name: projectStore.name,
    bpm: clockStore.bpm,
    pitchLabels: displayStore.pitchLabels,
    clips,
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

/** Autosave on clip edits, bpm changes, and user document changes. Returns a cleanup. */
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
  return () => {
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
