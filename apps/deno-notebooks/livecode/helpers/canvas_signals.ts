import {
  declareSignal,
  type DeclareSignalOptions,
  type SignalHandle,
} from "@avtools/livecode-engine/signals_store.ts";
import type { SignalAnchor } from "../visualizer/protocol.ts";

export type { DeclareSignalOptions, SignalAnchor, SignalHandle };

/**
 * Declare an ephemeral signal: a named latest-value sample published purely so
 * monitors can watch it.
 *
 * `set(value)` is a plain field assignment at any rate you like — the server
 * samples and ships changed values on its own tick, so an unwatched signal
 * costs the same as a watched one. The value can be any JSON-serializable
 * shape; give it whatever meaning the piece needs.
 *
 * `anchor` points the signal at an entity a view already renders (for example
 * `{ type: "pianoRoll", name: "melody" }` for a playhead), so a view can bind
 * to it without this code knowing the view exists.
 *
 * Signals are never persisted or undoable, nothing else may read them to make
 * decisions, and they end with the run that published them: the analyzer
 * attributes each declaration to its module, and the server ends that module's
 * signals when the run stops. `end()` ends one early.
 */
export function signal<T = unknown>(
  name: string,
  opts?: DeclareSignalOptions,
): SignalHandle<T> {
  return declareSignal<T>(name, opts);
}
