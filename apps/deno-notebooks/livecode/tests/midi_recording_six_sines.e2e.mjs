// Run from apps/deno-notebooks: node livecode/tests/midi_recording_six_sines.e2e.mjs
// Requires the built livecode-tldraw UI. Only a temporary project copy is edited.
//
// Seeds feature-midi-recording-six-sines with a take whose notes carry pitch,
// pressure and timbre curves, bakes it, and runs the real Six Sines Wasm in
// headless Chromium. Checks the player's worklet messages (note-on/off with
// fresh IDs; tuning/pressure/brightness note expressions following the curves)
// and that audio is produced.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "midi-recording-six-sines-"));
const project = tmp + "/project";
cpSync(
  root + "/apps/livecode-tldraw/example-projects/feature-midi-recording-six-sines",
  project,
  { recursive: true },
);

// A two-note take: note A bends up 2 semitones and swells in pressure; note B
// sweeps timbre down. Beats are seconds at the default 60 bpm.
const take = {
  notes: [
    {
      id: "a",
      pitch: 60,
      position: 0,
      duration: 1,
      velocity: 100,
      mpePitch: { points: [{ time: 0, pitchOffset: 0 }, { time: 1, pitchOffset: 2 }] },
      mpePressure: { points: [{ time: 0, value: 0 }, { time: 1, value: 127 }] },
    },
    {
      id: "b",
      pitch: 64,
      position: 0.5,
      duration: 1,
      velocity: 90,
      mpeTimbre: { points: [{ time: 0, value: 127 }, { time: 1, value: 0 }] },
    },
  ],
};
mkdirSync(project + "/data/pianoRoll", { recursive: true });
writeFileSync(
  project + "/data/pianoRoll/take.json",
  JSON.stringify({
    type: "pianoRoll",
    name: "six-sines-recording/take",
    savedAt: "2026-09-24T00:00:00Z",
    data: take,
  }),
);
const manifestPath = project + "/project.avtools-livecode.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.data.push({
  type: "pianoRoll",
  name: "six-sines-recording/take",
  path: "data/pianoRoll/take.json",
});
writeFileSync(manifestPath, JSON.stringify(manifest));

const bake = spawnSync("deno", [
  "run",
  "--allow-all",
  "livecode/browser_host/bake_project.ts",
  "--project",
  project,
  "--out",
  tmp + "/site",
  "--ui",
  root + "/apps/livecode-tldraw/dist",
], { cwd: root + "/apps/deno-notebooks", encoding: "utf8" });
if (bake.status) throw Error(bake.stderr + bake.stdout);
console.log("Baked", tmp);

const types = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  try {
    const pathname = new URL(req.url, "http://local").pathname;
    const file = tmp + "/site" +
      (pathname === "/" ? "/index.html" : decodeURIComponent(pathname));
    const body = readFileSync(file);
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__batches = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...args) {
    if (message?.type === "eventsNow") {
      window.__batches.push({
        time: performance.now(),
        events: structuredClone(message.events),
      });
    }
    return post.call(this, message, ...args);
  };
  const Native = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Native {
    constructor(ctx, name, opts) {
      super(ctx, name, opts);
      if (name === "six-sines") {
        window.__audioAnalyser = ctx.createAnalyser();
        this.connect(window.__audioAnalyser);
      }
    }
  };
});
context.setDefaultTimeout(15000);
const engine = await context.newPage();
const errors = [];
engine.on("pageerror", (e) => errors.push(String(e)));
engine.on("console", (m) => {
  if (
    m.type() === "error" && !m.text().includes("WebSocket") &&
    !m.text().includes("module script")
  ) errors.push(m.text());
});

try {
  await engine.goto(origin + "/engine/engine.html");
  // Wait for a full first pass: both note-offs sent.
  await engine.waitForFunction(
    () =>
      window.__batches.flatMap((b) => b.events).filter((e) => e.type === 2)
        .length >= 2,
    null,
    { timeout: 30000 },
  );
  const events = (await engine.evaluate(() => window.__batches)).flatMap((b) =>
    b.events
  );
  const ons = events.filter((e) => e.type === 1);
  const idA = ons.find((e) => e.key === 60)?.noteId;
  const idB = ons.find((e) => e.key === 64)?.noteId;
  assert(idA !== undefined && idB !== undefined, "both notes start");
  assert.notEqual(idA, idB, "each note gets its own note ID");

  const expr = (noteId, expressionId) =>
    events
      .filter((e) =>
        e.type === 3 && e.noteId === noteId && e.expressionId === expressionId
      )
      .map((e) => e.value);
  const TUNING = 2, BRIGHTNESS = 5, PRESSURE = 6;
  const tuningA = expr(idA, TUNING);
  const pressureA = expr(idA, PRESSURE);
  const timbreB = expr(idB, BRIGHTNESS);
  console.log({
    tuningA: [tuningA[0], tuningA.at(-1), tuningA.length],
    pressureA: [pressureA[0], pressureA.at(-1), pressureA.length],
    timbreB: [timbreB[0], timbreB.at(-1), timbreB.length],
  });

  // Curves are followed over the note: start at the first point, rise/fall
  // monotonically, and end near the last point (last tick is just before t=1).
  const monotonic = (xs, dir) =>
    xs.every((x, i) => i === 0 || dir * (x - xs[i - 1]) >= -1e-9);
  assert(tuningA.length > 20, "tuning is streamed while note A is held");
  assert.equal(tuningA[0], 0, "tuning starts at the first point");
  assert(tuningA.at(-1) > 1.8 && tuningA.at(-1) <= 2, "tuning reaches ~+2 st");
  assert(monotonic(tuningA, 1), "tuning follows the rising curve");
  assert.equal(pressureA[0], 0, "pressure starts at 0");
  assert(pressureA.at(-1) > 0.9 && pressureA.at(-1) <= 1, "pressure reaches ~1");
  assert(monotonic(pressureA, 1), "pressure follows the rising curve");
  assert.equal(timbreB[0], 1, "brightness starts at 127/127");
  assert(timbreB.at(-1) < 0.1, "brightness falls to ~0");
  assert(monotonic(timbreB, -1), "brightness follows the falling curve");
  assert.equal(expr(idA, BRIGHTNESS).length, 0, "no timbre sent for note A");
  assert.equal(expr(idB, PRESSURE).length, 0, "no pressure sent for note B");
  assert.equal(expr(idB, TUNING).length, 0, "no tuning sent for note B");

  // Each note's expressions stop at its note-off.
  const offIndex = (id) =>
    events.findIndex((e) => e.type === 2 && e.noteId === id);
  const lastExprIndex = (id) =>
    events.findLastIndex((e) => e.type === 3 && e.noteId === id);
  assert(lastExprIndex(idA) < offIndex(idA), "no expressions after A's note-off");
  assert(lastExprIndex(idB) < offIndex(idB), "no expressions after B's note-off");

  // The looping player starts a second pass with fresh IDs, and audio flows.
  await engine.waitForFunction(() =>
    window.__batches.flatMap((b) => b.events).filter((e) => e.type === 1)
      .length >= 4
  );
  await engine.waitForFunction(() => {
    const a = window.__audioAnalyser;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    return Math.max(...buf.map(Math.abs)) > 1e-5;
  });
  assert.deepEqual(errors, [], "no page errors");
  console.log(
    "PASS: Six Sines take player streams per-note pitch/pressure/timbre expressions and plays audio.",
  );
} finally {
  await browser.close();
  server.close();
}
