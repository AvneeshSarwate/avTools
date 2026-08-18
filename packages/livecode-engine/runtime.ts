import type { TimeContext } from "@avtools/core-timing";
import type { ActiveWaitSnapshot } from "@avtools/livecode-protocol";
// Cyclic by design and safe: `signals_store.ts` imports `sampleRootTime` from
// here, and both sides only touch the other's bindings inside function bodies.
import { assignSignalOwner } from "./signals_store.ts";

const activeWaitCounts = new Map<string, Map<string, number>>();
const pianoRollLookups = new Map<string, Map<string, string>>();
// Module ids whose waits/lookups a mutator touched since the last collect.
// These are hints, not truth: `enterWait` runs on every awaited callsite, so
// the sync sources compare the resulting per-module value before shipping
// anything. Marking is a Set.add on the hot path and nothing more.
const dirtyWaitModules = new Set<string>();
const dirtyLookupModules = new Set<string>();
let snapshotSeq = 0;
let rootTimeContext: TimeContext | null = null;

function getOrCreateModuleCounts(moduleId: string): Map<string, number> {
  let moduleCounts = activeWaitCounts.get(moduleId);
  if (!moduleCounts) {
    moduleCounts = new Map<string, number>();
    activeWaitCounts.set(moduleId, moduleCounts);
  }
  return moduleCounts;
}

export function enterWait(moduleId: string, id: string) {
  const moduleCounts = getOrCreateModuleCounts(moduleId);
  moduleCounts.set(id, (moduleCounts.get(id) ?? 0) + 1);
  dirtyWaitModules.add(moduleId);
}

export function exitWait(moduleId: string, id: string) {
  const moduleCounts = activeWaitCounts.get(moduleId);
  if (!moduleCounts) return;

  const next = (moduleCounts.get(id) ?? 0) - 1;
  if (next <= 0) moduleCounts.delete(id);
  else moduleCounts.set(id, next);

  if (moduleCounts.size === 0) activeWaitCounts.delete(moduleId);
  dirtyWaitModules.add(moduleId);
}

export async function visualizedAwait<T>(
  moduleId: string,
  id: string,
  promise: PromiseLike<T>,
): Promise<T> {
  enterWait(moduleId, id);
  try {
    return await promise;
  } finally {
    exitWait(moduleId, id);
  }
}

export function clearModuleWaits(moduleId: string) {
  activeWaitCounts.delete(moduleId);
  dirtyWaitModules.add(moduleId);
}

export function clearAllWaits() {
  for (const moduleId of activeWaitCounts.keys()) {
    dirtyWaitModules.add(moduleId);
  }
  activeWaitCounts.clear();
}

export function getActiveWaitsByModule(): Record<string, string[]> {
  return Object.fromEntries(
    [...activeWaitCounts.entries()].map(([moduleId, moduleCounts]) => [
      moduleId,
      [...moduleCounts.keys()],
    ]),
  );
}

/** Module ids that currently have at least one active wait callsite. */
export function listWaitModuleIds(): string[] {
  return [...activeWaitCounts.keys()];
}

/**
 * One module's active wait callsites, SORTED so a steady loop that re-enters
 * the same set produces a byte-identical value and stays silent. Null when the
 * module is awaiting nothing, which is how the entity is deleted.
 */
export function getModuleWaitCallsites(moduleId: string): string[] | null {
  const moduleCounts = activeWaitCounts.get(moduleId);
  if (!moduleCounts || moduleCounts.size === 0) return null;
  return [...moduleCounts.keys()].sort((a, b) => a.localeCompare(b));
}

/** Drains the wait dirty hints. Exactly one consumer per tick. */
export function consumeDirtyWaitModules(): string[] {
  if (dirtyWaitModules.size === 0) return [];
  const drained = [...dirtyWaitModules];
  dirtyWaitModules.clear();
  return drained;
}

export function recordPianoRollLookup(
  moduleId: string,
  callsiteId: string,
  name: string,
): void {
  let moduleLookups = pianoRollLookups.get(moduleId);
  if (!moduleLookups) {
    moduleLookups = new Map<string, string>();
    pianoRollLookups.set(moduleId, moduleLookups);
  }
  moduleLookups.set(callsiteId, name);
  dirtyLookupModules.add(moduleId);
}

