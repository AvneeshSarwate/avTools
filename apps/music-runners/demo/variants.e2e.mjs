// Variant steps: alternatives are scale-degree moves from the note in the
// bank's scale ("+1 -5 +2+"), so ghosts and choices follow the note when it
// moves or the scale changes. Project "zz_variants" is never saved.
// With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/variants.e2e.mjs [screenshot dir]
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
await page.route("**/api/projects/zz_variants", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_variants");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ctx = await page.evaluate(() => {
  const mr = window.__musicRunners; const ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", undefined, { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false } });
  mr.banks.setBankNotes(s.props.bankId, [{ id: "a", pitch: 60, position: 0, duration: 1, velocity: 100 }]);
  ed.selectNone(); ed.setCamera({ x: 20, y: 40, z: 0.8 }); window.__id = id;
  return { id, bankId: s.props.bankId };
});
await sleep(600);
const shape = page.locator(".runner-shape").first();
// tag the note as a variant and type steps in the structured editor
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["a"]));
await shape.locator(".pr-metadata-toggle").click();
await sleep(150);
await shape.locator(".tag-chip", { hasText: "variant" }).click();
await sleep(150);
const field = shape.locator(".tag-row", { hasText: "variant" }).locator("input.ui-text");
assert.equal(await field.getAttribute("placeholder"), "+1 -2 +2+");
await field.fill("+1 -2 +2+ +0+2");
await field.press("Enter");
await sleep(150);
const ghosts = () => page.evaluate((id) => {
  const mr = window.__musicRunners;
  const shape = mr.editor.getShape(id);
  const bank = mr.stores.banksStore.banks[shape.props.bankId];
  return { notes: bank.notes.map((n) => [n.pitch, n.metadata?.variant?.steps]) };
}, ctx.id);
console.log("stored", JSON.stringify(await ghosts()));
// ghost pitches come from the runner (sourceGhostNotes) through the debug hook's registry
const resolved = (pitch, scale) => page.evaluate(async ({ pitch, scale }) => {
  const steps = await import("/src/runners/variants/steps.ts");
  return steps.parseVariantSteps("+1 -2 +2+ +0+2").steps.map((s) => steps.resolveVariantStep(pitch, s, scale));
}, { pitch, scale });
assert.deepEqual(await resolved(60, undefined), [62, 57, 65, 62], "C4: D, A3, F, D (+0+2 is a whole tone up)");
assert.deepEqual(await resolved(64, undefined), [65, 60, 68, 66], "E4: the same steps follow the note (+2+ is G plus a semitone)");
await shape.screenshot({ path: `${OUT}/variants-steps.png` });
// moving the note moves the generated choices: run the generator many times
const choices = await page.evaluate(async (bankId) => {
  const mr = window.__musicRunners;
  const bank = mr.stores.banksStore.banks[bankId];
  mr.banks.setBankNotes(bankId, bank.notes.map((n) => ({ ...JSON.parse(JSON.stringify(n)), pitch: 64, metadata: { variant: { steps: "+1 -2 +2+ +0+2", probability: 1 } } })));
  const { variantsRunner } = await import("/src/runners/variants/runner.ts");
  const seen = new Set();
  for (let i = 0; i < 80; i++) seen.add(variantsRunner.generate(mr.stores.banksStore.banks[bankId], Math.random).notes[0].pitch);
  return [...seen].sort((a, b) => a - b);
}, ctx.bankId);
console.log("choices from E4", choices);
assert.deepEqual(choices, [60, 65, 66, 68]);
// another scale on the bank: D major moves the result
const dorian = await page.evaluate(async (bankId) => {
  const mr = window.__musicRunners;
  const { variantsRunner } = await import("/src/runners/variants/runner.ts");
  mr.stores.banksStore.banks[bankId].scale = { root: 62, degrees: [0, 2, 4, 5, 7, 9, 11, 12] };
  const seen = new Set();
  for (let i = 0; i < 80; i++) seen.add(variantsRunner.generate(mr.stores.banksStore.banks[bankId], Math.random).notes[0].pitch);
  return [...seen].sort((a, b) => a - b);
}, ctx.bankId);
console.log("choices from E4 in D major", dorian);
// D major: E +1 is F#, -2 is C#, +2+ is G + 1, +0+2 is F#
assert.deepEqual(dorian, [61, 66, 68], "the bank's scale drives the steps");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("VARIANTS OK");
await browser.close();
