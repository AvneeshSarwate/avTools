import type { ActiveWaitSnapshot } from "./protocol.ts";

const activeWaitCounts = new Map<string, Map<string, number>>();
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

export function makeActiveWaitSnapshot(): ActiveWaitSnapshot {
  return {
    type: "activeWaitSnapshot",
    seq: ++snapshotSeq,
    timestampMs: Date.now(),
    modules: getActiveWaitsByModule(),
  };
}
