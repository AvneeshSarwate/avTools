// Duplicating a runner instance (right-click Duplicate, Cmd-D) gives the copy
// its own copy of the bank, so the two diverge; the sidebar's "+ instance"
// still shares a bank; the sidebar's bank duplicate copies tagged notes.
// Project "zz_dup" is never saved. With the dev server up:
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
await page.evaluate(() => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", undefined, { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false, showSource: false } });
  mr.banks.setBankNotes(s.props.bankId, [{ id: "a", pitch: 60, position: 0, duration: 1, velocity: 100, metadata: { trill: { probability: 0.5, notes: [3, 4] } } }]);
  ed.selectNone(); ed.setCamera({ x: 60, y: 120, z: 0.8 }); window.__id = id;
});
await sleep(500);
const instances = () => page.evaluate(() => {
  const mr = window.__musicRunners;
  return mr.editor.getCurrentPageShapes().filter((s) => s.type.startsWith("runner-")).map((s) => ({ id: s.id, bankId: s.props.bankId }));
});
const bank = (id) => page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.banksStore.banks[b] ?? null)), id);

// 1. right-click the instance's title bar > Duplicate
const title = page.locator(".runner-shape__title").first();
const tb = await title.boundingBox();
await page.mouse.click(tb.x + tb.width * 0.6, tb.y + tb.height / 2);
await page.mouse.click(tb.x + tb.width * 0.6, tb.y + tb.height / 2, { button: "right" });
await sleep(200);
await page.getByRole("menuitem", { name: /^Duplicate/ }).first().click();
await sleep(300);
let list = await instances();
console.log("after Duplicate", JSON.stringify(list));
assert.equal(list.length, 2);
assert.notEqual(list[0].bankId, list[1].bankId, "the copy has its own bank");
const original = await bank(list[0].bankId), copy = await bank(list[1].bankId);
assert.equal(copy.name, `${original.name} copy`);
assert.deepEqual(copy.notes.map((n) => n.metadata), original.notes.map((n) => n.metadata), "notes and tags copied");
// diverge: edit the copy's bank, the original is untouched
await page.evaluate((b) => window.__musicRunners.banks.setBankNotes(b, []), list[1].bankId);
assert.equal((await bank(list[0].bankId)).notes.length, 1, "the original keeps its notes");
// 2. Cmd-D on the selected copy: another bank
await page.keyboard.press("ControlOrMeta+d");
await sleep(300);
list = await instances();
assert.equal(list.length, 3);
assert.equal(new Set(list.map((i) => i.bankId)).size, 3, "Cmd-D copies the bank too");
// 3. undo removes the duplicated instance
await page.keyboard.press("ControlOrMeta+z");
await sleep(200);
assert.equal((await instances()).length, 2, "undo removes the copy");
// 4. the sidebar's "+ instance" still shares the bank
const firstBank = list[0].bankId;
await page.evaluate((b) => window.__musicRunners.shapes.createInstance(window.__musicRunners.editor, "variants", b), firstBank);
await sleep(200);
list = await instances();
assert.equal(list.filter((i) => i.bankId === firstBank).length, 2, "+ instance shares the bank on purpose");
// 5. the sidebar's bank duplicate copies tagged notes (it used to throw)
const banksBefore = await page.evaluate(() => Object.keys(window.__musicRunners.stores.banksStore.banks).length);
const row = page.locator(".bank-row", { hasText: (await bank(firstBank)).name }).first();
await row.hover();
await row.locator("button[title='duplicate bank']").click();
await sleep(200);
assert.equal(await page.evaluate(() => Object.keys(window.__musicRunners.stores.banksStore.banks).length), banksBefore + 1, "sidebar duplicate works with tagged notes");
// 6. pasting a copied instance (tldraw's paste entry point) also gets its own bank
const pasted = await page.evaluate((id) => {
  const ed = window.__musicRunners.editor;
  const before = new Set(ed.getCurrentPageShapeIds());
  ed.putContentOntoCurrentPage(ed.getContentFromCurrentPage([id]), { select: true });
  const added = ed.getCurrentPageShapes().find((s) => !before.has(s.id));
  return { original: ed.getShape(id).props.bankId, pasted: added?.props.bankId };
}, (await instances())[0].id);
assert.ok(pasted.pasted && pasted.pasted !== pasted.original, "paste copies the bank");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("DUPLICATE OK");
await browser.close();
