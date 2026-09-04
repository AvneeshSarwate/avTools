// Headless check of the handwriting-canvas web component's document surface:
//   document -> Konva scene -> document is exact,
//   the component's Konva bake agrees with the Konva-free package bake,
//   hydration never emits `document-update`,
//   and the legacy serialized-state round trip yields the same document.
//
// Run from apps/browser-projections after `npm run buildCanvas`:
//   npm run test:canvas
// Needs Node >= 22.6 (type stripping imports the package source directly).
// Set PW_CHROMIUM_PATH to a Chromium binary when Playwright's own download is
// unavailable (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium).
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bakeDrawingDocument, normalizeDrawingDocument } from '../../../packages/drawing-document/mod.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.resolve(__dirname, '../../../webcomponents/handwriting-canvas/dist/handwriting-canvas.js')
if (!existsSync(BUNDLE)) {
  console.error(`missing ${BUNDLE}; run \`npm run buildCanvas\` first`)
  process.exit(1)
}

// A document exercising everything the baked format erases: layer and group
// transforms, nested groups on two layers, stroke timing, an open polygon,
// metadata, and an ellipse produced by scale plus rotation.
const input = normalizeDrawingDocument({
  freehand: {
    transform: { x: 4, scaleX: 1.5 },
    nodes: [
      {
        type: 'stroke', id: 'stroke-a', creationTime: 1000, isFreehand: true,
        points: [10, 10, 20, 15, 35, 30, 50, 32], timestamps: [0, 16, 33, 49],
        metadata: { name: 'alpha', weight: 2 },
      },
      {
        type: 'group', id: 'group_1', transform: { x: 100, y: 20, rotation: 30, scaleY: 0.8 }, metadata: { name: 'letters' },
        children: [
          { type: 'stroke', id: 'stroke-b', creationTime: 2000, isFreehand: true, points: [100, 100, 120, 90, 140, 120], timestamps: [0, 20, 40], transform: { x: 105, y: 91 } },
          {
            type: 'group', id: 'group_2', transform: { skewX: 0.2 }, metadata: { nested: true },
            children: [
              { type: 'stroke', id: 'stroke-c', creationTime: 3000, isFreehand: false, points: [200, 200, 210, 220, 230, 240], timestamps: [0, 0, 0], metadata: { name: 'c' } },
            ],
          },
        ],
      },
    ],
  },
  polygon: {
    nodes: [
      { type: 'polygon', id: 'poly-1', creationTime: 4000, closed: true, points: [300, 50, 350, 60, 330, 110], transform: { x: -10, scaleX: 1.2 }, metadata: { kind: 'zone' } },
      { type: 'polygon', id: 'poly-open', creationTime: 4500, closed: false, points: [10, 200, 60, 210, 40, 260] },
    ],
  },
  circle: {
    transform: { y: 3 },
    nodes: [
      { type: 'circle', id: 'circ-1', creationTime: 5000, radius: 20, transform: { x: 80, y: 220 }, metadata: { tag: 'round' } },
      {
        type: 'group', id: 'circle-group', transform: { x: 260, y: 240, rotation: 30 }, metadata: { name: 'ring' },
        children: [
          { type: 'circle', id: 'circ-2', creationTime: 6000, radius: 30, transform: { scaleY: 0.4 } },
        ],
      },
    ],
  },
})

const failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
const browser = await chromium.launch(launchOptions)
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

await page.setContent('<!doctype html><html><body></body></html>')
await page.addScriptTag({ content: readFileSync(BUNDLE, 'utf8') })

const result = await page.evaluate(async (input) => {
  const el = document.createElement('handwriting-canvas')
  el.width = 500
  el.height = 400
  document.body.appendChild(el)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !el.canvasState?.stage; i++) await wait(20)
  if (!el.canvasState?.stage) return { error: 'component never mounted' }

  const clone = (v) => JSON.parse(JSON.stringify(v))
  let documentUpdates = 0
  el.addEventListener('document-update', () => { documentUpdates += 1 })

  el.setDrawingDocument(clone(input))
  await wait(50)
  const doc1 = clone(el.getDrawingDocument())
  const render1 = clone(el.getCanvasRenderData())
  const updatesAfterHydrate = documentUpdates

  // Legacy Konva serialization must carry the same document.
  const serialized = el.getCanvasState()
  el.setDrawingDocument({ version: 1, freehand: { nodes: [] }, polygon: { nodes: [] }, circle: { nodes: [] } })
  await wait(50)
  const emptied = clone(el.getDrawingDocument())
  el.setCanvasState(serialized)
  await wait(100)
  const doc2 = clone(el.getDrawingDocument())

  // An invalid document is rejected without touching the scene.
  let rejected = null
  try { el.setDrawingDocument({ version: 7 }) } catch (e) { rejected = String(e.message ?? e) }
  const doc3 = clone(el.getDrawingDocument())

  // A real edit (through the command stack, as a tool would) emits exactly once.
  const before = documentUpdates
  el.canvasState.command.executeCommand('smoke: delete stroke', () => {
    const item = el.canvasState.canvasItems.get('stroke-a')
    item?.konvaNode.destroy()
    el.canvasState.canvasItems.delete('stroke-a')
    el.canvasState.freehand.strokes.delete('stroke-a')
  })
  await wait(50)
  const updatesAfterEdit = documentUpdates - before
  const doc4 = clone(el.getDrawingDocument())

  const itemCount = el.canvasState.canvasItems.size
  return { doc1, render1, updatesAfterHydrate, emptied, doc2, rejected, doc3, updatesAfterEdit, doc4, itemCount }
}, input)

