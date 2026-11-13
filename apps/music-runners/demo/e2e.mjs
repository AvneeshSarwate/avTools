// Headed Playwright check of the demo page. Run with the dev server up:
//   cd apps/music-runners && npx vite   (port 5190)
//   node demo/e2e.mjs
// Uses the Playwright install of apps/livecode-tldraw and the system Chrome.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(path.resolve(here, '../../livecode-tldraw/node_modules/playwright'))

const URL = process.env.DEMO_URL ?? 'http://localhost:5190/demo.html'
const shots = path.join(here, 'screenshots')
const ROLL = 'a'

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === '1' })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', (err) => console.error('PAGE ERROR', err))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR', msg.text())
})

const debug = () => page.evaluate((roll) => {
  const d = window.__pianoRollDemo[roll]
  return { notes: d.notes, lastLabel: d.lastLabel, changeCount: d.changeCount, selection: d.selection, previews: d.previews, views: d.views, view: d.getView() }
}, ROLL)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Konva refreshes its hit canvas on the next animation frame, so give every
// key-driven edit a frame to settle before the next pointer gesture.
const key = async (combo) => {
  await page.keyboard.press(combo)
  await sleep(60)
}
const container = () => page.locator(`[data-roll="${ROLL}"] .pr-container`)
const button = (cls) => page.locator(`[data-roll="${ROLL}"] .pr-control-panel .${cls}`)

/** Stage-pixel coordinates for a beat / pitch (row center) under the current view. */
async function stagePoint(beat, pitch) {
  const box = await container().boundingBox()
  const { view } = await debug()
  const x = box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth
  const y = box.y + 1 + (127 - pitch - view.topRow) * view.noteHeight + view.noteHeight / 2
  return { x, y }
}

async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
  await sleep(80)
}

await page.goto(URL)
await page.waitForSelector(`[data-roll="${ROLL}"] .pr-container canvas`)
await sleep(300)
await page.screenshot({ path: path.join(shots, '01-initial.png') })

let d = await debug()
assert.equal(d.notes.length, 12, 'seeded with a dozen notes')
assert.equal(d.changeCount, 0, 'no emission on mount')

// Fit, then zoom out twice so the 8-beat loop end is in view.
await button('pr-fit').click()
await sleep(400)
d = await debug()
assert.ok(d.views.length >= 1, 'onViewChange fired after fit')
const fitView = d.view
await button('pr-zoom-out').click()
await button('pr-zoom-out').click()
await sleep(100)
d = await debug()
assert.ok(d.view.quarterNoteWidth < fitView.quarterNoteWidth, 'zoom out shrinks quarterNoteWidth')
await page.screenshot({ path: path.join(shots, '02-fit-zoomed-out.png') })

// --- draw a note (draw mode) ---
await button('pr-draw-toggle').click()
const previewsBefore = (await debug()).previews.length
await drag(await stagePoint(6.1, 66), await stagePoint(7.0, 66))
d = await debug()
assert.equal(d.notes.length, 13, 'draw adds one note')
assert.equal(d.lastLabel, 'Draw Note')
const drawn = d.notes.find((n) => n.pitch === 66)
assert.ok(drawn, 'drawn note at pitch 66')
assert.equal(drawn.position, 6, 'drawn note quantized to the 16th grid')
assert.ok(drawn.duration >= 1, `drawn note grew with the drag (${drawn.duration})`)
assert.ok(d.previews.length > previewsBefore && d.previews.at(-1).pitch === 66, 'preview on creation')
assert.deepEqual(d.selection, [drawn.id], 'drawn note is selected')
await button('pr-draw-toggle').click()

// --- drag it down two rows ---
const center = await stagePoint(drawn.position + drawn.duration / 2, 66)
const { view: v1 } = await debug()
await drag(center, { x: center.x, y: center.y + 2 * v1.noteHeight })
d = await debug()
assert.equal(d.lastLabel, 'Move Notes')
let moved = d.notes.find((n) => n.id === drawn.id)
assert.equal(moved.pitch, 64, 'dragged two rows down')
assert.equal(moved.position, 6, 'position unchanged by a vertical drag')
const pitchesPreviewed = d.previews.slice(-2).map((p) => p.pitch)
assert.deepEqual(pitchesPreviewed, [65, 64], 'one preview per pitch row crossed')

// --- resize with the end handle ---
const endHandle = await stagePoint(moved.position + moved.duration, 64)
await drag(endHandle, { x: endHandle.x + v1.quarterNoteWidth, y: endHandle.y })
d = await debug()
assert.equal(d.lastLabel, 'Resize Notes')
moved = d.notes.find((n) => n.id === drawn.id)
assert.ok(Math.abs(moved.duration - (drawn.duration + 1)) < 1e-6, `resized by one beat (${moved.duration})`)

// --- double-click on the background adds a grid-unit note ---
await sleep(450) // leave Konva's double-click window after the resize gesture
const dbl = await stagePoint(7.6, 61)
await page.mouse.dblclick(dbl.x, dbl.y)
await sleep(80)
d = await debug()
assert.equal(d.lastLabel, 'Add Note')
assert.equal(d.notes.length, 14)
const added = d.notes.find((n) => n.pitch === 61)
assert.ok(added && added.position === 7.5 && added.duration === 0.25, 'double-click adds a 16th at the grid cell')
assert.equal(d.previews.at(-1).pitch, 61, 'preview on double-click creation')
await key('Meta+z')
d = await debug()
assert.equal(d.lastLabel, 'Undo Add Note')
assert.equal(d.notes.length, 13)
await sleep(450) // leave Konva's double-click window before the next gesture

