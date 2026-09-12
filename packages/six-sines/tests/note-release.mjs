// Run with Node. This tests the distributed Wasm, not a mock voice allocator.
import assert from "node:assert/strict";
import createModule from "../six-sines.js";
const wasm = await createModule();
const handle = wasm._sx_create(48000);
const allocations = [];
const alloc = (bytes) => {
  const p = wasm._malloc(bytes);
  assert(p);
  allocations.push(p);
  return p;
};
const event = (frame, type, fields) => ({
  frame,
  type,
  noteId: -1,
  key: -1,
  paramId: 0,
  expressionId: 0,
  value: 0,
  ...fields,
});
const rms = (signal, from, to) =>
  Math.sqrt(
    signal.subarray(from, to).reduce((sum, x) => sum + x * x, 0) / (to - from),
  );
try {
  assert(handle);
  const events = [
    ...Object.entries({
      500: .5,
      506: 1,
      507: 1,
      522: 0,
      523: 0,
      526: 64,
      529: 0,
      532: 0,
    }).map(([paramId, value]) =>
      event(0, 4, { paramId: Number(paramId), value })
    ),
    event(512, 1, { noteId: 101, key: 60, value: .8 }),
    event(512, 3, { noteId: 101, key: 60, expressionId: 1, value: 0 }),
    event(8192, 2, { noteId: 101, key: 60 }),
    event(8192, 1, { noteId: 102, key: 60, value: .8 }),
    event(8192, 3, { noteId: 102, key: 60, expressionId: 1, value: 1 }),
  ];
  const size = wasm._sx_event_sizeof();
  assert.equal(size, 40);
  const ptr = alloc(size * events.length),
    left = alloc(24576 * 4),
    right = alloc(24576 * 4);
  const view = new DataView(wasm.HEAPU8.buffer, ptr, size * events.length);
  events.forEach((e, i) => {
    const at = i * size;
    view.setUint32(at, e.frame, true);
    view.setUint32(at + 4, e.type, true);
    view.setInt32(at + 8, e.noteId, true);
    view.setInt16(at + 12, 0, true);
    view.setInt16(at + 14, 0, true);
    view.setInt16(at + 16, e.key, true);
    view.setInt16(at + 18, 0, true);
    view.setUint32(at + 20, e.paramId, true);
    view.setInt32(at + 24, e.expressionId, true);
    view.setFloat64(at + 32, e.value, true);
  });
  assert.equal(
    wasm._sx_process(handle, 24576, 0, 0, left, right, ptr, events.length),
    1,
  );
  const l = wasm.HEAPF32.subarray(left / 4, left / 4 + 24576),
    r = wasm.HEAPF32.subarray(right / 4, right / 4 + 24576);
  assert(rms(l, 4096, 7168) > 1e-5, "initial left voice audible");
  assert(rms(r, 4096, 7168) < 1e-7, "no right voice before retrigger");
  assert(
    rms(l, 14336, 17408) > 1e-5,
    "old same-pitch voice remains audible in release",
  );
  assert(
    rms(r, 14336, 17408) > 1e-5,
    "new same-pitch voice is independently audible",
  );
  console.log(
    "PASS: distributed Six Sines retains the old release tail alongside a fresh same-pitch note ID.",
  );
} finally {
  for (const p of allocations) wasm._free(p);
  if (handle) wasm._sx_destroy(handle);
}
