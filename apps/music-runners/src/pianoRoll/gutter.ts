// The column left of the grid, after Ableton's: a piano keyboard beside the
// note rows (C labels, the hovered pitch's label, a strip on in-scale keys,
// the held key highlighted) and a value ruler beside each expression lane.
// A plain 2D canvas outside the Konva stage, so grid x coordinates stay as
// they are; it shares the grid's vertical scroll and zoom, and the stage
// manager redraws it whenever the grid redraws or `dirty.gutter` is set.
import { laneGeometries, laneRange, laneValueToY, noteAreaHeight } from './lanes'
import { scalePitchClasses } from './scale'
import type { PianoRollState } from './state'
import { pitchLabel } from './utils'

/** Column width in CSS px: labels on the left, keys on the right. */
export const GUTTER_WIDTH = 50
const KEY_WIDTH = 24
const SCALE_STRIP = 3

const BACKGROUND = '#1b1b1b'
const WHITE_KEY = '#c9c9c9'
const BLACK_KEY = '#2e2e2e'
const KEY_EDGE = '#0b0b0b'
const LABEL = '#8a8a8a'
const LABEL_HOVER = '#e6e6e6'
/** Ableton marks scale awareness in purple. */
const SCALE_COLOR = '#a98bff'
const ROOT_COLOR = '#d6c8ff'
/** A key held from the keyboard column (Ableton shows it orange). */
const PRESSED = '#ff9b3d'
const RULER = '#6b6b6b'
const LANE_FILL = '#1d1d1d'

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

export function drawGutter(state: PianoRollState, canvas: HTMLCanvasElement | null) {
  const stage = state.stage
  if (!canvas || !stage) return
  const dpr = window.devicePixelRatio || 1
  const cssHeight = stage.height()
  const pixelWidth = Math.round(GUTTER_WIDTH * dpr)
  const pixelHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.height = `${cssHeight}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, GUTTER_WIDTH, cssHeight)

  const gridHeight = noteAreaHeight(state)
  const { noteHeight } = state.grid
  const { scrollY } = state.viewport
  const { inScale, root } = scalePitchClasses(state.grid.scale)
  const keyX = GUTTER_WIDTH - KEY_WIDTH
  const { pressedPitch, hoverPitch } = state.keyboard

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, GUTTER_WIDTH, gridHeight)
  ctx.clip()
  const firstRow = Math.max(0, Math.floor(scrollY / noteHeight))
  const lastRow = Math.min(127, Math.ceil((scrollY + gridHeight) / noteHeight))
  const showLabels = noteHeight >= 8
  ctx.font = `normal normal ${Math.min(11, Math.max(8, noteHeight - 4))}px Arial`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (let row = firstRow; row <= lastRow; row++) {
    const pitch = 127 - row
    const pitchClass = pitch % 12
    const y = row * noteHeight - scrollY
    ctx.fillStyle = pitch === pressedPitch ? PRESSED : BLACK_KEYS.has(pitchClass) ? BLACK_KEY : WHITE_KEY
    ctx.fillRect(keyX, y, KEY_WIDTH, noteHeight)
    ctx.fillStyle = KEY_EDGE
    ctx.fillRect(keyX, y + noteHeight - 1, KEY_WIDTH, 1)
    if (inScale.has(pitchClass)) {
      ctx.fillStyle = pitchClass === root ? ROOT_COLOR : SCALE_COLOR
      ctx.fillRect(GUTTER_WIDTH - SCALE_STRIP, y, SCALE_STRIP, noteHeight - 1)
    }
    if (showLabels && (pitchClass === 0 || pitch === hoverPitch)) {
      ctx.fillStyle = pitch === hoverPitch ? LABEL_HOVER : LABEL
      ctx.fillText(pitchLabel(pitch, state.grid.pitchLabels), 3, y + noteHeight / 2)
    }
  }
  ctx.restore()

  // Rulers beside the lanes
  ctx.font = 'normal normal 9px Arial'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const geometry of laneGeometries(state)) {
    const { top, height } = geometry
    ctx.fillStyle = LANE_FILL
    ctx.fillRect(0, top, GUTTER_WIDTH, height)
    ctx.fillStyle = KEY_EDGE
    ctx.fillRect(0, top, GUTTER_WIDTH, 1)
    const { min, max } = laneRange(geometry.lane)
    const mid = Math.round((min + max) / 2)
    ctx.strokeStyle = RULER
    ctx.fillStyle = RULER
    ctx.lineWidth = 1
    for (const value of [max, mid, min]) {
      const y = Math.round(laneValueToY(geometry, value)) + 0.5
      ctx.beginPath()
      ctx.moveTo(GUTTER_WIDTH - 5, y)
      ctx.lineTo(GUTTER_WIDTH, y)
      ctx.stroke()
      ctx.fillText(String(value), GUTTER_WIDTH - 7, y)
    }
  }
}

/** Pitch under a y in the column, or null below the grid. */
export function gutterPitchAt(state: PianoRollState, y: number): number | null {
  if (!state.stage || y < 0 || y >= noteAreaHeight(state)) return null
  const row = Math.floor((y + state.viewport.scrollY) / state.grid.noteHeight)
  return row >= 0 && row <= 127 ? 127 - row : null
}
