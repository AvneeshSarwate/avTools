// Run with Node: node packages/six-sines/tests/note-expression.mjs [preset.sxsnp]
// (defaults to the packaged MPE factory preset "Exp Bowed Glass", which routes
// both MPE Pressure and MPE Timbre).
// Checks that per-note CLAP pressure and brightness expressions reach the
// synth's MPE Pressure / Timbre mod sources in the distributed Wasm: the same
// note rendered at expression 0 and 1 must produce different audio under a
// preset whose mod matrix uses them. Tuning is checked as a control.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import createModule from "../six-sines.js";

const PRESSURE = 6;
const BRIGHTNESS = 5;
const TUNING = 2;
const FRAMES = 24576;
const presetPath = process.argv[2] ??
  new URL("../ui/presets/MPE/Exp Bowed Glass.sxsnp", import.meta.url);

const wasm = await createModule();

/** Render one held note with a fixed note expression, returning left PCM. */
async function render(expressionId, value, presetBytes) {
  const handle = wasm._sx_create(48000);
  assert(handle);
  const allocations = [];
  const alloc = (bytes) => {
    const p = wasm._malloc(bytes);
    assert(p);
    allocations.push(p);
    return p;
  };
  try {
    if (presetBytes) {
      const at = alloc(presetBytes.length);
      wasm.HEAPU8.set(presetBytes, at);
      assert.equal(
        wasm._sx_load_preset_utf8(handle, at, presetBytes.length),
        1,
        "preset loads",
      );
    }
    const events = [
      { frame: 0, type: 1, noteId: 7, key: 60, expressionId: 0, value: 0.8 },
      { frame: 0, type: 3, noteId: 7, key: 60, expressionId, value },
    ];
    const size = wasm._sx_event_sizeof();
    const ptr = alloc(size * events.length);
    const left = alloc(FRAMES * 4);
    const right = alloc(FRAMES * 4);
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
      view.setUint32(at + 20, 0, true);
      view.setInt32(at + 24, e.expressionId, true);
      view.setFloat64(at + 32, e.value, true);
    });
    assert.equal(
      wasm._sx_process(handle, FRAMES, 0, 0, left, right, ptr, events.length),
      1,
    );
    return Float32Array.from(
      wasm.HEAPF32.subarray(left / 4, left / 4 + FRAMES),
    );
  } finally {
    for (const p of allocations) wasm._free(p);
    wasm._sx_destroy(handle);
  }
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

const presetBytes = new Uint8Array(await readFile(presetPath));
const results = {};
for (const [name, id] of Object.entries({ PRESSURE, BRIGHTNESS, TUNING })) {
  const low = await render(id, 0, presetBytes);
  const high = await render(id, 1, presetBytes);
  results[name] = {
    rmsLow: rms(low.subarray(4096)),
    rmsHigh: rms(high.subarray(4096)),
    maxDiff: maxDiff(low.subarray(4096), high.subarray(4096)),
  };
}
console.log(JSON.stringify(results, null, 2));

assert(results.TUNING.maxDiff > 1e-3, "tuning (control) changes the audio");
assert(results.PRESSURE.rmsLow > 1e-5, "note is audible");
assert(
  results.PRESSURE.maxDiff > 1e-3,
  "per-note pressure expression changes the audio",
);
assert(
  results.BRIGHTNESS.maxDiff > 1e-3,
  "per-note brightness expression changes the audio",
);
console.log(
  "PASS: per-note pressure and brightness expressions reach the MPE mod sources.",
);
