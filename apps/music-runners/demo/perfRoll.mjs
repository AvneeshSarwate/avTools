// Playwright perf probe for the piano roll. Run with the dev server up:
//   cd apps/music-runners && npx vite   (port 5190)
//   HEADLESS=1 node demo/perfRoll.mjs
// Hydrates roll `a` with 10,000 notes, zooms so ~1,000 are visible, then
// measures per-redraw cost over 120 wheel scrolls, hydration, a marquee
// selection of ~200 notes and a 2-beat drag of them. Prints one JSON line.
// Timing is done in-page: requestAnimationFrame is wrapped before the app
// loads so every frame callback (the roll's render loop and Konva's batched
// draws) is timed, and gesture handlers are timed around dispatchEvent.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(path.resolve(here, '../../livecode-tldraw/node_modules/playwright'))

const URL = process.env.DEMO_URL ?? 'http://localhost:5190/demo.html'
const ROLL = 'a'
const NOTE_COUNT = 10_000
const BEATS = 400
const PITCHES = 60
const SCROLL_EVENTS = 120
const SHOT = process.env.SHOT_LABEL ? path.join(here, 'screenshots', `perf-${process.env.SHOT_LABEL}.png`) : null

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === '1' })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', (err) => console.error('PAGE ERROR', err))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR', msg.text())
})

await page.addInitScript(() => {
  const frames = []
  window.__perf = {
    frames,
    /** Resolve after n animation frames. */
    frames: (n) =>
      new Promise((resolve) => {
        const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step))
        step()
      }),
    log: frames
  }
  const orig = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) =>
    orig((ts) => {
      const start = performance.now()
      try {
        return cb(ts)
      } finally {
        frames.push({ ts, start, ms: performance.now() - start })
      }
    })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto(URL)
await page.waitForSelector(`[data-roll="${ROLL}"] .pr-container canvas`)
await sleep(300)

