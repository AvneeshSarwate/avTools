// Preview auto-regenerate: while the Preview roll is open (and the Auto toggle
// is on), changes to params, notes or note tags re-run the dry run, throttled
// to ~15 Hz; no events are emitted. Project "zz_autoregen" is never saved.
// With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/auto-regenerate.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { navigator.requestMIDIAccess = async () => Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }); });
await page.route("**/api/projects/zz_autoregen", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_autoregen");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ctx = await page.evaluate(() => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "arp", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false } });
  mr.clips.setClipNotes(s.id, [60, 64, 67].map((pitch, i) => ({ id: `n${i}`, pitch, position: 0, duration: 4, velocity: 100 })));
  ed.selectNone(); ed.setCamera({ x: 20, y: 40, z: 0.8 }); window.__id = id;
  // Count every new preview the store receives.
  window.__previews = 0;
  let last = null;
  const tick = () => { const p = mr.stores.playbackStore.instances[s.id]?.preview ?? null; if (p !== last) { if (p) { window.__previews++; (window.__times ??= []).push(performance.now()); } last = p; } requestAnimationFrame(tick); };
  tick();
  return { id, clipId: s.id };
});
await sleep(400);
const previews = () => page.evaluate(() => window.__previews);
const preview = () => page.evaluate((clipId) => JSON.parse(JSON.stringify(window.__musicRunners.stores.playbackStore.instances[clipId]?.preview ?? null)), ctx.clipId);
const setParams = (patch) => page.evaluate(({ id, patch }) => {
  const ed = window.__musicRunners.editor; const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { params: { ...s.props.params, ...patch } } });
}, { id: ctx.id, patch });
const eventsNow = () => page.evaluate(() => JSON.stringify(window.__musicRunners.stores.eventLogStore.byShape));

// Closed pane: edits do nothing
await setParams({ gate: 0.5 });
await sleep(200);
assert.equal(await preview(), null, "no preview while the pane is closed");

// Opening the pane generates right away
const shape = page.locator(".runner-shape").first();
await shape.locator(".runner-section__title", { hasText: "preview" }).click().catch(async () => {
  await page.evaluate((id) => { const ed = window.__musicRunners.editor; const s = ed.getShape(id); ed.updateShape({ id, type: s.type, props: { showPreview: true } }); }, ctx.id);
});
await sleep(300);
if (!(await preview())) {
  await page.evaluate((id) => { const ed = window.__musicRunners.editor; const s = ed.getShape(id); ed.updateShape({ id, type: s.type, props: { showPreview: true } }); }, ctx.id);
  await sleep(300);
}
const first = await preview();
assert.ok(first, "opening the pane fills the preview");
const events0 = await eventsNow();

// A 1 s "slider drag": 60 changes; ~15 regenerates, ending on the last value
const before = await previews();
await page.evaluate((id) => new Promise((done) => {
  const ed = window.__musicRunners.editor; let i = 0;
  const timer = setInterval(() => {
    const s = ed.getShape(id);
    ed.updateShape({ id, type: s.type, props: { params: { ...s.props.params, cycle: 1 + i * 0.25 } } });
    if (++i === 60) { clearInterval(timer); done(); }
  }, 1000 / 60);
}), ctx.id);
await sleep(200);
const during = (await previews()) - before;
const times = await page.evaluate((n) => window.__times.slice(-n), during);
const gaps = times.slice(1).map((t, i) => Math.round(t - times[i]));
console.log("span ms", Math.round(times.at(-1) - times[0]), "gaps", gaps.join(" "));
console.log("regenerates for 60 changes over ~1s:", during);
assert.ok(during >= 8 && during <= 25, `throttled to ~15 Hz (got ${during})`);
assert.equal((await preview()).loopLength, 1 + 59 * 0.25, "trailing run lands on the final value");

// Note edits regenerate too
await page.evaluate((clipId) => window.__musicRunners.clips.setClipNotes(clipId, [62, 65, 69].map((pitch, i) => ({ id: `n${i}`, pitch, position: 0, duration: 4, velocity: 100 }))), ctx.clipId);
await sleep(200);
assert.ok((await preview()).notes.some((n) => n.pitch === 62), "note change regenerated the preview");
assert.equal(await eventsNow(), events0, "auto-regenerate emits no events");

// Auto toggle off: no updates; the manual button still works
const auto = shape.locator(".runner-shape__auto-regenerate");
assert.equal(await auto.getAttribute("aria-checked"), "true");
await auto.click();
await sleep(100);
assert.equal(await auto.getAttribute("aria-checked"), "false");
const off0 = await previews();
await setParams({ cycle: 3 });
await sleep(200);
assert.equal(await previews(), off0, "no auto-regenerate with the toggle off");
await shape.locator(".runner-shape__regenerate").click();
await sleep(200);
assert.equal(await previews(), off0 + 1, "manual regenerate still works");
assert.equal((await preview()).loopLength, 3);
// Toggling back on regenerates from the current input
await auto.click();
await sleep(200);
assert.equal(await previews(), off0 + 2, "turning Auto on regenerates");
await shape.screenshot({ path: `${OUT}/auto-regenerate.png` });

assert.deepEqual(errors, [], "no page errors");
console.log("auto-regenerate e2e: ok");
await browser.close();
