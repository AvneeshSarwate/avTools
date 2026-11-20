// A runner sending to a Six Sines sends each note's expression (tuning,
// pressure, brightness) natively whether or not MPE Out is on: the MPE Out
// toggle shows on and is disabled for a Six Sines output, playback puts each
// note on its own channel, and the pitch curve arrives as tuning updates.
// Project "zz_ssmpe" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/sixsines-mpe.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { navigator.requestMIDIAccess = async () => Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }); });
await page.route("**/api/projects/zz_ssmpe", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_ssmpe");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
await page.evaluate(async () => {
  const { SixSinesOutput } = await import("/src/store/sixSinesOutput.ts");
  const log = (window.__ssLog = []);
  for (const name of ["noteOn", "noteOff", "setTuning", "channelPressure", "cc"]) {
    const original = SixSinesOutput.prototype[name];
    SixSinesOutput.prototype[name] = function (...args) { log.push([name, ...args]); return original.apply(this, args); };
  }
  const { createSixSinesShape } = await import("/src/shapes/SixSinesShape.tsx");
  const mr = window.__musicRunners, ed = mr.editor;
  const synth = createSixSinesShape(ed);
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { midiOutputName: "six-sines:" + synth, mpe: false, showGenerated: false } });
  mr.clips.setClipLoopLength(id, 4);
  mr.clips.setClipNotes(id, [
    { id: "a", pitch: 60, position: 0, duration: 1, velocity: 100, mpePitch: { points: [{ time: 0, pitchOffset: 0 }, { time: 1, pitchOffset: 2 }] }, mpePressure: { points: [{ time: 0, value: 30 }, { time: 1, value: 90 }] } },
    { id: "b", pitch: 64, position: 0, duration: 1, velocity: 100 },
  ]);
  ed.selectNone(); ed.setCamera({ x: -s.x + 20, y: -s.y + 20, z: 0.8 });
  window.__id = id;
});
await sleep(2500);
const toggle = page.locator(".runner-shape__mpe-out").first();
assert.equal(await toggle.isDisabled(), true, "MPE Out is fixed for a Six Sines output");
assert.equal(await toggle.getAttribute("aria-checked"), "true", "MPE Out shows on");
await page.evaluate(() => window.__musicRunners.playback.startPlay(window.__id));
await sleep(1600);
await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
await sleep(200);
const log = await page.evaluate(() => window.__ssLog);
const ons = log.filter((e) => e[0] === "noteOn");
console.log("note-ons", JSON.stringify(ons.slice(0, 4)));
const tunings = log.filter((e) => e[0] === "setTuning");
const chA = ons.find((e) => e[2] === 60)?.[1];
const chB = ons.find((e) => e[2] === 64)?.[1];
assert.ok(chA !== undefined && chB !== undefined && chA !== chB, "each note on its own channel");
assert.ok(chA !== 0 && chB !== 0, "member channels, not channel 0");
const bendA = tunings.filter((e) => e[1] === chA).map((e) => e[2]);
console.log("tuning on note a's channel", bendA.length, "updates, first", bendA[0], "max", Math.max(...bendA));
assert.ok(bendA.length > 5 && Math.max(...bendA) > 1.5, "the pitch curve arrives as tuning updates");
const pressA = log.filter((e) => e[0] === "channelPressure" && e[1] === chA).map((e) => e[2]);
assert.ok(Math.max(...pressA) > 60, "pressure curve sent");
assert.ok(tunings.filter((e) => e[1] === chB).every((e) => e[2] === 0), "the plain note stays in tune");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("SIXSINES MPE OK");
await browser.close();
