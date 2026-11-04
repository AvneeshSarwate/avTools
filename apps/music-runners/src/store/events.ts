// The minimal event bus. Routing is the tldraw arrows: an event emitted by an
// instance goes to every instance shape an arrow starting at the emitter ends
// on. Handlers are registered by running instances. The last few events per
// shape are kept for the chrome to show.
import type { TLArrowBinding, TLShapeId } from "tldraw";
import { proxy } from "valtio";
import type { RunnerEvent } from "../model/types";
import { getEditor } from "./editorRef";

export type EventHandler = (event: RunnerEvent) => void;

const handlers = new Map<string, Set<EventHandler>>();

export interface EventLogEntry {
  at: number;
  direction: "in" | "out";
  event: RunnerEvent;
}

export const eventLogStore = proxy<{ byShape: Record<string, EventLogEntry[]> }>({ byShape: {} });

const LOG_LIMIT = 8;

function log(shapeId: string, entry: EventLogEntry): void {
  const list = eventLogStore.byShape[shapeId] ?? [];
  eventLogStore.byShape[shapeId] = [entry, ...list].slice(0, LOG_LIMIT);
}

export function onEvent(shapeId: string, handler: EventHandler): () => void {
  let set = handlers.get(shapeId);
  if (!set) {
    set = new Set();
    handlers.set(shapeId, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) handlers.delete(shapeId);
  };
}

/** Shape ids that arrows starting at `shapeId` end on. */
export function arrowTargets(shapeId: TLShapeId): TLShapeId[] {
  const editor = getEditor();
  if (!editor) return [];
  const targets: TLShapeId[] = [];
  const bindingsHere = editor.getBindingsToShape<TLArrowBinding>(shapeId, "arrow");
  for (const binding of bindingsHere) {
    if (binding.props.terminal !== "start") continue;
    const arrowBindings = editor.getBindingsFromShape<TLArrowBinding>(binding.fromId, "arrow");
    for (const other of arrowBindings) {
      if (other.props.terminal === "end" && other.toId !== shapeId) targets.push(other.toId);
    }
  }
  return targets;
}

export function emitEvent(fromShapeId: TLShapeId, event: RunnerEvent): TLShapeId[] {
  const stamped: RunnerEvent = { ...event, from: fromShapeId };
  const targets = arrowTargets(fromShapeId);
  log(fromShapeId, { at: Date.now(), direction: "out", event: stamped });
  for (const target of targets) {
    log(target, { at: Date.now(), direction: "in", event: stamped });
    const set = handlers.get(target);
    if (!set) continue;
    for (const handler of [...set]) {
      try {
        handler(stamped);
      } catch (error) {
        console.error("[events] handler failed", error);
      }
    }
  }
  return targets;
}
