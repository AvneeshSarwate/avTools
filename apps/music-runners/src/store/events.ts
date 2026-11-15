// The minimal event bus. Routing is the tldraw arrows between instances, each
// carrying one event type (src/store/connections.ts): an event goes to every
// instance a matching arrow from the emitter ends on, once per target. Handlers are registered by running instances. The last few events per
// shape are kept for the chrome to show.
import type { TLShapeId } from "tldraw";
import { proxy } from "valtio";
import type { RunnerEvent } from "../model/types";
import { emitsOf, listConnections, routesFrom } from "./connections";
import { getEditor } from "./editorRef";
import { pulseArrow } from "./pulses";

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

/**
 * Shape ids the connections leaving `shapeId` reach: for one event type, or
 * for any type when `eventType` is omitted. Duplicate arrows count once.
 */
export function arrowTargets(shapeId: TLShapeId, eventType?: string): TLShapeId[] {
  const editor = getEditor();
  if (!editor) return [];
  if (eventType !== undefined) return routesFrom(editor, shapeId, eventType).map((route) => route.toId);
  const targets = new Set<TLShapeId>();
  for (const connection of listConnections(editor)) {
    if (connection.fromId === shapeId && !connection.duplicateOf) targets.add(connection.toId);
  }
  return [...targets];
}

const warnedUndeclared = new Set<string>();

/**
 * Deliver `event` along the connections from `fromShapeId` whose type matches
 * `event.type`, once per target, and pulse each arrow that carried it.
 */
export function emitEvent(fromShapeId: TLShapeId, event: RunnerEvent): TLShapeId[] {
  const stamped: RunnerEvent = { ...event, from: fromShapeId };
  const editor = getEditor();
  if (!editor) return [];
  const declared = emitsOf(editor, fromShapeId);
  const warnKey = `${editor.getShape(fromShapeId)?.type}:${event.type}`;
  if (!declared.includes(event.type) && !warnedUndeclared.has(warnKey)) {
    warnedUndeclared.add(warnKey);
    console.warn(`[events] ${warnKey} is not in the runner's emits list; add it so arrows can select it`);
  }
  const routes = routesFrom(editor, fromShapeId, event.type);
  log(fromShapeId, { at: Date.now(), direction: "out", event: stamped });
  for (const { arrowId, toId: target } of routes) {
    pulseArrow(arrowId);
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
  return routes.map((route) => route.toId);
}
