// UI-facing state: the document (valtio, persisted, undoable) and the UI
// state (mode, selection, split tool). Runtime audio/animation state is not
// here; it lives in engine.ts as plain objects.
import { proxy, snapshot, subscribe } from "valtio";
import { createHistory } from "../../shared/history";
import { createProject } from "../../shared/project";
import type { PianoRollNote } from "../../shared/pianoRoll/types";
import { applyDelete, canSplit, clampAnchor, deletePlan, defaultDoc, splitRegion, type Region, type SketchDoc, type SplitAxis } from "./model";

export const doc = proxy<SketchDoc>(defaultDoc());

export const ui = proxy<{
  mode: "edit" | "play";
  selectedId: string | null;
  /** Region under the pointer in the palette sidebar: outlined on the grid. */
  hoverId: string | null;
  /** Hovering Delete: the grid previews which neighbours would absorb the selection. */
  deletePreview: boolean;
  /** Split tool: active once "Split" is pressed; the anchor is placed by a click. */
  split: { anchor: { x: number; y: number } | null; hover: SplitAxis | null } | null;
  /** Edit mode: only the selected region drones. */
  solo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  lastAction: string;
}>({
  mode: "edit",
  selectedId: null,
  hoverId: null,
  deletePreview: false,
  split: null,
  solo: false,
  canUndo: false,
  canRedo: false,
  lastAction: "",
});

/**
 * Layout of the page: saved with the project, outside undo. `topHeight` null
 * means "as tall as the properties panel".
 */
export interface ViewLayout {
  panelWidth: number;
  topHeight: number | null;
  /** The notes roll fills the properties panel; the other properties hide. */
  rollFull: boolean;
}
export const PANEL_MIN = 320;
export const PANEL_MAX = 1100;
export const TOP_MIN = 300;
const DEFAULT_VIEW: ViewLayout = { panelWidth: 420, topHeight: null, rollFull: false };
export const view = proxy<ViewLayout>({ ...DEFAULT_VIEW });

type SavedData = SketchDoc & { view?: Partial<ViewLayout> };

/** Saved with the dev server, or to / from JSON files on a static host (shared/project.ts). */
export const project = createProject<SavedData>({
  kind: "split-sweep",
  read: () => ({ ...(snapshot(doc) as SketchDoc), view: snapshot(view) }),
  isValid: (data): data is SavedData => !!data && typeof data === "object" && Array.isArray((data as SketchDoc).regions) && (data as SketchDoc).regions.length > 0,
  apply: (data) => {
    replaceDoc({ ...defaultDoc(), ...(data ?? {}) });
    Object.assign(view, DEFAULT_VIEW, data?.view ?? {});
    history.reset();
    ui.selectedId = doc.regions[0]?.id ?? null;
  },
});
subscribe(view, () => project.changed());

function replaceDoc(next: SketchDoc) {
  doc.version = next.version;
  doc.regions = next.regions;
  doc.synth = next.synth;
  if (ui.selectedId && !next.regions.some((r) => r.id === ui.selectedId)) ui.selectedId = null;
  ui.split = null;
  project.changed();
}

export const history = createHistory(doc, replaceDoc, (state) => {
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  if (state.label) ui.lastAction = state.label;
  project.changed();
});

export const loadDoc = () => project.start("split-sweep");

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

/** Delete a region: the neighbours that tile one of its sides grow over it. */
export function deleteRegion(id: string) {
  const plan = deletePlan(doc.regions, id);
  if (!plan) return;
  history.commit("delete region", (d) => applyDelete(d.regions, id, plan));
  ui.deletePreview = false;
  ui.split = null;
  if (ui.selectedId === id) ui.selectedId = plan.absorbers[0] ?? null;
  if (ui.hoverId === id) ui.hoverId = null;
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
