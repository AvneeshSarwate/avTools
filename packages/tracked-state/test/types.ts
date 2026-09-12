import {
  createTracked,
  applyPatches,
  type Snapshot,
  type Patch,
} from "../src/index.js";
interface Params {
  cutoff: number;
  filter: { cutoff: number };
  notes: { pitch: number }[];
}
const defaults: Params = { cutoff: 0, filter: { cutoff: 0 }, notes: [] };
const tracked = createTracked(defaults);
const params: Params = tracked.state;
params.filter.cutoff = 0.7;
params.notes.push({ pitch: 60 });
// @ts-expect-error value stays numeric
params.cutoff = "bad";
// @ts-expect-error no index signature leaks into interface
params.unknown = 1;
// @ts-expect-error nested values retain types
params.filter.cutoff = false;
tracked.reconcile({ filter: { cutoff: 1 } }, { mode: "merge" });
// @ts-expect-error reconcile retains leaf types
tracked.reconcile({ filter: { cutoff: "bad" } });
const patches: Patch[] = tracked.drain();
const result: Snapshot<Params> = applyPatches(tracked.snapshot(), patches);
const numeric: number = result.notes[0]!.pitch;
void numeric;

// @ts-expect-error replace requires a complete value
tracked.reconcile({ filter: { cutoff: 1 } });
// @ts-expect-error explicit replace also requires a complete value
tracked.reconcile({ cutoff: 1 }, { mode: "replace" });
const snapshot = tracked.snapshot();
// @ts-expect-error transport array elements may be null (holes normalize)
const note: { pitch: number } = snapshot.notes[0];
void note;