const result = await page.evaluate(
  async ({ roll, noteCount, beats, pitches, scrollEvents }) => {
    const perf = window.__perf
    const entry = window.__pianoRollDemo[roll]
    const rollEl = document.querySelector(`[data-roll="${roll}"]`)
    const container = rollEl.querySelector('.pr-container')
    const content = container.querySelector('.konvajs-content')
    const info = rollEl.querySelector('.pr-info')
    const box = () => container.getBoundingClientRect()
    const now = () => performance.now()
    /** Sum of frame-callback ms for frames that started after `since`. */
    const rafSince = (since) => perf.log.reduce((acc, f) => (f.start >= since ? acc + f.ms : acc), 0)
    const stats = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const avg = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
      const max = sorted[sorted.length - 1] ?? 0
      return { avg: +avg.toFixed(3), p95: +p95.toFixed(3), max: +max.toFixed(3), n: arr.length }
    }
    const round = (v) => +v.toFixed(2)

    // --- deterministic 10k notes over 400 beats and 60 pitches ---
    let seed = 1234567
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const notes = []
    for (let i = 0; i < noteCount; i++) {
      const position = Math.floor(rand() * beats * 4) / 4
      const pitch = 36 + Math.floor(rand() * pitches)
      const duration = [0.25, 0.5, 0.75, 1][Math.floor(rand() * 4)]
      notes.push({ id: `p_${i}`, pitch, position, duration, velocity: 60 + Math.floor(rand() * 60) })
    }

    // --- (b) hydrate ---
    const hydrateStart = now()
    entry.hydrate(notes)
    while (!info.textContent.startsWith(`${noteCount} notes`)) await perf.frames(1)
    await perf.frames(2)
    const hydrateWallMs = now() - hydrateStart
    const hydrateRafMs = rafSince(hydrateStart)

    // --- fit, then zoom horizontally until ~1,000 notes are visible ---
    entry.fit()
    await perf.frames(3)
    const b = box()
    const wheel = (init) =>
      container.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: b.left + b.width / 2,
          clientY: b.top + b.height / 2,
          ...init
        })
      )
    const visibleCount = () => {
      const v = entry.getView()
      const endBeat = v.startBeat + (b.width - 2) / v.quarterNoteWidth
      const topRow = v.topRow
      const bottomRow = v.topRow + (b.height - 2) / v.noteHeight
      let n = 0
      for (const note of notes) {
        const row = 127 - note.pitch
        if (note.position + note.duration < v.startBeat || note.position > endBeat) continue
        if (row < Math.floor(topRow) || row > Math.ceil(bottomRow)) continue
        n++
      }
      return n
    }
    for (let i = 0; i < 6; i++) {
      const count = visibleCount()
      if (count >= 800 && count <= 1500) break
      const factor = count / 1000
      wheel({ ctrlKey: true, deltaY: -Math.log(factor) / 0.002 })
      await perf.frames(3)
    }
    // Leave the left edge so a horizontal scroll has room in both directions.
    wheel({ deltaX: 200, deltaY: 0 })
    await perf.frames(3)
    const visible = visibleCount()
    const view = entry.getView()

    // --- (a) 120 wheel scrolls: handler + frame-callback ms per event ---
    const redraws = []
    for (let i = 0; i < scrollEvents; i++) {
      const start = now()
      wheel({ deltaX: i % 40 < 20 ? 6 : -6, deltaY: 0 })
      const handlerMs = now() - start
      await perf.frames(3)
      redraws.push(handlerMs + rafSince(start))
    }

    // --- (c) marquee ~200 notes, then drag them 2 beats ---
    const mouse = (type, x, y, extra = {}) =>
      content.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, ...extra })
      )
    const gesture = async (from, to, steps) => {
      const wallStart = now()
      let cpu = 0
      const step = async (type, x, y) => {
        const s = now()
        mouse(type, x, y)
        cpu += now() - s
        await perf.frames(3)
        cpu += rafSince(s)
      }
      await step('mousedown', from.x, from.y)
      for (let i = 1; i <= steps; i++) {
        await step('mousemove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
      }
      await step('mouseup', to.x, to.y)
      return { cpuMs: round(cpu), wallMs: round(now() - wallStart) }
    }
    const v = entry.getView()
    const beatX = (beat) => b.left + 1 + (beat - v.startBeat) * v.quarterNoteWidth
    const rowY = (pitch) => b.top + 1 + (127 - pitch - v.topRow) * v.noteHeight + v.noteHeight / 2
    // ~25 notes per beat over 60 pitches: 8 beats of full height is ~200 notes.
    const startBeat = v.startBeat + 2
    const marquee = await gesture(
      { x: beatX(startBeat), y: b.top + 2 },
      { x: beatX(startBeat + 8), y: b.top + b.height - 2 },
      12
    )
    const selected = entry.getSelectedIds()
    const selectedSet = new Set(selected)
    const first = notes.find((n) => selectedSet.has(n.id) && n.duration >= 0.5)
    const before = new Map(notes.filter((n) => selectedSet.has(n.id)).map((n) => [n.id, n.position]))
    const grab = { x: beatX(first.position + first.duration / 2), y: rowY(first.pitch) }
    const drag = await gesture(grab, { x: grab.x + 2 * v.quarterNoteWidth, y: grab.y }, 12)
    const afterNotes = entry.notes
    const movedBy = afterNotes.filter((n) => before.has(n.id)).map((n) => n.position - before.get(n.id))
    const delta = movedBy.length ? round(Math.min(...movedBy)) : null

    return {
      visibleNotes: visible,
      view: { quarterNoteWidth: round(view.quarterNoteWidth), noteHeight: round(view.noteHeight) },
      redrawMs: stats(redraws),
      hydrate: { rafMs: round(hydrateRafMs), wallMs: round(hydrateWallMs) },
      marquee: { ...marquee, selected: selected.length },
      drag: { ...drag, notes: movedBy.length, movedBeats: delta }
    }
  },
  { roll: ROLL, noteCount: NOTE_COUNT, beats: BEATS, pitches: PITCHES, scrollEvents: SCROLL_EVENTS }
)

if (SHOT) {
  await sleep(200)
  await page.screenshot({ path: SHOT })
}
console.log(JSON.stringify(result))
await browser.close()
