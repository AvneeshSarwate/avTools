// Snapshot undo/redo over one JSON-serializable document. Every commit pushes
// the state before the change; a commit with the same `coalesce` key within
// COALESCE_MS of the previous one extends that step (colour drags, sliders,
// synth knob turns), so one gesture is one undo.
const COALESCE_MS = 700;
const LIMIT = 300;

export interface History<T> {
  commit(label: string, mutate: (doc: T) => void, options?: { coalesce?: string }): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Drop the stacks (after loading a project). */
  reset(): void;
}

export function createHistory<T>(
  doc: T,
  replace: (next: T) => void,
  onChange: (state: { canUndo: boolean; canRedo: boolean; label?: string }) => void,
): History<T> {
  const past: { label: string; snapshot: string }[] = [];
  const future: { label: string; snapshot: string }[] = [];
  let lastKey: string | undefined;
  let lastAt = 0;

  const snapshot = () => JSON.stringify(doc);
  const notify = (label?: string) => onChange({ canUndo: past.length > 0, canRedo: future.length > 0, label });

  return {
    commit(label, mutate, options) {
      const now = performance.now();
      const extend = options?.coalesce !== undefined && options.coalesce === lastKey && now - lastAt < COALESCE_MS && past.length > 0;
      const before = extend ? null : snapshot();
      mutate(doc);
      if (before !== null) {
        // A no-op commit neither makes a step nor opens a coalescing window.
        if (before === snapshot()) return;
        past.push({ label, snapshot: before });
        if (past.length > LIMIT) past.shift();
      }
      lastKey = options?.coalesce;
      lastAt = now;
      future.length = 0;
      notify(label);
    },
    undo() {
      const step = past.pop();
      if (!step) return false;
      future.push({ label: step.label, snapshot: snapshot() });
      lastKey = undefined;
      replace(JSON.parse(step.snapshot) as T);
      notify(`undo ${step.label}`);
      return true;
    },
    redo() {
      const step = future.pop();
      if (!step) return false;
      past.push({ label: step.label, snapshot: snapshot() });
      lastKey = undefined;
      replace(JSON.parse(step.snapshot) as T);
      notify(`redo ${step.label}`);
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    reset() {
      past.length = 0;
      future.length = 0;
      lastKey = undefined;
      notify();
    },
  };
}
