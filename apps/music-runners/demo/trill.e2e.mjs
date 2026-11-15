// Trill trigger tag: probability and a list of trill note counts (one picked
// uniformly per firing, sent as the event's count; empty: the receiver's
// default). Fake Web MIDI; project "zz_trill" is never saved. Dev server up:
//   NODE_PATH=$(npm root -g) node demo/trill.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  class Port extends EventTarget { constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); } async open() {} async close() {} send() {} }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "IAC Driver Bus 1", "output")]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_trill", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_trill");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ctx = await page.evaluate(async () => {
  const mr = window.__musicRunners;
  const ed = mr.editor;
  await mr.midi.ensureMidi();
  mr.clock.setBpm(480);
  const a = mr.shapes.createInstance(ed, "variants", undefined, { x: 0, y: 0 });
  const b = mr.shapes.createInstance(ed, "extender", undefined, { x: 1000, y: 0 });
  const sa = ed.getShape(a), sb = ed.getShape(b);
  mr.banks.setBankNotes(sa.props.bankId, [{ id: "t0", pitch: 72, position: 0, duration: 0.5, velocity: 100 }, { id: "t1", pitch: 60, position: 1, duration: 0.5, velocity: 100 }]);
  mr.banks.setBankLoopLength(sa.props.bankId, 2);
  mr.banks.setBankNotes(sb.props.bankId, [{ id: "e0", pitch: 64, position: 0, duration: 0.5, velocity: 100 }]);
  mr.banks.setBankLoopLength(sb.props.bankId, 2);
  const arrow = "shape:arrow_t";
  ed.run(() => {
    ed.createShape({ id: arrow, type: "arrow", x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } });
    ed.createBindings([
      { type: "arrow", fromId: arrow, toId: a, props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
      { type: "arrow", fromId: arrow, toId: b, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    ]);
  });
  ed.selectNone();
  ed.setCamera({ x: 20, y: 40, z: 1 });
  window.__a = a;
  return { a, b, bankA: sa.props.bankId };
});
await sleep(600);
// Tag t0 as a trill trigger through the tag editor and type "3 4 5"
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__a).selectNotes(["t0"]));
// By name: the two instances' order in the DOM is not fixed
const shapeA = page.locator(".runner-shape", { has: page.locator(".runner-shape__name", { hasText: "Variants" }) });
await shapeA.locator(".pr-metadata-toggle").click();
await sleep(150);
await shapeA.locator(".tag-chip", { hasText: "trill trigger" }).click();
await sleep(150);
await shapeA.screenshot({ path: `${OUT}/trill-tag-editor.png` });
const notesField = shapeA.locator(".tag-row", { hasText: "trill trigger" }).locator("input.ui-text");
await notesField.click();
await notesField.fill("3 4 5");
await notesField.press("Enter");
await sleep(150);
const tag = await page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.banksStore.banks[b].notes.find((n) => n.id === "t0").metadata)), ctx.bankA);
console.log("trill tag", JSON.stringify(tag));
assert.deepEqual(tag.trill, { probability: 1, notes: [3, 4, 5] });
// Run both; collect the counts the extender received
await page.evaluate(({ a, b }) => { window.__musicRunners.playback.startRun(b); window.__musicRunners.playback.startRun(a); }, ctx);
await sleep(6000);
const got = await page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.eventLogStore.byShape[b] ?? [])), ctx.b);
const logs = await page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.playbackStore.instances[b].logs)), ctx.b);
console.log("received counts", got.map((e) => e.event.count), "extender log", logs.slice(0, 3));
assert.ok(got.length >= 5, "trills fired");
assert.ok(got.every((e) => [3, 4, 5].includes(e.event.count)), "count picked from the list");
assert.ok(new Set(got.map((e) => e.event.count)).size >= 2, "picked at random");
assert.ok(logs.some((l) => /x[345]$/.test(l)), "extender played the requested count");
// probability 0: no more trills
await page.evaluate((b) => {
  const mr = window.__musicRunners;
  const bank = mr.stores.banksStore.banks[b];
  mr.banks.setBankNotes(b, bank.notes.map((n) => n.id === "t0" ? { ...JSON.parse(JSON.stringify(n)), metadata: { trill: { probability: 0, notes: [3, 4, 5] } } } : JSON.parse(JSON.stringify(n))));
  mr.stores.eventLogStore.byShape[Object.keys(mr.stores.eventLogStore.byShape)[0]] = [];
}, ctx.bankA);
await page.evaluate((b) => { window.__musicRunners.stores.eventLogStore.byShape[b] = []; }, ctx.b);
await sleep(3000);
const after = await page.evaluate((b) => (window.__musicRunners.stores.eventLogStore.byShape[b] ?? []).length, ctx.b);
console.log("events at probability 0", after);
assert.equal(after, 0);
// empty list: no count sent (receiver's param)
await page.evaluate((b) => {
  const mr = window.__musicRunners;
  const bank = mr.stores.banksStore.banks[b];
  mr.banks.setBankNotes(b, bank.notes.map((n) => n.id === "t0" ? { ...JSON.parse(JSON.stringify(n)), metadata: { trill: { probability: 1, notes: [] } } } : JSON.parse(JSON.stringify(n))));
}, ctx.bankA);
await sleep(2000);
const plain = await page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.eventLogStore.byShape[b] ?? [])), ctx.b);
console.log("counts with empty list", plain.map((e) => e.event.count));
assert.ok(plain.length > 0 && plain.every((e) => e.event.count === undefined));
await page.evaluate(() => window.__musicRunners.playback.stopAll());
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("TRILL OK");
await browser.close();
