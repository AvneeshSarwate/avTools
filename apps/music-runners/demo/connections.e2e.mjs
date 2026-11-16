// Connection arrows: default event type, duplicates, fan-out bends, routing
// once per target, send pulses, retyping from the label chooser, and the
// protected label. Fake Web MIDI; project "zz_conn" is never saved.
// With the dev server up (npm run dev):
//   NODE_PATH=$(npm root -g) node demo/connections.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 160)); });
await page.addInitScript(() => {
  class Port extends EventTarget { constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); } async open() {} async close() {} send() {} }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "IAC Driver Bus 1", "output")]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_conn", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_conn");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);

const ids = await page.evaluate(async () => {
  const mr = window.__musicRunners;
  const ed = mr.editor;
  await mr.midi.ensureMidi();
  const a = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const b = mr.shapes.createInstance(ed, "extender", { x: 1100, y: 0 });
  const c = mr.shapes.createInstance(ed, "extender", { x: 1100, y: 800 });
  for (const id of [a, b, c]) {
    const s = ed.getShape(id);
    ed.updateShape({ id, type: s.type, props: { showGenerated: false, showSource: false } });
  }
  ed.selectNone();
  return { a, b, c };
});
await sleep(300);
// Draw an arrow the way the arrow tool ends up: shape + two bindings.
const connect = (from, to) => page.evaluate(({ from, to }) => {
  const ed = window.__musicRunners.editor;
  const id = "shape:arrow_" + Math.random().toString(36).slice(2, 8);
  ed.run(() => {
    ed.createShape({ id, type: "arrow", x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } });
    ed.createBindings([
      { type: "arrow", fromId: id, toId: from, props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
      { type: "arrow", fromId: id, toId: to, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    ]);
  });
  return id;
}, { from, to });
const list = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__musicRunners.connections.list())));
const shape = (id) => page.evaluate((id) => JSON.parse(JSON.stringify(window.__musicRunners.editor.getShape(id))), id);

const ab1 = await connect(ids.a, ids.b);
await sleep(100);
let l = await list();
assert.equal(l.length, 1);
assert.equal(l[0].eventType, "trill", "default type from the sender's emits");
assert.equal((await shape(ab1)).props.bend, 0);

const ab2 = await connect(ids.a, ids.b);
const ba = await connect(ids.b, ids.a);
const ac = await connect(ids.a, ids.c);
await sleep(200);
l = await list();

const byId = Object.fromEntries(l.map((c) => [c.arrowId, c]));
assert.equal(byId[ab2].duplicateOf, ab1, "second a→b trill is a duplicate");
assert.equal(byId[ba].eventType, null, "extender emits nothing");
const bends = [ab1, ab2, ba].map(async (id) => (await shape(id)).props.bend);
const [b1, b2, b3] = await Promise.all(bends);
console.log("bends a→b, a→b, b→a:", b1, b2, b3);
assert.equal(b1, 0);
assert.notEqual(b2, 0);
// Bends are in each arrow's own direction: a reversed arrow overlaps when its bend is the negation.
assert.ok(b3 !== -b2 && b3 !== 0, "reverse arrow takes another slot");

// Labels on the canvas
await page.evaluate(() => { window.__musicRunners.editor.zoomToFit(); });
await sleep(400);
assert.equal(await page.locator(".connection-label").count(), 4);
assert.equal(await page.locator(".connection-label.is-duplicate").count(), 1);
assert.equal(await page.locator(".connection-label__none").count(), 1);

// Routing: once per target, pulses only on the arrows that carried it
const targets = await page.evaluate(({ a }) => window.__musicRunners.events.emitEvent(a, { type: "trill", pitch: 64, velocity: 90 }), ids);
assert.deepEqual([...targets].sort(), [ids.b, ids.c].sort(), "duplicate delivers once");
await sleep(60);
const pulsing = await page.evaluate(() => [...document.querySelectorAll(".is-pulsing")].map((n) => n.getAttribute("data-arrow")));
console.log("pulsing", pulsing);
assert.ok(pulsing.includes(ab1) && pulsing.includes(ac) && !pulsing.includes(ab2), "canonical arrows pulse, the duplicate does not");
await page.screenshot({ path: `${OUT}/conn-pulse.png` });

// Retype a→c: trill no longer reaches c
await page.evaluate((id) => window.__musicRunners.connections.setType(id, "other"), ac);
await sleep(100);
const t2 = await page.evaluate(({ a }) => window.__musicRunners.events.emitEvent(a, { type: "trill" }), ids);
assert.deepEqual(t2, [ids.b]);
// Arrow label edits are ignored on connections
await page.evaluate((id) => {
  const ed = window.__musicRunners.editor;
  ed.updateShape({ id, type: "arrow", props: { richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] } } });
}, ab1);
assert.equal(JSON.stringify((await shape(ab1)).props.richText).includes("hello"), false, "label text stays empty");
// Chooser on the label switches the type (pick from list)
await page.locator(`.connection-label[data-arrow="${ac}"] .ui-chooser`).click();
await sleep(150);
await page.screenshot({ path: `${OUT}/conn-chooser.png` });
await page.locator(".ui-chooser__option", { hasText: /^trill$/ }).click();
await sleep(150);
assert.equal((await shape(ac)).meta.eventType, "trill");
// Deleting the canonical arrow promotes the duplicate
await page.evaluate((id) => { window.__musicRunners.editor.deleteShapes([id]); }, ab1);
await sleep(100);
l = await list();
assert.equal(l.find((c) => c.arrowId === ab2).duplicateOf, null, "duplicate becomes the route");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("CONNECTIONS OK");
await browser.close();
