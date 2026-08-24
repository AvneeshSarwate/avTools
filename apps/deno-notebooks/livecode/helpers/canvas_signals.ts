import {
  declareSignal,
  type SignalHandle,
} from "@avtools/livecode-engine/signals_store.ts";
import type { SignalAnchor } from "../visualizer/protocol.ts";

export type { SignalAnchor, SignalHandle };

/**
 * Declare an ephemeral signal: a named latest-value sample published purely so
 * monitors can watch it.
 *
 * `set(value)` is a plain field assignment at any rate you like — the server
 * samples and ships changed values on its own tick, so an unwatched signal
 * costs the same as a watched one. The value can be any JSON-serializable
 * shape; give it whatever meaning the piece needs.
 *
 * `addAnchor` points the signal at entities views already render, so one runtime
 * value can appear in several views without this code knowing those views exist.
 *
 * Signals are never persisted or undoable, nothing else may read them to make
 * decisions, and they end with the run that published them: the analyzer
 * attributes each declaration to its module, and the server ends that module's
 * signals when the run stops. `end()` ends one early.
 */
export function signal<T = unknown>(
  name: string,
): SignalHandle<T> {
  return declareSignal<T>(name);
}
