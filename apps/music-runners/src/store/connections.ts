// Connections: the tldraw arrows between runner instances, each carrying one
// event type. An arrow is the tuple (from, eventType, to): its start is bound
// to the sending instance, its end to the receiving one, and the type lives in
// the arrow's `meta.eventType` (the label on the canvas is a chooser over the
// sender's declared `emits`, see src/ui/ConnectionLayer.tsx).
//
// Several arrows with the same tuple are duplicates: the oldest (by
// `meta.connectedAt`, stamped when the arrow first became a connection) is the
// one that routes and pulses, the others are marked on the canvas. Age, not
// z-order: tldraw reorders arrows when it binds them, and drawing an accidental
// duplicate must not take routing away from the arrow already in use.
import { type Editor, getArrowBindings, type TLArrowBinding, type TLArrowShape, type TLShape, type TLShapeId } from "tldraw";
import { getRunner } from "../runners/registry";

export interface Connection {
  arrowId: TLShapeId;
  fromId: TLShapeId;
  toId: TLShapeId;
  /** null until the arrow has one (a sender that emits nothing). */
  eventType: string | null;
  /** The arrow this one duplicates, if any. Duplicates do not route. */
  duplicateOf: TLShapeId | null;
}

const RUNNER_SHAPE_PREFIX = "runner-";

function isRunner(shape: TLShape | undefined): shape is TLShape & { props: { runnerType: string } } {
  return Boolean(shape && shape.type.startsWith(RUNNER_SHAPE_PREFIX) && typeof (shape.props as { runnerType?: unknown }).runnerType === "string");
}

/** Event types the instance's runner declares it emits (empty when none or not a runner). */
export function emitsOf(editor: Editor, shapeId: TLShapeId): string[] {
  const shape = editor.getShape(shapeId);
  if (!isRunner(shape)) return [];
  try {
    return getRunner(shape.props.runnerType).emits ?? [];
  } catch {
    return [];
  }
}

export function eventTypeOf(arrow: TLShape): string | null {
  const value = (arrow.meta as { eventType?: unknown }).eventType;
  return typeof value === "string" && value ? value : null;
}

/** When the arrow first became a connection; 0 (oldest) when never stamped. */
function connectedAt(arrow: TLShape): number {
  const value = (arrow.meta as { connectedAt?: unknown }).connectedAt;
  return typeof value === "number" ? value : 0;
}

