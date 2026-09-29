/**
 * `@livecode-ui`: the one import a project's own UI code uses besides `react`
 * and `tldraw`. Project UI is ordinary code in the project directory, compiled
 * by the UI dev server against the app's own React and tldraw, so these are
 * the app's real hooks and actions re-exported under a stable name, plus the
 * factory that turns a component into an entity-bound tldraw shape.
 *
 * Reads are facet-level: a hook for one facet keeps its result's identity
 * while other facets of the same entity change, so a preset bank never
 * re-renders for a modulated knob.
 */
import { useCallback, useMemo } from "react";
import type {
  LivecodeEvent,
  ParamsEntity,
  ParamsValues,
  PianoRollObject,
  SignalEntity,
} from "@avtools/livecode-protocol";
import { emitEvent as sendEvent } from "./serverRequests";
import {
  useSyncEntityNames,
  useSyncEntitySelector,
  useSyncSlice,
  useSyncStore,
} from "./syncSubscriptions";
import { useSyncActions, useSyncConnection } from "./syncRuntime";

export {
  createEntityShape,
  defineEntityShape,
  type EntityShape,
  type EntityShapeComponentProps,
  type EntityShapeConfig,
  isEntityShape,
} from "./defineEntityShape";
export {
  useSyncEntityNames,
  useSyncEntitySelector,
  useSyncSelector,
  useSyncSlice,
} from "./syncSubscriptions";
export { useSyncConnection } from "./syncRuntime";
/** tldraw's prop validators, for `defineEntityShape({ props })`. */
export { T } from "tldraw";
export type {
  LivecodeEvent,
  ParamsEntity,
  ParamsMeta,
  ParamsValues,
  PianoRollObject,
  SignalEntity,
} from "@avtools/livecode-protocol";

const EMPTY_PRESETS: Readonly<Record<string, ParamsValues>> = Object.freeze({});

/** The whole params entity; re-renders on any change to it. `undefined` when absent. */
export function useParams(name: string | null): ParamsEntity | undefined {
  const slice = useSyncSlice("params", name);
  return name === null ? undefined : slice.entities[name];
}

const selectValues = (entity: ParamsEntity | undefined) => entity?.values ?? null;
/** The live values only: identity-stable across preset and meta changes. */
export function useParamsValues(name: string | null): ParamsValues | null {
  return useSyncEntitySelector("params", name, selectValues);
}

const selectPresets = (entity: ParamsEntity | undefined) =>
  entity?.presets ?? EMPTY_PRESETS;
/** The preset bank only: identity-stable while values are modulated. */
export function useParamsPresets(
  name: string | null,
): Readonly<Record<string, ParamsValues>> {
  return useSyncEntitySelector("params", name, selectPresets);
}

const selectRev = (entity: ParamsEntity | undefined) => entity?.rev ?? null;
export function useParamsRev(name: string | null): number | null {
  return useSyncEntitySelector("params", name, selectRev);
}

/** Every params entity name, for pickers. */
export function useParamsNames(): readonly string[] {
  return useSyncEntityNames("params");
}

export function useSignal(name: string | null): SignalEntity | undefined {
  const slice = useSyncSlice("signal", name);
  return name === null ? undefined : slice.entities[name];
}

export function usePianoRoll(name: string | null): PianoRollObject | undefined {
  const slice = useSyncSlice("pianoRoll", name);
  return name === null ? undefined : slice.entities[name];
}

export interface LivecodeActions {
  serverBaseUrl: string;
  setParams(
    name: string,
    values: ParamsValues,
    options?: { originId?: string },
  ): Promise<ParamsEntity>;
  /** Save a preset: explicit values, or a snapshot of the live values. */
  setParamsPreset(
    name: string,
    label: string,
    options?: { values?: ParamsValues; originId?: string },
  ): Promise<ParamsEntity>;
  deleteParamsPreset(
    name: string,
    label: string,
    options?: { originId?: string },
  ): Promise<ParamsEntity>;
  /**
   * Write a saved preset back into the live values: an ordinary `setParams`
   * with the stored snapshot, read from the UI's copy of sync truth. Resolves
   * false when the entity or label is unknown here.
   */
  recallParamsPreset(
    name: string,
    label: string,
    options?: { originId?: string },
  ): Promise<boolean>;
  /** Send an input event to running modules (`canvas-events` handlers). */
  emitEvent(event: LivecodeEvent): Promise<unknown>;
}

/** Writes to the engine. Stable identity; safe as an effect dependency. */
export function useLivecodeActions(): LivecodeActions {
  const actions = useSyncActions();
  const store = useSyncStore();
  const { serverBaseUrl, setParams, setParamsPreset, deleteParamsPreset } =
    actions;
  const recallParamsPreset = useCallback(
    async (
      name: string,
      label: string,
      options: { originId?: string } = {},
    ) => {
      const preset = store.getSlice("params").entities[name]?.presets
        ?.[label];
      if (!preset) return false;
      await setParams(name, preset, options);
      return true;
    },
    [setParams, store],
  );
  const emitEvent = useCallback(
    (event: LivecodeEvent) => sendEvent(serverBaseUrl, event),
    [serverBaseUrl],
  );
  return useMemo(
    () => ({
      serverBaseUrl,
      setParams,
      setParamsPreset,
      deleteParamsPreset,
      recallParamsPreset,
      emitEvent,
    }),
    [
      deleteParamsPreset,
      emitEvent,
      recallParamsPreset,
      serverBaseUrl,
      setParams,
      setParamsPreset,
    ],
  );
}

/** Connection status, for a view that wants to show it. */
export function useConnectionStatus() {
  return useSyncConnection();
}
