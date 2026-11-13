/**
 * Macro parameter helper for hanoiShow scenes.
 *
 * A macro is a single slider (0..1 by convention) whose change writes to one
 * or more base parameters via an `apply` function. The goal: collapse dozens
 * of fine-grained controls into a handful of performance-time knobs, while
 * keeping the fine-grained controls visible and editable in the same pane.
 *
 * Scene integration pattern:
 *   export const state = { ..., macros: {} as Record<string, number> };
 *   export const macroDefs: MacroDef<number>[] = [{ key, defaultValue, opts, apply }];
 *   export function setupPane(pane: PaneContainer) {
 *     const macros = pane.addFolder({ title: "Macros", expanded: true });
 *     installMacros(macros, state.macros, macroDefs, () => pane.refresh());
 *     // ...base bindings after this point read post-apply state values...
 *   }
 *
 * Install ORDER matters: install macros BEFORE base bindings that they drive.
 * `addBinding` records the current bound-object value at creation time into
 * the op log, and the replay sent to late-joining clients uses those values.
 * If macros apply after base bindings are added, the ops carry pre-apply
 * values and the UI will desync from state on first connect.
 */

import type { BindingParams } from "tweakpane";

import type { PaneBinding, PaneContainer } from "../window/mod.ts";

export interface MacroDef<T = number> {
  /** Property name on the `macros` state object. Shown as the slider label unless `opts.label` overrides. */
  key: string;
  /** Initial macro value. Typically 0.5 so `apply` is driven mid-range at startup. */
  defaultValue: T;
  /** Tweakpane binding params (min/max/step/label). Defaults target a 0..1 slider. */
  opts?: BindingParams;
  /** Mutate base parameters. Called at install (to seed) and on every `change` event. */
  apply: (value: T) => void;
}

/**
 * Bind each macro def to `folder` and wire its `change` event to call `apply`
 * followed by the caller's `refresh` (typically `() => pane.refresh()`).
 *
 * Also calls `apply` once at install time so base params reflect the macro's
 * default value before base bindings are created.
 */
export function installMacros<T>(
  folder: PaneContainer,
  macroState: Record<string, T>,
  defs: MacroDef<T>[],
  refresh: () => void,
): PaneBinding[] {
  const bindings: PaneBinding[] = [];
  for (const def of defs) {
    if (!(def.key in macroState)) {
      macroState[def.key] = def.defaultValue;
    }
    def.apply(macroState[def.key]);

    const binding = folder.addBinding(macroState, def.key, def.opts);
    binding.on("change", (ev) => {
      def.apply(ev.value as T);
      refresh();
    });
    bindings.push(binding);
  }
  return bindings;
}

// ── Easings + interpolation ─────────────────────────────────────────

/** Aggressive S-curve over [0,1] → [0,1]. Obvious non-linearity for sanity checks. */
export function easeInOutQuart(x: number): number {
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
