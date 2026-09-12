import type { SixSinesData } from "@avtools/livecode-protocol";

export interface SixSinesParameterChange {
  id: number;
  value: number;
}

export interface SixSinesHydrationState {
  data: SixSinesData;
  displayed: Map<string, number>;
  valueCount: number;
}

export interface SixSinesHydrationPlan {
  reloadPreset: boolean;
  changes: SixSinesParameterChange[];
  next: SixSinesHydrationState;
}

export function sixSinesHydrationState(
  data: SixSinesData,
): SixSinesHydrationState {
  return {
    data,
    displayed: new Map(),
    valueCount: Object.keys(data.values).length,
  };
}

/**
 * Work out the smallest silent update that makes the editor match sync truth.
 * A normal scalar update traverses the new values once. Parameter removal is
 * rare and requires a preset reload, at which point all values are reapplied.
 */
export function planSixSinesHydration(
  prior: SixSinesHydrationState | null,
  data: SixSinesData,
  force = false,
): SixSinesHydrationPlan {
  let reloadPreset = force || !prior || prior.data.preset !== data.preset;
  let retainedValues = 0;
  let valueCount = 0;
  let changes: SixSinesParameterChange[] = [];

  for (const id in data.values) {
    valueCount++;
    const value = data.values[id];
    const wasDisplayed = prior
      ? prior.displayed.has(id) || Object.hasOwn(prior.data.values, id)
      : false;
    if (wasDisplayed) retainedValues++;
    const displayedValue = prior?.displayed.has(id)
      ? prior.displayed.get(id)
      : prior?.data.values[id];
    if (reloadPreset || !wasDisplayed || !Object.is(displayedValue, value)) {
      changes.push({ id: Number(id), value });
    }
  }

  if (!reloadPreset && prior && retainedValues < prior.valueCount) {
    reloadPreset = true;
    changes = Object.entries(data.values).map(([id, value]) => ({
      id: Number(id),
      value,
    }));
  }

  return {
    reloadPreset,
    changes,
    next: {
      data,
      displayed: new Map(),
      valueCount,
    },
  };
}

/** Record values the editor already applied before its write reaches sync. */
export function recordDisplayedSixSinesParameters(
  state: SixSinesHydrationState | null,
  changes: readonly SixSinesParameterChange[],
): void {
  if (!state) return;
  for (const { id, value } of changes) {
    const key = String(id);
    if (!state.displayed.has(key) && !Object.hasOwn(state.data.values, key)) {
      state.valueCount++;
    }
    if (Object.is(state.data.values[key], value)) state.displayed.delete(key);
    else state.displayed.set(key, value);
  }
}