// --- marquee select two seed notes, delete, undo, redo ---
await drag(await stagePoint(1.2, 63), await stagePoint(0.05, 60))
d = await debug()
assert.deepEqual([...d.selection].sort(), ['a_n0', 'a_n1'], 'marquee selected the two low notes')
await key('Delete')
d = await debug()
assert.equal(d.lastLabel, 'Delete Selected')
assert.equal(d.notes.length, 11)
await key('Meta+z')
d = await debug()
assert.equal(d.lastLabel, 'Undo Delete Selected')
assert.equal(d.notes.length, 13)
await key('Shift+Meta+z')
d = await debug()
assert.equal(d.lastLabel, 'Redo Delete Selected')
assert.equal(d.notes.length, 11)

// --- copy / paste at the queue playhead ---
const clickPt = await stagePoint(moved.position + 0.3, 64)
await page.mouse.click(clickPt.x, clickPt.y)
await sleep(80)
d = await debug()
assert.deepEqual(d.selection, [drawn.id], 'clicking a note selects it')
assert.equal(d.previews.at(-1).pitch, 64, 'preview on click')
await key('Meta+c')
const playheadPt = await stagePoint(3.05, 61)
await page.mouse.click(playheadPt.x, playheadPt.y) // sets the queue playhead to 3.0
await sleep(80)
await key('Meta+v')
d = await debug()
assert.equal(d.lastLabel, 'Paste Notes')
assert.equal(d.notes.length, 12)
const pasted = d.notes.find((n) => n.id !== drawn.id && n.pitch === 64 && n.position === 3)
assert.ok(pasted, 'pasted copy lands at the queue playhead')
assert.equal(pasted.duration, moved.duration)

// --- wheel scroll and ctrl+wheel zoom ---
const box = await container().boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
const before = (await debug()).view
await page.mouse.wheel(0, 100)
await sleep(50)
let after = (await debug()).view
assert.ok(after.topRow > before.topRow, 'wheel scrolls down')
await page.keyboard.down('Control')
await page.mouse.wheel(0, -300)
await page.keyboard.up('Control')
await sleep(50)
after = (await debug()).view
assert.ok(after.quarterNoteWidth > before.quarterNoteWidth, 'ctrl+wheel zooms in')

// --- fit to content via the handle ---
await page.evaluate((roll) => window.__pianoRollDemo[roll].fit(), ROLL)
await sleep(400)
d = await debug()
after = d.view
const firstBeat = Math.min(...d.notes.map((n) => n.position))
assert.ok(Math.abs(after.startBeat - firstBeat) < 1e-6, `fit starts at the first note (${after.startBeat} vs ${firstBeat})`)
await page.screenshot({ path: path.join(shots, '03-after-edits.png') })

// --- metadata panel on two selected notes ---
await button('pr-zoom-out').click()
await drag(await stagePoint(1.9, 66), await stagePoint(3.6, 70))
d = await debug()
assert.deepEqual([...d.selection].sort(), ['a_n4', 'a_n5'], 'marquee selected two notes for metadata')
await button('pr-metadata-toggle').click()
await page.locator(`[data-roll="${ROLL}"] .demo-tag-button`).click()
d = await debug()
assert.equal(d.lastLabel, 'Tag Notes')
for (const id of ['a_n4', 'a_n5']) assert.equal(d.notes.find((n) => n.id === id).metadata.tag, 'host', `${id} tagged by host slot`)

// Add a field through the ported tree editor.
await page.locator(`[data-roll="${ROLL}"] .pr-meta-bar button`, { hasText: '+ field' }).click()
await page.locator(`[data-roll="${ROLL}"] .pr-meta-key-input`).fill('mood')
await page.locator(`[data-roll="${ROLL}"] .pr-meta-row.add .pr-meta-value`).fill('calm')
await page.keyboard.press('Enter')
await page.locator(`[data-roll="${ROLL}"] .pr-meta-btn.primary`).click()
d = await debug()
assert.equal(d.lastLabel, 'Edit Note Metadata')
for (const id of ['a_n4', 'a_n5']) assert.equal(d.notes.find((n) => n.id === id).metadata.mood, 'calm', `${id} edited by the tree`)
assert.deepEqual([...d.selection].sort(), ['a_n4', 'a_n5'], 'selection survives the metadata edit')
await sleep(200)
await page.screenshot({ path: path.join(shots, '04-metadata-panel.png') })

// --- foreign hydration: a prop change that is not our own echo re-hydrates silently ---
const changesBefore = d.changeCount
await page.evaluate((roll) => {
  const entry = window.__pianoRollDemo[roll]
  const next = entry.notes.filter((n) => n.id !== 'a_n4').map((n) => (n.id === 'a_n5' ? { ...n, pitch: n.pitch + 5 } : n))
  entry.hydrate(next)
}, ROLL)
await sleep(150)
d = await debug()
assert.equal(d.changeCount, changesBefore, 'hydration emits nothing')
const info = await page.locator(`[data-roll="${ROLL}"] .pr-info`).textContent()
assert.ok(info.startsWith('11 notes'), `roll shows the hydrated notes (${info})`)
const selectedAfter = await page.evaluate((roll) => window.__pianoRollDemo[roll].getSelectedIds(), ROLL)
assert.deepEqual(selectedAfter, ['a_n5'], 'selection keeps only ids that still exist')
// Focus had moved to the (now disabled) save button; the handle's focus() puts
// the keyboard back on the roll.
await page.evaluate((roll) => window.__pianoRollDemo[roll].focus(), ROLL)
await key('Meta+z')
d = await debug()
assert.equal(d.lastLabel, 'Undo Edit Note Metadata', 'undo history survives hydration')

// The other roll shared nothing: still its seed.
const other = await page.evaluate(() => window.__pianoRollDemo.b)
assert.equal(other.notes.length, 12)
assert.equal(other.changeCount, 0)

console.log('e2e: all checks passed')
await browser.close()
