// UI-facing state: the document (valtio, persisted, undoable) and the UI
// state (mode, selection, split tool). Runtime audio/animation state is not
// here; it lives in engine.ts as plain objects.
import { proxy } from "valtio";
import { createHistory } from "../../shared/history";
import { createAutosave, loadProject } from "../../shared/projectFiles";
import type { PianoRollNote } from "../../shared/pianoRoll/types";
import { canSplit, clampAnchor, defaultDoc, splitRegion, type Region, type SketchDoc, type SplitAxis } from "./model";

export const PROJECT = new URLSearchParams(location.search).get("project") ?? "split-sweep";

export const doc = proxy<SketchDoc>(defaultDoc());

export const ui = proxy<{
  mode: "edit" | "play";
  selectedId: string | null;
  /** Split tool: active once "Split" is pressed; the anchor is placed by a click. */
  split: { anchor: { x: number; y: number } | null; hover: SplitAxis | null } | null;
  /** Edit mode: only the selected region drones. */
  solo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  lastAction: string;
  save: "loading" | "saved" | "saving" | "error" | "offline";
}>({
  mode: "edit",
  selectedId: null,
  split: null,
  solo: false,
  canUndo: false,
  canRedo: false,
  lastAction: "",
  save: "loading",
});

const autosave = createAutosave(PROJECT, () => doc, (status) => (ui.save = status));
let loaded = false;

function replaceDoc(next: SketchDoc) {
  doc.version = next.version;
  doc.regions = next.regions;
  doc.synth = next.synth;
  if (ui.selectedId && !next.regions.some((r) => r.id === ui.selectedId)) ui.selectedId = null;
  ui.split = null;
  if (loaded) autosave.schedule();
}

export const history = createHistory(doc, replaceDoc, (state) => {
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  if (state.label) ui.lastAction = state.label;
  if (loaded) autosave.schedule();
});

export async function loadDoc() {
  try {
    const saved = await loadProject<SketchDoc>(PROJECT);
    if (saved?.regions?.length) replaceDoc({ ...defaultDoc(), ...saved });
    ui.save = "saved";
  } catch (error) {
    console.error("[load]", error);
    ui.save = "offline";
  }
  loaded = true;
  history.reset();
  ui.selectedId = doc.regions[0]?.id ?? null;
}

window.addEventListener("beforeunload", () => autosave.flush());

export const findRegion = (id: string | null | undefined) => (id ? doc.regions.find((r) => r.id === id) : undefined);

export function select(id: string | null) {
  ui.selectedId = id;
  ui.split = null;
}

export function updateRegion(id: string, label: string, patch: Partial<Region>, coalesce?: string) {
  history.commit(label, (d) => {
    const region = d.regions.find((r) => r.id === id);
    if (region) Object.assign(region, patch);
  }, { coalesce });
}

export function setRegionNotes(id: string, notes: PianoRollNote[], label: string) {
  history.commit(`notes: ${label}`, (d) => {
    const region = d.regions.find((r) => r.id === id);
    if (region) region.notes = notes;
  });
}

export function beginSplit() {
  if (findRegion(ui.selectedId)) ui.split = { anchor: null, hover: null };
}

export function placeAnchor(x: number, y: number) {
  const region = findRegion(ui.selectedId);
  if (!region || !ui.split) return;
  ui.split.anchor = clampAnchor(region, x, y);
}

export function applySplit(axis: SplitAxis) {
  const region = findRegion(ui.selectedId);
  const anchor = ui.split?.anchor;
  if (!region || !anchor || !canSplit(region, axis)) return;
  const [first, second] = splitRegion(region, axis, anchor);
  history.commit(`split ${axis}`, (d) => {
    const index = d.regions.findIndex((r) => r.id === region.id);
    if (index >= 0) d.regions.splice(index, 1, first, second);
  });
  ui.split = null;
  ui.selectedId = first.id;
}

export function cancelSplit() {
  ui.split = null;
}

export function setSynthParameters(changes: { id: number; value: number }[]) {
  history.commit("synth parameter", (d) => {
    const parameters = { ...d.synth.parameters };
    for (const change of changes) parameters[change.id] = change.value;
    d.synth = { ...d.synth, parameters };
  }, { coalesce: `synth:${changes.map((c) => c.id).join(",")}` });
}

export function setSynthPreset(preset: string) {
  history.commit("synth preset", (d) => {
    d.synth = { preset, parameters: {} };
  });
}
