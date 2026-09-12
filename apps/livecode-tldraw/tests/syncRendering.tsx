import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  SYNC_ENTITY_TYPES,
  type SyncMessage,
} from "@avtools/livecode-protocol";
import { SyncStore } from "../src/syncStore";
import {
  emptySyncState,
  applySyncMessageToState,
  type SyncEntityTypeKey,
} from "../src/syncState";
import {
  SyncStoreProvider,
  useSyncSlice,
  useSyncEntityNames,
  useSyncSelector,
} from "../src/syncSubscriptions";

const counts = new Map<string, number>();
const shown = new Map<string, unknown>();
const store = new SyncStore();
const state = emptySyncState();
let seq = 0;
const checks: string[] = [];
function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
  checks.push(message);
}
function count(id: string) {
  return counts.get(id) ?? 0;
}
function Probe({
  kind,
  name,
  id,
}: {
  kind: SyncEntityTypeKey;
  name: string | null;
  id: string;
}) {
  const slice = useSyncSlice(kind, name);
  counts.set(id, count(id) + 1);
  shown.set(id, name === null ? undefined : slice.entities[name]);
  return <span data-probe={id}>{slice.latestSeq}</span>;
}
function Names() {
  const names = useSyncEntityNames("params");
  counts.set("names", count("names") + 1);
  return <span>{names.join()}</span>;
}
function Derived() {
  const value = useSyncSelector(
    "params",
    (entities) => ({ value: (entities.a as any)?.value }),
    (a, b) => a.value === b.value,
  );
  counts.set("derived", count("derived") + 1);
  shown.set("derived", value);
  return null;
}
let rebind: (name: string | null) => void;
function Rebind() {
  const [name, setName] = useState<string | null>("a");
  rebind = setName;
  return <Probe kind="params" name={name} id="rebind" />;
}
const root = createRoot(document.getElementById("root")!);
function push(body: Pick<SyncMessage, "changes" | "resets">) {
  applySyncMessageToState(state, {
    type: "sync",
    seq: ++seq,
    timestampMs: seq,
    ...body,
  });
  flushSync(() => store.publish({ ...state }));
}
// Minimal wire records exercise all kinds without relying on kind-specific payload shape.
function entity(kind: string, name: string, value = 0) {
  return kind === "run" || kind.startsWith("module")
    ? { moduleId: name, value }
    : { name, value };
}
async function run() {
  const resets = Object.fromEntries(
    SYNC_ENTITY_TYPES.map((kind) => [
      kind,
      [entity(kind, "a"), entity(kind, "b")],
    ]),
  );
  push({ resets: resets as any });
  flushSync(() =>
    root.render(
      <SyncStoreProvider store={store}>
        {SYNC_ENTITY_TYPES.flatMap((kind) =>
          ["a", "b"].map((name) => (
            <Probe key={kind + name} kind={kind} name={name} id={kind + name} />
          )),
        )}
        <Names />
        <Derived />
        <Rebind />
      </SyncStoreProvider>,
    ),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  for (const kind of SYNC_ENTITY_TYPES) {
    const before = new Map(counts);
    push({
      changes: [
        { entityType: kind, name: "a", entity: entity(kind, "a", 1) as any },
      ],
    });
    for (const other of SYNC_ENTITY_TYPES)
      for (const name of ["a", "b"]) {
        const id = other + name;
        assert(
          count(id) ===
            (before.get(id) ?? 0) + (kind === other && name === "a" ? 1 : 0),
          `${kind} update only renders its bound entity: ${id}`,
        );
      }
  }
  const stable = new Map(counts);
  push({
    resets: Object.fromEntries(
      SYNC_ENTITY_TYPES.map((kind) => [
        kind,
        [entity(kind, "a", 1), entity(kind, "b")],
      ]),
    ) as any,
  });
  assert(
    [...stable].every(([id, c]) => count(id) === c),
    "identical full resets cause zero renders",
  );
  const metadataBefore = count("paramsa");
  push({
    changes: [
      {
        entityType: "params",
        name: "a",
        entity: { ...entity("params", "a", 1), meta: { label: "new" } } as any,
      },
    ],
  });
  assert(
    count("paramsa") === metadataBefore + 1,
    "metadata-only change is not suppressed by unchanged value/revision",
  );
  const namesBefore = count("names"),
    bBefore = count("sixSinesb"),
    aBefore = count("sixSinesa");
  push({
    changes: [
      {
        entityType: "sixSines",
        name: "a",
        patches: [{ op: "set", path: ["value"], value: 2 }],
      },
    ],
  });
  assert(
    count("sixSinesa") === aBefore + 1 && count("sixSinesb") === bBefore,
    "sparse patches only render affected entity",
  );
  assert(
    count("names") === namesBefore,
    "value traffic does not rerender entity-name subscribers",
  );
  const noopBefore = count("sixSinesa");
  push({
    changes: [
      {
        entityType: "sixSines",
        name: "a",
        patches: [{ op: "set", path: ["value"], value: 2 }],
      },
    ],
  });
  assert(
    count("sixSinesa") === noopBefore,
    "no-op patch does not rerender its view",
  );
  const selectedBefore = count("derived");
  push({
    changes: [
      {
        entityType: "params",
        name: "b",
        entity: entity("params", "b", 7) as any,
      },
    ],
  });
  assert(
    count("derived") === selectedBefore,
    "derived selector ignores unrelated entities",
  );
  const deletedBefore = count("paramsa");
  push({ changes: [{ entityType: "params", name: "a", entity: null }] });
  assert(
    count("paramsa") === deletedBefore + 1 &&
      shown.get("paramsa") === undefined,
    "deletion notifies its view",
  );
  assert(count("names") === namesBefore + 1, "deletion updates names");
  push({
    changes: [
      {
        entityType: "params",
        name: "a",
        entity: entity("params", "a", 9) as any,
      },
    ],
  });
  assert(
    (shown.get("paramsa") as any).value === 9,
    "recreation hydrates waiting view",
  );
  flushSync(() => rebind("b"));
  const rebound = count("rebind");
  push({
    changes: [
      {
        entityType: "params",
        name: "a",
        entity: entity("params", "a", 10) as any,
      },
    ],
  });
  assert(
    count("rebind") === rebound,
    "rebound view unsubscribes from old name",
  );
  push({
    changes: [
      {
        entityType: "params",
        name: "b",
        entity: entity("params", "b", 8) as any,
      },
    ],
  });
  assert(count("rebind") === rebound + 1, "rebound view follows new name");
  flushSync(() => rebind(null));
  const disabled = count("rebind");
  push({
    changes: [
      {
        entityType: "params",
        name: "b",
        entity: entity("params", "b", 9) as any,
      },
    ],
  });
  assert(count("rebind") === disabled, "disabled subscription ignores traffic");
  // Multiple incoming messages are one published frame, preserving both edits.
  const frameBefore = count("sixSinesa");
  for (const patch of [
    { op: "set", path: ["value"], value: 3 },
    { op: "set", path: ["extra"], value: 4 },
  ] as const)
    applySyncMessageToState(state, {
      type: "sync",
      seq: ++seq,
      timestampMs: seq,
      changes: [{ entityType: "sixSines", name: "a", patches: [patch] }],
    });
  flushSync(() => store.publish({ ...state }));
  assert(
    count("sixSinesa") === frameBefore + 1 &&
      (shown.get("sixSinesa") as any).extra === 4,
    "one frame coalesces rendering without losing ordered patches",
  );
  flushSync(() => root.unmount());
  // Exercise the actual runtime provider too: transport sequence must not
  // invalidate the connection context or unrelated named hook consumers.
  const NativeSocket = window.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    static current: FakeSocket;
    constructor() {
      FakeSocket.current = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    receive(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  window.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const runtime = await import("../src/syncRuntime");
  const providerCounts = { a: 0, b: 0, synth: 0, connection: 0 };
  function ParamsProbe({ name }: { name: "a" | "b" }) {
    runtime.useParamsSync(name);
    providerCounts[name]++;
    return null;
  }
  function SynthProbe() {
    runtime.useSixSinesSync("a");
    providerCounts.synth++;
    return null;
  }
  function ConnectionProbe() {
    runtime.useSyncConnection();
    providerCounts.connection++;
    return null;
  }
  const runtimeRoot = createRoot(document.getElementById("root")!);
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  try {
    flushSync(() =>
      runtimeRoot.render(
        <runtime.SyncRuntimeProvider>
          <ParamsProbe name="a" />
          <ParamsProbe name="b" />
          <SynthProbe />
          <ConnectionProbe />
        </runtime.SyncRuntimeProvider>,
      ),
    );
    await settle();
    FakeSocket.current.receive({
      type: "sync",
      seq: 1,
      resets: {
        params: [
          { name: "a", values: { gain: 0 } },
          { name: "b", values: { gain: 0 } },
        ],
        sixSines: [{ name: "a", data: { values: { 500: 1 }, preset: "" } }],
      },
    });
    await settle();
    const before = { ...providerCounts };
    FakeSocket.current.receive({
      type: "sync",
      seq: 2,
      changes: [
        {
          entityType: "params",
          name: "a",
          entity: { name: "a", values: { gain: 1 } },
        },
      ],
    });
    await settle();
    assert(
      providerCounts.a === before.a + 1,
      "actual provider publishes changed named entity",
    );
    assert(
      providerCounts.b === before.b && providerCounts.synth === before.synth,
      "actual provider leaves unrelated named hooks unrendered",
    );
    assert(
      providerCounts.connection === before.connection,
      "transport sequence does not rerender connection consumers",
    );
    const steady = { ...providerCounts };
    FakeSocket.current.receive({
      type: "sync",
      seq: 3,
      changes: [
        {
          entityType: "signal",
          name: "irrelevant",
          entity: { name: "irrelevant", value: 12 },
        },
      ],
    });
    await settle();
    assert(
      JSON.stringify(providerCounts) === JSON.stringify(steady),
      "unrelated type traffic causes zero provider-consumer renders",
    );
    const { runShapeRendering } = await import("./shapeRendering");
    await runShapeRendering(runtimeRoot, FakeSocket.current, assert);
  } finally {
    flushSync(() => runtimeRoot.unmount());
    window.WebSocket = NativeSocket;
  }

  (window as any).__renderTests = {
    ok: true,
    assertions: checks.length,
    checks,
  };
}
void run().catch((error) => {
  (window as any).__renderTests = {
    ok: false,
    error: String(error),
    stack: error.stack,
    checks,
  };
});
