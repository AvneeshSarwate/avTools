import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SignalEntity } from "@avtools/livecode-protocol";
import { signalPlayheadMarkers } from "../../../livecode-tldraw/src/signalPlayheadMarkers.ts";
import {
  advanceSignalScopeSamples,
  equalSignalPlayheadMarkers,
} from "../../../livecode-tldraw/src/signalRendering.ts";

function signal(
  name: string,
  value: unknown,
  type = "pianoRoll",
  anchorName = "main",
  extra: Partial<SignalEntity> = {},
): SignalEntity {
  return {
    name,
    value,
    anchors: [{ type, name: anchorName }],
    rev: 1,
    updatedAt: 1,
    updatedBy: "test",
    ...extra,
  };
}

Deno.test("signal playhead markers filter, normalize, and sort visible anchors", () => {
  const markers = signalPlayheadMarkers(
    {
      z: signal("z", { position: 3 }),
      a: signal("a", 1),
      wrongAnchor: signal("wrongAnchor", 2, "animationTimeline"),
      ended: signal("ended", 4, "pianoRoll", "main", { ended: true }),
      unavailable: signal("unavailable", 5, "pianoRoll", "main", {
        unserializable: true,
      }),
      infinite: signal("infinite", Number.POSITIVE_INFINITY),
      nonnumeric: signal("nonnumeric", { position: "6" }),
    },
    "pianoRoll",
    "main",
  );

  assertEquals(markers, [
    { id: "a", position: 1 },
    { id: "z", position: 3 },
  ]);
});

Deno.test("marker equality ignores unrelated signal and invisible metadata changes", () => {
  const before = signalPlayheadMarkers(
    {
      playhead: signal("playhead", 2),
    },
    "pianoRoll",
    "main",
  );
  const after = signalPlayheadMarkers(
    {
      playhead: signal("playhead", { position: 2 }, "pianoRoll", "main", {
        rev: 9,
        updatedAt: 99,
      }),
      unrelated: signal("unrelated", 17, "params", "other"),
    },
    "pianoRoll",
    "main",
  );

  assert(equalSignalPlayheadMarkers(before, after));
  assertFalse(
    equalSignalPlayheadMarkers(before, [{ id: "playhead", position: 3 }]),
  );
  assertFalse(
    equalSignalPlayheadMarkers(before, [{ id: "other", position: 2 }]),
  );
  assertFalse(equalSignalPlayheadMarkers(before, []));
});

Deno.test("scope history advances through numeric gaps, prunes, and caps samples", () => {
  const samples = [{ t: 0, v: 1 }, { t: 500, v: 2 }];
  assert(advanceSignalScopeSamples(samples, 1_200, 1, null, 4));
  assertEquals(samples, [{ t: 500, v: 2 }]);

  advanceSignalScopeSamples(samples, 1_300, 1, 3, 2);
  advanceSignalScopeSamples(samples, 1_400, 1, 4, 2);
  assertEquals(samples, [{ t: 1_300, v: 3 }, { t: 1_400, v: 4 }]);
  assertFalse(advanceSignalScopeSamples(samples, 1_450, 1, null, 2));
});
