// Each runner instance owns its clip. Duplicating an instance (right-click
// Duplicate, Cmd-D) or pasting a copied one gives the copy its own copy of
// the clip, so the two diverge, and the next free name ("variants 2").
// Undo/redo and undoing a delete keep the clip. Pasting uses the clip as it
// was when copied. Project "zz_dup" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/duplicate.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { navigator.requestMIDIAccess = async () => Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }); });
await page.route("**/api/projects/zz_dup", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_dup");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const TAGGED = [{ id: "a", pitch: 60, position: 0, duration: 1, velocity: 100, metadata: { trill: { probability: 0.5, notes: [3, 4] } } }];
await page.evaluate((notes) => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false, showSource: false } });
  mr.clips.setClipNotes(id, notes);
  mr.clips.setClipLoopLength(id, 8);
  ed.selectNone(); ed.setCamera({ x: 60, y: 120, z: 0.8 }); window.__id = id;
}, TAGGED);
await sleep(500);
const instances = () => page.evaluate(() => window.__musicRunners.editor.getCurrentPageShapes().filter((s) => s.type.startsWith("runner-")).map((s) => ({ id: s.id, name: s.props.name, owner: s.meta.clipOwner, hasSnapshot: "clip" in s.meta })));
const clip = (id) => page.evaluate((c) => JSON.parse(JSON.stringify(window.__musicRunners.stores.clipsStore.clips[c] ?? null)), id);

let list = await instances();
assert.equal(list[0].name, "variants 1", "a new instance is named after its runner");
assert.equal(list[0].owner, list[0].id);

// 1. right-click the instance's title bar > Duplicate
const title = page.locator(".runner-shape__title").first();
const tb = await title.boundingBox();
await page.mouse.click(tb.x + tb.width * 0.75, tb.y + tb.height / 2);
await page.mouse.click(tb.x + tb.width * 0.75, tb.y + tb.height / 2, { button: "right" });
await sleep(200);
await page.getByRole("menuitem", { name: /^Duplicate/ }).first().click();
await sleep(300);
list = await instances();
console.log("after Duplicate", JSON.stringify(list));
assert.equal(list.length, 2);
assert.equal(list[1].name, "variants 2", "the copy gets the next free name");
assert.equal(list[1].owner, list[1].id, "the copy owns its clip");
const original = await clip(list[0].id), copy = await clip(list[1].id);
assert.deepEqual(copy, original, "notes, tags and loop length copied");
// diverge: edit the copy's clip, the original is untouched
await page.evaluate((c) => window.__musicRunners.clips.setClipNotes(c, []), list[1].id);
assert.equal((await clip(list[0].id)).notes.length, 1, "the original keeps its notes");

// 2. Cmd-D on the selected copy: another clip, another name
await page.keyboard.press("ControlOrMeta+d");
await sleep(300);
list = await instances();
assert.equal(list.length, 3);
assert.equal(list[2].name, "variants 3");
assert.ok(await clip(list[2].id), "Cmd-D copies the clip too");

// 3. undo removes the duplicated instance; redo brings it back with its clip
await page.keyboard.press("ControlOrMeta+z");
await sleep(200);
assert.equal((await instances()).length, 2, "undo removes the copy");
await page.keyboard.press("ControlOrMeta+Shift+z");
await sleep(200);
list = await instances();
assert.equal(list.length, 3, "redo restores the copy");
assert.equal(list[2].name, "variants 3", "redo keeps the name");

// 4. deleting an instance and undoing the delete brings its notes back
await page.evaluate((id) => { const ed = window.__musicRunners.editor; ed.markHistoryStoppingPoint("delete"); ed.deleteShapes([id]); }, list[0].id);
await sleep(100);
assert.equal((await instances()).length, 2);
await page.evaluate(() => window.__musicRunners.editor.undo());
await sleep(100);
assert.equal((await clip(list[0].id)).notes.length, 1, "undoing a delete keeps the notes");

// 5. pasting a copied instance (tldraw's paste entry point) carries the clip as it was when copied
const pasted = await page.evaluate((id) => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const content = ed.getContentFromCurrentPage([id]);
  mr.clips.setClipNotes(id, []); // changed after copying
  const before = new Set(ed.getCurrentPageShapeIds());
  ed.putContentOntoCurrentPage(content, { select: true });
  const added = ed.getCurrentPageShapes().find((s) => !before.has(s.id));
  return { id: added?.id, name: added?.props.name, meta: added?.meta, clip: JSON.parse(JSON.stringify(mr.stores.clipsStore.clips[added?.id] ?? null)) };
}, list[0].id);
console.log("pasted", JSON.stringify(pasted));
assert.ok(pasted.id);
assert.equal(pasted.clip.notes.length, 1, "paste uses the copied snapshot");
assert.deepEqual(pasted.clip.notes[0].metadata, TAGGED[0].metadata);
assert.equal(pasted.meta.clipOwner, pasted.id);
assert.ok(!("clip" in pasted.meta), "the snapshot is not kept in the pasted shape's meta");
assert.equal(pasted.name, "variants 4");

// 6. cut and paste keeps the name; moving to another page keeps the clip
const cut = await page.evaluate((id) => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const name = ed.getShape(id).props.name;
  const content = ed.getContentFromCurrentPage([id]);
  ed.deleteShapes([id]);
  const before = new Set(ed.getCurrentPageShapeIds());
  ed.putContentOntoCurrentPage(content, { select: true });
  const added = ed.getCurrentPageShapes().find((s) => !before.has(s.id));
  return { name, pastedName: added.props.name, id: added.id };
}, pasted.id);
assert.equal(cut.pastedName, cut.name, "cut and paste keeps the name");
const moved = await page.evaluate((id) => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const from = ed.getCurrentPageId();
  ed.createPage({ name: "two" });
  const to = ed.getPages().find((p) => p.name === "two").id;
  ed.moveShapesToPage([id], to);
  const shape = ed.getShape(id);
  ed.setCurrentPage(from);
  return { exists: Boolean(shape), name: shape?.props.name, meta: shape?.meta, notes: mr.stores.clipsStore.clips[id]?.notes.length };
}, cut.id);
console.log("moved", JSON.stringify(moved));
assert.ok(moved.exists, "moveShapesToPage keeps the id");
assert.equal(moved.name, cut.name, "moving does not rename");
assert.equal(moved.notes, 1, "moving keeps the clip");
assert.ok(!("clip" in moved.meta));
assert.equal(moved.meta.clipOwner, cut.id);

console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("DUPLICATE OK");
await browser.close();
