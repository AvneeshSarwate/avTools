import { type Editor, createShapeId, type TLShapeId } from "tldraw";
import { setClip } from "../store/clips";
import { clockStore } from "../store/clock";
import { SIX_SINES_TYPE } from "../store/sixSines";
import { defaultOutputName } from "../store/midi";
import { defineRunnerShape } from "../runners/base/RunnerShape";
import { defaultInstanceProps, DEFAULT_INSTANCE_HEIGHT, DEFAULT_INSTANCE_WIDTH, type RunnerInstanceProps } from "../runners/base/instanceProps";
import { getRunner, RUNNERS, runnerShapeType } from "../runners/registry";

export const RUNNER_SHAPE_UTILS = RUNNERS.map((def) => defineRunnerShape(def));
export const RUNNER_SHAPE_TYPES = new Set(RUNNERS.map((def) => runnerShapeType(def.type)));

/**
 * Shape meta naming the instance whose clip this shape's clip is. It is the
 * shape's own id except right after tldraw duplicates or pastes a shape,
 * when it still names the original; src/shapes/clipOnCopy.ts copies the
 * clip then and resets it.
 */
export const CLIP_OWNER_META = "clipOwner";

export function isRunnerShapeType(type: string): boolean {
  return RUNNER_SHAPE_TYPES.has(type);
}

/** Names of the instances on every page, plus any in `extra`. */
function takenNames(editor: Editor, extra?: Iterable<string>): Set<string> {
  const taken = new Set(extra);
  for (const id of editor.store.query.ids("shape").get()) {
    const shape = editor.getShape(id);
    if (shape && isRunnerShapeType(shape.type)) taken.add((shape.props as unknown as RunnerInstanceProps).name);
  }
  return taken;
}

export function isNameTaken(editor: Editor, name: string, extra?: Iterable<string>): boolean {
  return takenNames(editor, extra).has(name);
}

/**
 * The first free "<base> <n>": a new instance counts from 1 ("variants 1"),
 * a copy of "melody" or "melody 2" from 2 ("melody 2", "melody 3").
 */
export function nextInstanceName(editor: Editor, name: string, { copy = false, extra }: { copy?: boolean; extra?: Iterable<string> } = {}): string {
  const base = name.replace(/\s+\d+$/, "").trim() || name;
  const taken = takenNames(editor, extra);
  for (let n = copy ? 2 : 1; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Place new instruments beside the existing runners and synths. */
export function instrumentPosition(editor: Editor, width: number, height: number) {
  let rightmost: ReturnType<Editor["getShapePageBounds"]>;
  for (const shape of editor.getCurrentPageShapes()) {
    if (!isRunnerShapeType(shape.type) && shape.type !== SIX_SINES_TYPE) continue;
    const bounds = editor.getShapePageBounds(shape.id);
    if (bounds && (!rightmost || bounds.maxX > rightmost.maxX)) rightmost = bounds;
  }
  if (rightmost) return { x: rightmost.maxX + 40, y: rightmost.minY };
  const center = editor.getViewportPageBounds().center;
  return { x: center.x - width / 2, y: center.y - height / 2 };
}

/** Create an instance shape of `runnerType` with an empty clip. */
export function createInstance(editor: Editor, runnerType: string, at?: { x: number; y: number }): TLShapeId {
  const def = getRunner(runnerType);
  const id = createShapeId();
  const { x, y } = at ?? instrumentPosition(editor, DEFAULT_INSTANCE_WIDTH, DEFAULT_INSTANCE_HEIGHT);
  const props: RunnerInstanceProps = {
    ...defaultInstanceProps(def),
    name: nextInstanceName(editor, def.type),
    midiOutputName: defaultOutputName() ?? "",
    tempo: clockStore.bpm,
  };
  setClip(id);
  editor.createShape({ id, type: runnerShapeType(runnerType) as "geo", x, y, props: props as never, meta: { [CLIP_OWNER_META]: id } });
  editor.select(id);
  return id;
}

/** Shape ids of every instance on the current page, with their props, in z order. */
export function listInstances(editor: Editor): Array<{ id: TLShapeId; props: RunnerInstanceProps }> {
  const out: Array<{ id: TLShapeId; props: RunnerInstanceProps }> = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (!isRunnerShapeType(shape.type)) continue;
    out.push({ id: shape.id, props: shape.props as unknown as RunnerInstanceProps });
  }
  return out;
}

/** Select an instance and bring it into view (zoom unchanged unless it does not fit). */
export function revealInstance(editor: Editor, id: TLShapeId): void {
  const bounds = editor.getShapePageBounds(id);
  if (!bounds) return;
  editor.select(id);
  const viewport = editor.getViewportPageBounds();
  if (viewport.contains(bounds)) return;
  if (bounds.w <= viewport.w && bounds.h <= viewport.h) {
    editor.centerOnPoint(bounds.center, { animation: { duration: 220 } });
  } else {
    editor.zoomToBounds(bounds, { inset: 40, animation: { duration: 220 } });
  }
}