/** Oldest first; ties (unstamped arrows) by z-order. */
function byAge(a: TLShape, b: TLShape): number {
  return connectedAt(a) - connectedAt(b) || (a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
}

/** The runner-to-runner tuple an arrow forms, or null for any other arrow. */
function arrowEnds(editor: Editor, arrow: TLArrowShape): { fromId: TLShapeId; toId: TLShapeId } | null {
  const { start, end } = getArrowBindings(editor, arrow);
  if (!start || !end || start.toId === end.toId) return null;
  if (!isRunner(editor.getShape(start.toId)) || !isRunner(editor.getShape(end.toId))) return null;
  return { fromId: start.toId, toId: end.toId };
}

/**
 * Every connection on the current page, oldest first, with duplicates
 * marked. Reads only store records, so it is reactive inside `useValue`.
 */
export function listConnections(editor: Editor): Connection[] {
  const seen = new Map<string, TLShapeId>();
  const out: Connection[] = [];
  const arrows = editor.getCurrentPageShapes().filter((shape) => shape.type === "arrow").sort(byAge);
  for (const shape of arrows) {
    const ends = arrowEnds(editor, shape as TLArrowShape);
    if (!ends) continue;
    const eventType = eventTypeOf(shape);
    const key = `${ends.fromId}\u0000${eventType ?? ""}\u0000${ends.toId}`;
    const first = eventType ? seen.get(key) : undefined;
    if (eventType && !first) seen.set(key, shape.id);
    out.push({ arrowId: shape.id, ...ends, eventType, duplicateOf: first ?? null });
  }
  return out;
}

/**
 * The routing connections leaving `fromId` for `eventType`: one per target
 * (duplicates collapse), each with the arrow that carries it.
 */
export function routesFrom(editor: Editor, fromId: TLShapeId, eventType: string): { arrowId: TLShapeId; toId: TLShapeId }[] {
  const routes = new Map<TLShapeId, TLShapeId>();
  const arrows = editor
    .getBindingsToShape<TLArrowBinding>(fromId, "arrow")
    .filter((binding) => binding.props.terminal === "start")
    .map((binding) => editor.getShape<TLArrowShape>(binding.fromId))
    .filter((arrow): arrow is TLArrowShape => Boolean(arrow) && eventTypeOf(arrow!) === eventType)
    .sort(byAge);
  for (const arrow of arrows) {
    const ends = arrowEnds(editor, arrow);
    if (ends && ends.fromId === fromId && !routes.has(ends.toId)) routes.set(ends.toId, arrow.id);
  }
  return [...routes].map(([toId, arrowId]) => ({ arrowId, toId }));
}

export function setConnectionType(editor: Editor, arrowId: TLShapeId, eventType: string): void {
  const arrow = editor.getShape(arrowId);
  if (!arrow || eventTypeOf(arrow) === eventType) return;
  editor.updateShape({ id: arrowId, type: arrow.type, meta: { ...arrow.meta, eventType } });
}

/** Bends (page px) for parallel arrows between one pair; up to four fan out. */
const PARALLEL_BENDS = [0, 48, -48, 96, -96];

/**
 * Store rules for connections, run inside the same transaction as the edit
 * that triggered them (so they undo together):
 * - an arrow that becomes a connection without a valid type gets the
 *   sender's first declared event type, and is stamped `connectedAt`;
 * - an arrow joining a pair that already has a connection (either
 *   direction) takes the first bend no other arrow of the pair uses, so
 *   parallel arrows fan out instead of drawing over each other;
 * - a connection arrow keeps its built-in text label empty: its label is the
 *   event-type chooser, and free text there would be ignored by routing.
 */
export function installConnectionRules(editor: Editor): () => void {
  const fixArrow = (arrowId: TLShapeId) => {
    const arrow = editor.getShape<TLArrowShape>(arrowId);
    if (!arrow || arrow.type !== "arrow") return;
    const ends = arrowEnds(editor, arrow);
    if (!ends) return;
    const emits = emitsOf(editor, ends.fromId);
    const current = eventTypeOf(arrow);
    const meta = { ...arrow.meta };
    if (emits.length > 0 && (!current || !emits.includes(current))) meta.eventType = emits[0];
    if (typeof meta.connectedAt !== "number") meta.connectedAt = Date.now();
    if (JSON.stringify(meta) !== JSON.stringify(arrow.meta)) editor.updateShape({ id: arrowId, type: "arrow", meta });
    const updated = editor.getShape<TLArrowShape>(arrowId);
    if (updated) fanOut(updated, ends);
  };

  const fanOut = (arrow: TLArrowShape, ends: { fromId: TLShapeId; toId: TLShapeId }) => {
    // Bends are measured in each arrow's own direction: flip the ones that run
    // the other way so every arrow of the pair compares on one axis.
    const [low] = [ends.fromId, ends.toId].sort();
    const sign = (fromId: TLShapeId) => (fromId === low ? 1 : -1);
    const others = listConnections(editor).filter(
      (c) => c.arrowId !== arrow.id && ((c.fromId === ends.fromId && c.toId === ends.toId) || (c.fromId === ends.toId && c.toId === ends.fromId)),
    );
    if (others.length === 0) return;
    const used = others.map((c) => {
      const other = editor.getShape<TLArrowShape>(c.arrowId);
      return Math.round((other?.props.bend ?? 0) * sign(c.fromId));
    });
    const mine = Math.round(arrow.props.bend * sign(ends.fromId));
    if (!used.includes(mine)) return;
    const slot = PARALLEL_BENDS.find((bend) => !used.includes(bend));
    if (slot === undefined) return;
    editor.updateShape<TLArrowShape>({ id: arrow.id, type: "arrow", props: { bend: slot * sign(ends.fromId) } });
  };

  const onBinding = (binding: { type: string; fromId: TLShapeId }) => {
    if (binding.type === "arrow") fixArrow(binding.fromId);
  };
  const removeCreate = editor.sideEffects.registerAfterCreateHandler("binding", onBinding);
  const removeChange = editor.sideEffects.registerAfterChangeHandler("binding", (_before, after) => onBinding(after));
  const removeLabelEdits = editor.sideEffects.registerBeforeChangeHandler("shape", (before, after) => {
    if (after.type !== "arrow" || before.type !== "arrow") return after;
    const prev = before as TLArrowShape;
    const next = after as TLArrowShape;
    if (prev.props.richText === next.props.richText || !arrowEnds(editor, next)) return after;
    return { ...next, props: { ...next.props, richText: prev.props.richText } };
  });
  return () => {
    removeCreate();
    removeChange();
    removeLabelEdits();
  };
}
