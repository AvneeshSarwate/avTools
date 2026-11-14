import { type Editor, createShapeId, type TLShapeId } from "tldraw";
import { createBank, getBank } from "../store/banks";
import { defaultOutputName } from "../store/midi";
import { defineRunnerShape } from "../runners/base/RunnerShape";
import { DEFAULT_INPUT_PROPS, DEFAULT_INSTANCE_HEIGHT, DEFAULT_INSTANCE_WIDTH, type RunnerInstanceProps } from "../runners/base/instanceProps";
import { getRunner, RUNNERS, runnerShapeType } from "../runners/registry";
import { defaultParams } from "../runners/runnerTypes";

export const RUNNER_SHAPE_UTILS = RUNNERS.map((def) => defineRunnerShape(def));
export const RUNNER_SHAPE_TYPES = new Set(RUNNERS.map((def) => runnerShapeType(def.type)));

export function isRunnerShapeType(type: string): boolean {
  return RUNNER_SHAPE_TYPES.has(type);
}

/** Create an instance shape of `runnerType`, bound to `bankId` or to a fresh bank. */
export function createInstance(editor: Editor, runnerType: string, bankId?: string, at?: { x: number; y: number }): TLShapeId {
  const def = getRunner(runnerType);
  const bank = (bankId && getBank(bankId)) || createBank(runnerType);
  const id = createShapeId();
  // New instances step right of the last one so they do not stack.
  const existing = listInstances(editor);
  const last = existing.length ? editor.getShapePageBounds(existing[existing.length - 1].id) : undefined;
  const center = editor.getViewportPageBounds().center;
  const x = at?.x ?? (last ? last.maxX + 40 : center.x - DEFAULT_INSTANCE_WIDTH / 2);
  const y = at?.y ?? (last ? last.minY : center.y - DEFAULT_INSTANCE_HEIGHT / 2);
  const props: RunnerInstanceProps = {
    w: DEFAULT_INSTANCE_WIDTH,
    h: DEFAULT_INSTANCE_HEIGHT,
    runnerType,
    bankId: bank.id,
    midiOutputName: defaultOutputName() ?? "",
    ...DEFAULT_INPUT_PROPS,
    params: defaultParams(def),
    queued: false,
    showSource: true,
    showGenerated: true,
    showPreview: false,
  };
  editor.createShape({ id, type: runnerShapeType(runnerType) as "geo", x, y, props: props as never });
  editor.select(id);
  return id;
}

/** Shape ids of every instance on the current page, with their props. */
export function listInstances(editor: Editor): Array<{ id: TLShapeId; props: RunnerInstanceProps }> {
  const out: Array<{ id: TLShapeId; props: RunnerInstanceProps }> = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (!isRunnerShapeType(shape.type)) continue;
    out.push({ id: shape.id, props: shape.props as unknown as RunnerInstanceProps });
  }
  return out;
}
