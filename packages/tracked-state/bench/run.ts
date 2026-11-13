import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { applyPatches, createTracked, type Patch } from "../src/index.js";

const iterations = Number(process.env.BENCH_ITERATIONS ?? 1000);
if (!Number.isInteger(iterations) || iterations < 10)
  throw new Error("BENCH_ITERATIONS must be an integer >= 10");
const schemaPath = process.env.SCHEMA_PATH;
const schema = schemaPath
  ? (JSON.parse(readFileSync(schemaPath, "utf8")) as {
      params: { id: number; default: number }[];
    })
  : undefined;
const defaults: Record<string, number> = schema
  ? Object.fromEntries(schema.params.map((p) => [String(p.id), p.default]))
  : Object.fromEntries(
      Array.from({ length: 2554 }, (_, i) => [String(100 + i * 17), 0]),
    );
const keys = Object.keys(defaults);
const results: {
  name: string;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  heapDeltaBytes: number;
}[] = [];
let sink = 0;
function measure(
  name: string,
  operation: (i: number) => void,
  prepare?: (i: number) => void,
): void {
  if (
    process.env.BENCH_FILTER &&
    !new RegExp(process.env.BENCH_FILTER).test(name)
  )
    return;
  for (let i = 0; i < 100; i++) {
    prepare?.(i);
    operation(i);
  }
  console.error(`Measuring ${name}`);
  const samples = new Float64Array(iterations);
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) {
    prepare?.(i);
    const start = performance.now();
    operation(i);
    samples[i] = performance.now() - start;
  }
  const heapDeltaBytes = process.memoryUsage().heapUsed - before;
  samples.sort();
  const percentile = (q: number) =>
    samples[Math.min(iterations - 1, Math.floor(iterations * q))]!;
  results.push({
    name,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: samples[iterations - 1]!,
    heapDeltaBytes,
  });
}
function automate(
  state: Record<string, number>,
  tick: number,
  repeats = 1,
): void {
  for (let repeat = 0; repeat < repeats; repeat++)
    for (let j = 0; j < Math.min(50, keys.length); j++)
      state[keys[j]!] = tick + repeat + j;
}
const plain = structuredClone(defaults);
measure("plain: 50 assignments", (i) => automate(plain, i));
for (const count of [1, 10]) {
  const trackers = Array.from({ length: count }, () => createTracked(defaults));
  let mirrors = trackers.map((t) => t.snapshot());
  measure(`${count} entities: idle drain`, () => {
    for (const t of trackers) sink += t.drain().length;
  });
  measure(
    `${count} entities: 50 tracked assignments each`,
    (i) => {
      for (const t of trackers) automate(t.state, i);
    },
    () => {
      for (const t of trackers) t.drain();
    },
  );
  measure(
    `${count} entities: drain 50 dirty keys each`,
    () => {
      for (const t of trackers) sink += t.drain().length;
    },
    (i) => {
      for (const t of trackers) automate(t.state, i);
    },
  );
  measure(`${count} entities: write + drain + JSON + apply`, (i) => {
    trackers.forEach((t, j) => {
      automate(t.state, i);
      const encoded = JSON.stringify(t.drain());
      sink += encoded.length;
      mirrors[j] = applyPatches(mirrors[j]!, JSON.parse(encoded) as Patch[]);
    });
  });
  measure(`${count} entities: 20x50 automation + drain`, (i) => {
    for (const t of trackers) {
      automate(t.state, i, 20);
      sink += t.drain().length;
    }
  });
  measure(`${count} entities: full snapshots`, () => {
    for (const t of trackers) sink += Object.keys(t.snapshot()).length;
  });
  measure(`${count} entities: unchanged reconcile`, () => {
    for (const t of trackers) {
      t.reconcile(defaults);
      t.drain();
    }
  });
  measure(`${count} entities: tiny merge + drain`, (i) => {
    for (const t of trackers) {
      t.reconcile({ [keys[0]!]: i }, { mode: "merge" });
      sink += t.drain().length;
    }
  });
  const incoming = { ...defaults };
  measure(`${count} entities: changed reconcile + drain`, (i) => {
    automate(incoming, i);
    for (const t of trackers) {
      t.reconcile(incoming);
      sink += t.drain().length;
    }
  });
  for (const t of trackers) t.dispose();
}
measure("full JSON stringify baseline", () => {
  sink += JSON.stringify(plain).length;
});
measure("registration clone + graph adoption", () => {
  const t = createTracked(defaults);
  t.dispose();
});
for (const size of [100, 10000]) {
  const t = createTracked({ items: Array.from({ length: size }, (_, i) => i) });
  let mirror = t.snapshot();
  measure(`array ${size}: point write + drain + apply`, (i) => {
    t.state.items[0] = i;
    mirror = applyPatches(mirror, t.drain());
  });
  measure(
    `array ${size}: reverse mutation only`,
    () => {
      t.state.items.reverse();
    },
    () => {
      t.drain();
    },
  );
  measure(`array ${size}: front splice + drain`, (i) => {
    t.state.items.splice(0, 1, i);
    sink += t.drain().length;
  });
  measure(
    `array ${size}: sort + drain`,
    () => {
      t.state.items.sort((a, b) => a - b);
      sink += t.drain().length;
    },
    () => {
      t.state.items.reverse();
      t.drain();
    },
  );
  const nested = createTracked({
    items: Array.from({ length: size }, (_, x) => ({ x })),
  });
  let nestedMirror = nested.snapshot();
  measure(`array ${size}: nested leaf + drain + apply`, (i) => {
    nested.state.items[0]!.x = i;
    nestedMirror = applyPatches(nestedMirror, nested.drain());
  });
  measure(`array ${size}: front insertion + pop + drain`, (i) => {
    t.state.items.splice(0, 0, i);
    t.state.items.pop();
    sink += t.drain().length;
  });
  sink += nestedMirror.items.length;
  sink += mirror.items.length;
}
for (const count of [1, 10]) {
  for (const useExternal of [false, true]) {
    const label = useExternal ? "small external subtree" : "owned only";
    const trackers = Array.from({ length: count }, () =>
      createTracked({
        params: defaults,
        control: { filter: { cutoff: 0, resonance: 1 } },
      }),
    );
    const controls = trackers.map(() => ({
      filter: { cutoff: 0, resonance: 1 },
    }));
    if (useExternal)
      trackers.forEach((t, i) => {
        t.state.control = controls[i]!;
        t.drain();
      });
    const mirrors = trackers.map((t) => t.snapshot());
    measure(`hybrid ${count} entities ${label}: idle drain`, () => {
      for (const t of trackers) sink += t.drain().length;
    });
    measure(
      `hybrid ${count} entities ${label}: 50 writes + drain + JSON + apply`,
      (i) => {
        trackers.forEach((t, j) => {
          automate(t.state.params, i);
          if (useExternal) controls[j]!.filter.cutoff = i;
          const encoded = JSON.stringify(t.drain());
          sink += encoded.length;
          mirrors[j] = applyPatches(
            mirrors[j]!,
            JSON.parse(encoded) as Patch[],
          );
        });
      },
    );
    trackers.forEach((t) => t.dispose());
  }
}
const grown = createTracked<{
  control?: Record<string, number>;
  params: Record<string, number>;
}>({
  control: {},
  params: defaults,
});
const externalControl: Record<string, number> = { value: 0 };
grown.state.control = externalControl;
grown.drain();
for (let i = 0; i < 10000; i++) externalControl[`field${i}`] = i;
grown.drain();
measure(
  "hybrid externally grown 10001-field subtree: raw edit + drain",
  (i) => {
    externalControl.value = i;
    sink += grown.drain().length;
  },
);
delete grown.state.control;
grown.drain();
measure("hybrid detached 10001-field subtree: raw edit + drain", (i) => {
  externalControl.value = i;
  sink += grown.drain().length;
});
grown.dispose();

const report = {
  runtime: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model,
  iterations,
  parameterCount: keys.length,
  fixture: schemaPath ?? "synthetic sparse numeric keys",
  units: "milliseconds per named operation",
  heapCaveat:
    "Heap deltas include preparation and GC; not allocation counts or retained-size measurements. Timings include JIT/GC outliers, timer overhead, and no forced GC.",
  results,
  sink,
};
writeFileSync(
  new URL("./results.local.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
