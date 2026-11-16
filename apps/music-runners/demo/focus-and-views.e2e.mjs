// Cmd-A scoping and focus (roll, tool row in the header, keyboard column,
// MPE envelope vs notes, text fields, instance controls, read-only rolls) and
// the Generated roll's view tools (Follow, wheel unfollows, Fit, snap back).
// Fake Web MIDI; project "zz_cmda" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/focus-and-views.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  class Port extends EventTarget { constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); } async open() {} async close() {} send() {} }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "IAC Driver Bus 1", "output")]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_cmda", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_cmda");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ctx = await page.evaluate(async () => {
  const mr = window.__musicRunners;
  const ed = mr.editor;
  await mr.midi.ensureMidi();
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  const notes = [60, 64, 67, 72].map((p, i) => ({ id: "n" + i, pitch: p, position: i * 2, duration: 1.5, velocity: 90,
    mpePressure: { points: [{ time: 0, value: 20 }, { time: 1, value: 90 }] } }));
  mr.clips.setClipNotes(s.id, notes);
  ed.selectNone();
  ed.setCamera({ x: -s.x + 20, y: -s.y + 40, z: 1 });
  window.__id = id;
  return { id, clipId: s.id };
});
await sleep(700);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).fitToContent());
await sleep(300);
const shape = page.locator(".runner-shape").first();
const container = shape.locator(".pr-container").first();
const sel = () => page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getSelectedIds().sort());
const pageText = () => page.evaluate(() => window.getSelection().toString().length);
const tlSel = () => page.evaluate(() => window.__musicRunners.editor.getSelectedShapeIds().length);
const notes = () => page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.clipsStore.clips[b].notes)), ctx.clipId);
const box = await container.boundingBox();

// 1. Notes mode: click the grid background, Cmd-A = all notes
await page.mouse.click(box.x + box.width - 20, box.y + 30);
await page.keyboard.press("ControlOrMeta+a");
await sleep(80);
assert.deepEqual(await sel(), ["n0", "n1", "n2", "n3"], "Cmd-A in the roll selects all notes");
assert.equal(await pageText(), 0, "no page text selected");
assert.equal(await tlSel(), 0, "tldraw did not select shapes");

// 2. a tool-row button in the header keeps keys in the roll: click Snap, deselect, Cmd-A
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes([]));
await shape.locator(".pr-snap-toggle").click();
await shape.locator(".pr-snap-toggle").click();
await page.keyboard.press("ControlOrMeta+a");
await sleep(80);
assert.equal((await sel()).length, 4, "Cmd-A after a tool-row click still selects notes");
assert.equal(await pageText(), 0);

// 3. keyboard column click focuses the roll
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes([]));
const gbox = await shape.locator(".pr-gutter").first().boundingBox();
await page.mouse.click(gbox.x + gbox.width - 6, gbox.y + 40);
await page.keyboard.press("ControlOrMeta+a");
await sleep(80);
assert.equal((await sel()).length, 4, "Cmd-A after clicking a key");

// 4. MPE mode: no envelope touched -> all notes; touch the pressure lane -> all its points
await shape.locator(".pr-mode-mpe").click();
await sleep(150);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n1"]));
await page.mouse.click(box.x + box.width - 20, box.y + 30); // grid background: deselect, envelope inactive
await page.keyboard.press("ControlOrMeta+a");
await sleep(80);
assert.equal((await sel()).length, 4, "MPE without an active envelope: all notes");
// click inside n1's column in the pressure lane (range click) -> pressure becomes active
const view = await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getView());
const xOf = (beat) => box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth;
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n1", "n2"]));
await sleep(80);
await page.mouse.click(xOf(2.75), box.y + 1 + 240 + 50);
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.press("Delete");
await sleep(100);
const after = await notes();
console.log("pressure after Cmd-A+Delete", after.map((n) => (n.mpePressure ? n.mpePressure.points.length : 0)));
assert.deepEqual(after.map((n) => (n.mpePressure ? n.mpePressure.points.length : 0)), [2, 0, 0, 2], "Cmd-A took the selected notes' pressure points");
assert.equal(after.length, 4, "no notes deleted");
await shape.locator(".pr-undo").click();
await shape.locator(".pr-mode-notes").click();

// 5. a text field keeps its own select-all
const degrees = shape.locator(".pr-control-panel .pr-scale-degrees"); // the roll tool row's (a scale param has one too)
await degrees.click();
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n0"]));
await degrees.focus();
await page.keyboard.press("ControlOrMeta+a");
const fieldSel = await degrees.evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
assert.equal(fieldSel[0], 0);
assert.equal(fieldSel[1], fieldSel[2], "the field's text is selected");
assert.deepEqual(await sel(), ["n0"], "note selection untouched");
await page.keyboard.press("Escape");

// 6. instance controls: no page select-all, no tldraw select-all
// (a click on a button does not move focus on macOS Chrome; focus it directly)
await shape.locator(".runner-shape__queue").focus();
await page.evaluate(() => window.getSelection().removeAllRanges());
await page.keyboard.press("ControlOrMeta+a");
await sleep(50);
assert.equal(await pageText(), 0, "no page text from instance controls");

// 7. Generated: Follow, wheel unfollows, Fit, Follow snaps back
await page.evaluate((id) => window.__musicRunners.playback.startPlay(id), ctx.id);
await sleep(800);
const genFollow = shape.locator(".runner-shape__follow-generated");
assert.equal(await genFollow.getAttribute("aria-checked"), "true");
const gen = shape.locator(".runner-section").nth(1).locator(".pr-container");
const gb = await gen.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.wheel(0, 300);
await sleep(200);
assert.equal(await genFollow.getAttribute("aria-checked"), "false", "scrolling the generated roll stops following");
// Generated roll: Cmd-A inside does nothing
await page.mouse.click(gb.x + 30, gb.y + 30);
await page.evaluate(() => window.getSelection().removeAllRanges());
await page.keyboard.press("ControlOrMeta+a");
assert.equal(await pageText(), 0, "read-only roll: no page select-all");
await shape.screenshot({ path: `${OUT}/gen-scrolled.png` });
await shape.locator(".runner-shape__fit-generated").click();
await sleep(200);
await shape.screenshot({ path: `${OUT}/gen-fit.png` });
await genFollow.click();
await sleep(200);
assert.equal(await genFollow.getAttribute("aria-checked"), "true");
await page.evaluate(() => window.__musicRunners.playback.stopAll());
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("CHECK2 OK");
await browser.close();
