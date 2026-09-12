import React, { Profiler } from "react";
import { flushSync } from "react-dom";
import { Tldraw, createShapeId, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import "../src/styles.css";
import { ParamPaneShapeUtil } from "../src/ParamPaneShape";
import { PianoRollShapeUtil } from "../src/PianoRollShape";
import { AnimationEditorShapeUtil } from "../src/AnimationEditorShape";
import { DrawingShapeUtil } from "../src/DrawingShape";
import { SixSinesShapeUtil } from "../src/SixSinesShape";
import { SignalScopeShapeUtil } from "../src/SignalScopeShape";
import { SyncRuntimeProvider } from "../src/syncRuntime";
import preset from "../../../packages/six-sines/ui/presets/Effects/Wind.sxsnp?raw";

/** Count real shape subtree commits, including the embedded custom elements. */
export async function runShapeRendering(
  root: any,
  socket: any,
  assert: (ok: unknown, label: string) => void,
) {
  const counts = new Map<string, number>();
  const originalFetchForParams = window.fetch;
  const parameterWrites: unknown[] = [];
  window.fetch = async (input, init) => {
    if (String(input).includes("/params/set")) {
      parameterWrites.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, rev: 100 }), {
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetchForParams(input, init);
  };
  const kinds = [
    ["params", ParamPaneShapeUtil, "paramsName"],
    ["pianoRoll", PianoRollShapeUtil, "rollName"],
    ["animationTimeline", AnimationEditorShapeUtil, "animationName"],
    ["drawing", DrawingShapeUtil, "drawingName"],
    ["sixSines", SixSinesShapeUtil, "synthName"],
    ["signal", SignalScopeShapeUtil, "name"],
  ] as const;
  const restorers = kinds.map(([, Util]) => {
    const original = Util.prototype.component;
    (Util.prototype as any).component = function (shape: any) {
      return (
        <Profiler
          id={shape.id}
          onRender={(id) => counts.set(id, (counts.get(id) ?? 0) + 1)}
        >
          {original.call(this, shape)}
        </Profiler>
      );
    };
    return () => {
      (Util.prototype as any).component = original;
    };
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  let editor: Editor | undefined;
  let seq = 10;
  const records: Record<string, any[]> = {};
  for (const [kind] of kinds)
    records[kind] = ["a", "b"].map((name) => {
      const common = { name, rev: 1, updatedAt: 1, updatedBy: "test" };
      switch (kind) {
        case "params":
          return { ...common, values: { gain: 0, pan: 0 }, meta: {} };
        case "pianoRoll":
          return {
            ...common,
            data: { notes: [] },
            canUndo: false,
            canRedo: false,
          };
        case "animationTimeline":
          return { ...common, data: { tracks: [], trackOrder: [] } };
        case "drawing":
          return {
            ...common,
            data: {
              version: 1,
              freehand: { nodes: [] },
              polygon: { nodes: [] },
              circle: { nodes: [] },
            },
          };
        case "sixSines":
          return { ...common, data: { preset, values: { "509": 0 } } };
        case "signal":
          return {
            ...common,
            value: 0,
            anchors: [],
            ended: false,
            unserializable: false,
          };
      }
    });
  try {
    flushSync(() =>
      root.render(
        <SyncRuntimeProvider>
          <div style={{ position: "fixed", inset: 0 }}>
            <Tldraw
              hideUi
              shapeUtils={kinds.map(([, Util]) => Util)}
              onMount={(value) => {
                editor = value;
              }}
            />
          </div>
        </SyncRuntimeProvider>,
      ),
    );
    for (let i = 0; !editor && i < 100; i++) await settle();
    assert(editor, "real tldraw editor mounted");
    socket.receive({ type: "sync", seq: ++seq, resets: records });
    await settle();
    editor!.createShapes(
      kinds.flatMap(([kind, Util, key], row) =>
        ["a", "b"].map((name, col) => ({
          id: createShapeId(kind + name),
          type: Util.type,
          x: col * 1350,
          y: row * 1200,
          props: { [key]: name },
        })),
      ),
    );
    editor!.zoomToFit({ animation: { duration: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    for (const [kind] of kinds)
      for (const name of ["a", "b"])
        assert(
          (counts.get(createShapeId(kind + name)) ?? 0) > 0,
          `real ${kind}/${name} shape mounted and committed`,
        );
    for (const [kind] of kinds) {
      const before = new Map(counts);
      records[kind][0] = { ...records[kind][0], rev: 2, updatedAt: 2 };
      if (kind === "params") records[kind][0].values = { gain: 1, pan: 0 };
      if (kind === "signal") records[kind][0].value = 1;
      if (kind === "sixSines")
        records[kind][0].data = {
          ...records[kind][0].data,
          values: { "509": 0.2 },
        };
      socket.receive({
        type: "sync",
        seq: ++seq,
        changes: [{ entityType: kind, name: "a", entity: records[kind][0] }],
      });
      await settle();
      for (const [other] of kinds)
        for (const name of ["a", "b"]) {
          const id = createShapeId(other + name),
            delta = (counts.get(id) ?? 0) - (before.get(id) ?? 0);
          assert(
            kind === other && name === "a" ? delta > 0 : delta === 0,
            `real ${kind}/a update: ${other}/${name} commits=${delta}`,
          );
        }
    }
    assert(
      parameterWrites.length === 0,
      "incoming engine params refresh controls without echoing writes",
    );
    const beforeMarker = new Map(counts);
    socket.receive({
      type: "sync",
      seq: ++seq,
      changes: [
        {
          entityType: "signal",
          name: "playhead",
          entity: {
            name: "playhead",
            value: 1,
            anchors: [{ type: "pianoRoll", name: "a" }],
            ended: false,
            unserializable: false,
          },
        },
      ],
    });
    await settle();
    for (const [kind] of kinds)
      for (const name of ["a", "b"]) {
        const id = createShapeId(kind + name),
          delta = (counts.get(id) ?? 0) - (beforeMarker.get(id) ?? 0);
        assert(
          kind === "pianoRoll" && name === "a" ? delta > 0 : delta === 0,
          `anchored signal only renders its roll: ${kind}/${name}`,
        );
      }
    assert(
      [...document.querySelectorAll("piano-roll-component")].some(
        (element: any) =>
          element
            .getPlayheadMarkers?.()
            .some(
              (marker: any) =>
                marker.id === "playhead" && marker.position === 1,
            ),
      ),
      "anchored signal marker reaches the actual piano-roll element",
    );
    socket.receive({
      type: "sync",
      seq: ++seq,
      changes: [{ entityType: "signal", name: "playhead", entity: null }],
    });
    await settle();
    assert(
      [...document.querySelectorAll("piano-roll-component")].every(
        (element: any) =>
          !element
            .getPlayheadMarkers?.()
            .some((marker: any) => marker.id === "playhead"),
      ),
      "deleted signal clears its marker",
    );
    const originalFetch = window.fetch;
    const edits: any[] = [];
    window.fetch = async (input, init) => {
      if (String(input).includes("/piano-roll/set")) {
        edits.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      // A roll removed and recreated after mount must still accept edits.
      socket.receive({
        type: "sync",
        seq: ++seq,
        changes: [{ entityType: "pianoRoll", name: "a", entity: null }],
      });
      await settle();
      assert(
        document.querySelectorAll("piano-roll-component").length === 1,
        "deleted roll removes its custom element",
      );
      socket.receive({
        type: "sync",
        seq: ++seq,
        changes: [
          { entityType: "pianoRoll", name: "a", entity: records.pianoRoll[0] },
        ],
      });
      await settle();
      const elements = [...document.querySelectorAll("piano-roll-component")];
      assert(elements.length === 2, "recreated roll mounts its custom element");
      for (const element of elements)
        element.dispatchEvent(
          new CustomEvent("notes-update", {
            detail: [[["n", { id: "n", pitch: 60, position: 0, duration: 1 }]]],
          }),
        );
      await settle();
      assert(
        edits.some((edit) => edit.name === "a") &&
          edits.some((edit) => edit.name === "b"),
        "both existing and recreated rolls send edits to their bound entity",
      );
    } finally {
      window.fetch = originalFetch;
    }
  } finally {
    window.fetch = originalFetchForParams;
    restorers.forEach((restore) => restore());
  }
}
