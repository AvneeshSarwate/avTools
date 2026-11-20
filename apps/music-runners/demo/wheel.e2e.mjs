// Wheel gestures over a roll: a trackpad pinch (ctrl+wheel) does not zoom the
// roll and goes to the canvas; Cmd+wheel zooms the roll's time and plain
// wheel scrolls it, and neither moves the canvas.
// Project "zz_pinch" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/wheel.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.route("**/api/projects/zz_pinch", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_pinch");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
await page.evaluate(() => {
  const mr = window.__musicRunners, ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  mr.clips.setClipNotes(id, [{ id: "a", pitch: 60, position: 1, duration: 1, velocity: 100 }]);
  ed.selectNone(); ed.setCamera({ x: -s.x + 20, y: -s.y + 20, z: 1 }); window.__id = id;
});
await sleep(800);
const state = () => page.evaluate(() => ({ view: window.__musicRunners.sourceRollHandles.get(window.__id).getView(), cam: (({ x, y, z }) => ({ x, y, z }))(window.__musicRunners.editor.getCamera()) }));
const box = await page.locator(".runner-shape .pr-container").first().boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
const s0 = await state();
// pinch: ctrl+wheel (what a trackpad pinch delivers)
await page.keyboard.down("Control");
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -20); await sleep(30); }
await page.keyboard.up("Control");
await sleep(200);
const s1 = await state();
assert.equal(s1.view.quarterNoteWidth, s0.view.quarterNoteWidth, "pinch does not zoom the roll");
assert.equal(s1.view.topRow, s0.view.topRow, "pinch does not scroll the roll");
assert.ok(s1.cam.z > s0.cam.z, "pinch zooms the canvas");
console.log("pinch: roll qnw", s0.view.quarterNoteWidth, "->", s1.view.quarterNoteWidth, "scroll", s0.view.startBeat, "->", s1.view.startBeat, s0.view.topRow, "->", s1.view.topRow, "| canvas z", s0.cam.z, "->", s1.cam.z);
await page.keyboard.down("Meta");
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -20); await sleep(30); }
await page.keyboard.up("Meta");
await sleep(200);
const s2 = await state();
assert.ok(s2.view.quarterNoteWidth > s1.view.quarterNoteWidth, "cmd+wheel zooms the roll");
assert.deepEqual(s2.cam, s1.cam, "cmd+wheel leaves the canvas");
console.log("cmd+wheel: roll qnw", s1.view.quarterNoteWidth, "->", s2.view.quarterNoteWidth);
await page.mouse.wheel(0, 40); await sleep(200);
const s3 = await state();
assert.notEqual(s3.view.topRow, s2.view.topRow, "wheel scrolls the roll");
assert.deepEqual(s3.cam, s2.cam, "wheel leaves the canvas");
console.log("plain wheel: topRow", s2.view.topRow, "->", s3.view.topRow);
console.log("WHEEL OK");
await browser.close();