await browser.close()

if (result.error) { console.error(result.error); process.exit(1) }
const { doc1, render1, updatesAfterHydrate, emptied, doc2, rejected, doc3, updatesAfterEdit, doc4, itemCount } = result

check(JSON.stringify(doc1) === JSON.stringify(input), 'document round trip is not exact')
check(updatesAfterHydrate === 0, `hydration emitted document-update ${updatesAfterHydrate} times`)
check(emptied.freehand.nodes.length === 0 && emptied.polygon.nodes.length === 0 && emptied.circle.nodes.length === 0, 'empty document did not clear the scene')
// The legacy Konva serialization predates layer transforms and restores only
// layer children, so compare it without the layer-container transforms. The
// document path restores them; that is one of the things it exists for.
const withoutLayerTransforms = (doc) => {
  const copy = JSON.parse(JSON.stringify(doc))
  for (const layer of ['freehand', 'polygon', 'circle']) delete copy[layer].transform
  return copy
}
check(JSON.stringify(withoutLayerTransforms(doc2)) === JSON.stringify(withoutLayerTransforms(input)), 'serialized Konva state round trip changed the document')
check(rejected && rejected.includes('version'), `invalid document was not rejected: ${rejected}`)
check(JSON.stringify(doc3) === JSON.stringify(doc2), 'a rejected document altered the scene')
check(updatesAfterEdit >= 1, 'an edit did not emit document-update')
check(doc4.freehand.nodes.length === input.freehand.nodes.length - 1, 'edited document does not reflect the deletion')
// 3 strokes + 2 freehand groups + 2 polygons + 2 circles + 1 circle group, minus the deleted stroke.
check(itemCount === 9, `canvasItems registered after edit: ${itemCount} (expected 9)`)

// Konva bake vs. package bake.
const expected = bakeDrawingDocument(input)
const flatStrokes = (groups, out = []) => {
  for (const g of groups) for (const c of g.children) c.type === 'stroke' ? out.push(c) : flatStrokes([c], out)
  return out
}
const a = flatStrokes(render1.freehand)
const b = flatStrokes(expected.freehand)
check(a.length === b.length, `stroke count ${a.length} != ${b.length}`)
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  check(a[i].id === b[i].id, `stroke order differs at ${i}: ${a[i].id} vs ${b[i].id}`)
  check(a[i].points.length === b[i].points.length, `stroke ${a[i].id} point count differs`)
  a[i].points.forEach((p, j) => {
    const q = b[i].points[j]
    check(q && near(p.x, q.x, 1e-6) && near(p.y, q.y, 1e-6) && p.ts === q.ts, `stroke ${a[i].id} point ${j}: canvas ${JSON.stringify(p)} vs bake ${JSON.stringify(q)}`)
  })
  check(JSON.stringify(a[i].metadata) === JSON.stringify(b[i].metadata), `stroke ${a[i].id} metadata differs`)
}
check(JSON.stringify(render1.freehand.map((g) => g.id)) === JSON.stringify(expected.freehand.map((g) => g.id)), 'top-level freehand ids differ')
check(JSON.stringify(render1.freehand[1]?.children.map((c) => c.id)) === JSON.stringify(expected.freehand[1]?.children.map((c) => c.id)), 'group nesting differs')
check(render1.polygon.length === expected.polygon.length, 'polygon count differs')
render1.polygon.forEach((p, i) => {
  const q = expected.polygon[i]
  check(q && p.id === q.id && p.points.every((pt, j) => near(pt.x, q.points[j].x, 1e-6) && near(pt.y, q.points[j].y, 1e-6)), `polygon ${p.id} differs`)
  check(JSON.stringify(p.metadata) === JSON.stringify(q?.metadata), `polygon ${p.id} metadata differs`)
})
check(render1.circle.length === expected.circle.length, 'circle count differs')
render1.circle.forEach((c, i) => {
  const q = expected.circle[i]
  check(q && c.id === q.id && near(c.center.x, q.center.x, 1e-6) && near(c.center.y, q.center.y, 1e-6) && near(c.rx, q.rx, 1e-6) && near(c.ry, q.ry, 1e-6) && near(c.rotation, q.rotation, 1e-9) && (c.r === undefined) === (q.r === undefined), `circle ${c.id}: canvas ${JSON.stringify(c)} vs bake ${JSON.stringify(q)}`)
})
check(JSON.stringify(consoleErrors) === '[]', `console errors: ${consoleErrors.join(' | ')}`)

if (failures.length) {
  console.error('FAILURES:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('drawing document round trip and bake parity OK')