export function clearModulePianoRollLookups(moduleId: string): void {
  pianoRollLookups.delete(moduleId);
  dirtyLookupModules.add(moduleId);
}

export function clearAllPianoRollLookups(): void {
  for (const moduleId of pianoRollLookups.keys()) {
    dirtyLookupModules.add(moduleId);
  }
  pianoRollLookups.clear();
}

export function getPianoRollLookupsByModule(): Record<
  string,
  Record<string, string>
> {
  return Object.fromEntries(
    [...pianoRollLookups.entries()].map(([moduleId, moduleLookups]) => [
      moduleId,
      Object.fromEntries(moduleLookups.entries()),
    ]),
  );
}

/** Module ids that have at least one recorded lookup. */
export function listLookupModuleIds(): string[] {
  return [...pianoRollLookups.keys()];
}

/**
 * One module's callsiteId → resolved roll name map, or null when it has none.
 * Keys are emitted in sorted order so an unchanged map serializes identically.
 */
export function getModuleLookups(
  moduleId: string,
): Record<string, string> | null {
  const moduleLookups = pianoRollLookups.get(moduleId);
  if (!moduleLookups || moduleLookups.size === 0) return null;
  const sorted: Record<string, string> = {};
  for (
    const callsiteId of [...moduleLookups.keys()].sort((a, b) =>
      a.localeCompare(b)
    )
  ) {
    sorted[callsiteId] = moduleLookups.get(callsiteId) as string;
  }
  return sorted;
}

/** Drains the lookup dirty hints. Exactly one consumer per tick. */
export function consumeDirtyLookupModules(): string[] {
  if (dirtyLookupModules.size === 0) return [];
  const drained = [...dirtyLookupModules];
  dirtyLookupModules.clear();
  return drained;
}

/**
 * Transparent pass-through wrapper inserted by the transform around the
 * roll-name argument of piano-roll store access calls. Records the
 * runtime-resolved roll name for the callsite and returns the name unchanged
 * so the wrapped call behaves identically.
 */
export function visualizedPianoRollLookup<T>(
  moduleId: string,
  callsiteId: string,
  name: T,
): T {
  if (typeof name === "string") {
    recordPianoRollLookup(moduleId, callsiteId, name);
  }
  return name;
}

export interface RootTimeSample {
  timeSec: number;
  beats: number;
}

/**
 * The server registers its parent loop's context here so process-global
 * observation code can stamp samples with logical time. Passing null (server
 * shutdown) simply stops the stamping.
 */
export function setRootTimeContext(ctx: TimeContext | null): void {
  rootTimeContext = ctx;
}

/**
 * Current root-clock logical time, or null when no context is registered (a
 * plain `deno run` of a module, or before the parent loop starts). Never
 * throws: it is read from samplers that must not break their timer.
 */
export function sampleRootTime(): RootTimeSample | null {
  const ctx = rootTimeContext;
  if (!ctx) return null;
  try {
    const timeSec = ctx.time;
    // `beats` reads the tempo map, which is wired during launch/branch setup.
    const beats = ctx.beats;
    if (!Number.isFinite(timeSec) || !Number.isFinite(beats)) return null;
    return { timeSec, beats };
  } catch {
    return null;
  }
}

/**
 * Transparent pass-through wrapper the transform puts around a whole
 * `signal(...)` declaration. It attributes the declared signal to the module
 * that ran the callsite — which is what lets the server end that module's
 * signals when its run ends — and returns the handle unchanged, so the wrapped
 * call behaves identically. An untransformed (headless) run simply produces
 * unowned signals that never auto-end.
 */
export function visualizedOwnedSignal<T>(
  moduleId: string,
  _callsiteId: string,
  handle: T,
): T {
  // Structural, like the piano-roll lookup wrapper: anything that is not a
  // signal handle passes through untouched rather than failing a run.
  const name = (handle as { name?: unknown } | null | undefined)?.name;
  if (typeof name === "string") assignSignalOwner(name, moduleId);
  return handle;
}

export function makeActiveWaitSnapshot(): ActiveWaitSnapshot {
  return {
    type: "activeWaitSnapshot",
    seq: ++snapshotSeq,
    timestampMs: Date.now(),
    modules: getActiveWaitsByModule(),
    pianoRollLookups: getPianoRollLookupsByModule(),
  };
}
