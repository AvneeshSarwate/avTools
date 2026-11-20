// Note resizing without handle dots: near a note's left/right edge the cursor
// becomes a resize cursor; pressing there resizes (an unselected note is
// selected first; a selection resizes together). Below one grid step the edge
// follows the pointer, so notes can be shorter than the grid. MPE mode
// resizes from edges too.
// Project "zz_resize" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/resize.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { navigator.requestMIDIAccess = async () => Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }); });
await page.route("**/api/projects/zz_resize", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_resize");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const clipId = await page.evaluate(() => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false } });
  mr.clips.setClipNotes(s.id, [
    ...[60, 64, 67].map((p, i) => ({ id: "n" + i, pitch: p, position: i * 2, duration: 1, velocity: 100 })),
    { id: "s", pitch: 72, position: 7, duration: 0.25, velocity: 100 },
  ]);
  ed.selectNone(); ed.setCamera({ x: 20, y: 40, z: 1 }); window.__id = id;
  return s.id;
});
await sleep(700);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).fitToContent());
await sleep(300);
const shape = page.locator(".runner-shape").first();
const box = await shape.locator(".pr-container").first().boundingBox();
const view = await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getView());
const at = (beat, pitch) => ({ x: box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth, y: box.y + 1 + (127 - pitch - view.topRow) * view.noteHeight + view.noteHeight / 2 });
const cursor = () => page.evaluate(() => getComputedStyle(document.querySelector(".runner-shape .konvajs-content")).cursor);
const note = (id) => page.evaluate(({ b, id }) => JSON.parse(JSON.stringify(window.__musicRunners.stores.clipsStore.clips[b].notes.find((n) => n.id === id))), { b: clipId, id });

// hover: middle of a note = normal cursor; 2px inside either edge = resize cursor
let p = at(2.5, 64);
await page.mouse.move(p.x, p.y);
await sleep(50);
assert.notEqual(await cursor(), "ew-resize", "middle of a note: the normal cursor");
p = at(3, 64);
await page.mouse.move(p.x - 2, p.y);
await sleep(50);
assert.equal(await cursor(), "ew-resize", "right edge");
p = at(2, 64);
await page.mouse.move(p.x + 2, p.y);
await sleep(50);
assert.equal(await cursor(), "ew-resize", "left edge");
await page.screenshot({ path: `${OUT}/resize-hover.png`, clip: { x: box.x, y: box.y, width: box.width, height: 200 } });
// press the right edge of the unselected n1 and drag one beat
p = at(3, 64);
await page.mouse.move(p.x - 2, p.y);
await page.mouse.down();
await page.mouse.move(p.x - 2 + view.quarterNoteWidth, p.y, { steps: 6 });
await page.mouse.up();
await sleep(100);
assert.equal((await note("n1")).duration, 2, "resized by one beat");
assert.deepEqual(await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getSelectedIds()), ["n1"], "the note got selected");
// a selection resizes together from one note's edge
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n0", "n2"]));
await sleep(400);
p = at(1, 60);
await page.mouse.move(p.x - 2, p.y);
await page.mouse.down();
await page.mouse.move(p.x - 2 + view.quarterNoteWidth / 2, p.y, { steps: 6 });
await page.mouse.up();
await sleep(100);
assert.equal((await note("n0")).duration, 1.5);
assert.equal((await note("n2")).duration, 1.5, "the other selected note too");
// shorter than the grid (1/16 = 0.25): a 1/16 note's edges follow the pointer
const step = 0.25 * view.quarterNoteWidth;
async function edgeDrag(beat, inset, dx) {
  const q = at(beat, 72);
  await page.mouse.move(q.x + inset, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + inset + dx, q.y, { steps: 6 });
  await page.mouse.up();
  await sleep(100);
}
await edgeDrag(7.25, -2, -step * 0.6);
let sn = await note("s");
console.log("right edge in", sn.position, sn.duration);
assert.equal(sn.position, 7, "the start stays");
assert.ok(Math.abs(sn.duration - 0.1) < 0.01, "right edge shrinks below the grid");
await shape.locator(".pr-undo").click();
await sleep(100);
await edgeDrag(7, 2, step * 0.6);
sn = await note("s");
console.log("left edge in", sn.position, sn.duration);
assert.ok(Math.abs(sn.position + sn.duration - 7.25) < 1e-9, "the end stays");
assert.ok(Math.abs(sn.duration - 0.1) < 0.01, "left edge shrinks below the grid");
await shape.locator(".pr-undo").click();
await sleep(100);
// dragging an edge past the other one stops at the minimum length, without
// moving the note (right edge leftwards: it stays on the stage, which is the
// only place Konva tracks the pointer)
await edgeDrag(7.25, -2, -step * 1.2);
sn = await note("s");
console.log("right edge past the start", sn.position, sn.duration);
assert.equal(sn.duration, 1 / 64);
assert.equal(sn.position, 7, "the start still stays");
await shape.locator(".pr-undo").click();
await sleep(100);
// MPE mode resizes from edges too
await shape.locator(".pr-mode-mpe").click();
await sleep(150);
p = at(4, 67);
await page.mouse.move(p.x + 2, p.y);
await sleep(50);
assert.equal(await cursor(), "ew-resize", "MPE mode: edge cursor");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("RESIZE OK");
await browser.close();
