import { assertEquals } from "jsr:@std/assert@1";
import {
  type CanvasViewDispatchCodec,
  collectViewsFromCodecs,
  isRegisteredCanvasView,
  registeredCanvasViewChanged,
  registeredEntityRef,
} from "../../../livecode-tldraw/src/canvasViewRegistry.ts";

interface FakeShape {
  type: "fake-animation-view";
  id: string;
  name: string;
  x: number;
}

const fakeCodec: CanvasViewDispatchCodec = {
  isShape: (value): value is FakeShape =>
    Boolean(
      value && typeof value === "object" && "type" in value &&
        value.type === "fake-animation-view",
    ),
  collect: (shapes) => ({
    animationEditorViews: shapes
      .filter((shape): shape is FakeShape => fakeCodec.isShape(shape))
      .map((shape) => ({
        id: shape.id,
        animationName: shape.name,
        x: shape.x,
        y: 20,
        w: 300,
        h: 200,
      })),
  }),
  hasChanged: (before, after) =>
    (before as FakeShape).name !== (after as FakeShape).name ||
    (before as FakeShape).x !== (after as FakeShape).x,
  entityRef: (shape) => ({
    type: "animationTimeline",
    name: (shape as FakeShape).name,
  }),
};

Deno.test("a canvas codec supplies collection, identity, and change dispatch", () => {
  const shape: FakeShape = {
    type: "fake-animation-view",
    id: "shape:animation",
    name: "intro",
    x: 10,
  };
  const codecs = [fakeCodec];

  assertEquals(collectViewsFromCodecs(codecs, [shape, { type: "other" }]), {
    animationEditorViews: [{
      id: "shape:animation",
      animationName: "intro",
      x: 10,
      y: 20,
      w: 300,
      h: 200,
    }],
  });
  assertEquals(isRegisteredCanvasView(codecs, shape), true);
  assertEquals(registeredEntityRef(codecs, shape), {
    type: "animationTimeline",
    name: "intro",
  });
  assertEquals(registeredCanvasViewChanged(codecs, shape, { ...shape }), false);
  assertEquals(
    registeredCanvasViewChanged(codecs, shape, { ...shape, x: 11 }),
    true,
  );
  assertEquals(
    registeredCanvasViewChanged(codecs, shape, { type: "other" }),
    true,
  );
});
