import type { ActiveWaitSnapshot } from "./protocol.ts";

const activeWaitCounts = new Map<string, Map<string, number>>();
const pianoRollLookups = new Map<string, Map<string, string>>();
let snapshotSeq = 0;

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
}

export function exitWait(moduleId: string, id: string) {
  const moduleCounts = activeWaitCounts.get(moduleId);
  if (!moduleCounts) return;

  const next = (moduleCounts.get(id) ?? 0) - 1;
  if (next <= 0) moduleCounts.delete(id);
  else moduleCounts.set(id, next);

  if (moduleCounts.size === 0) activeWaitCounts.delete(moduleId);
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
}

export function clearAllWaits() {
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
}

export function clearModulePianoRollLookups(moduleId: string): void {
  pianoRollLookups.delete(moduleId);
}

export function clearAllPianoRollLookups(): void {
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

export function makeActiveWaitSnapshot(): ActiveWaitSnapshot {
  return {
    type: "activeWaitSnapshot",
    seq: ++snapshotSeq,
    timestampMs: Date.now(),
    modules: getActiveWaitsByModule(),
    pianoRollLookups: getPianoRollLookupsByModule(),
  };
}
