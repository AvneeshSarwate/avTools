// Sorted-by-position index over state.notes so visible-note culling is
// O(visible + log n) instead of a scan of every note per redraw.
//
// The index is rebuilt lazily when it has been invalidated, when state.notes
// was replaced (hydration, undo/redo) or when its size changed. Notes that a
// gesture is moving in place (drag, resize, draw) are "in flight": the index
// skips them and they are scanned directly, so the index never has to be
// rebuilt per pointer move. Gesture ends and command-stack changes invalidate.
import type { NoteData, PianoRollState } from './state'

export interface NoteIndex {
  map: Map<string, NoteData>
  size: number
  /** Note ids sorted by position (ascending). */
  ids: string[]
  /** positions[i] is the position of ids[i] at build time. */
  positions: Float64Array
  /** ordinals[i] is the insertion ordinal of ids[i] in the map at build time (draw order). */
  ordinals: Int32Array
  /** id -> index into the sorted arrays. */
  slotById: Map<string, number>
  maxDuration: number
  /** End of the last note (position + duration) at build time. */
  maxEnd: number
  valid: boolean
}

export interface VisibleNote {
  id: string
  note: NoteData
  /** Insertion ordinal: sorting by it reproduces Map iteration order. */
  ord: number
}

function build(state: PianoRollState): NoteIndex {
  const map = state.notes
  const n = map.size
  const rawIds = new Array<string>(n)
  const rawPositions = new Float64Array(n)
  let maxDuration = 0
  let maxEnd = 0
  let i = 0
  for (const [id, note] of map) {
    rawIds[i] = id
    rawPositions[i] = note.position
    if (note.duration > maxDuration) maxDuration = note.duration
    const end = note.position + note.duration
    if (end > maxEnd) maxEnd = end
    i++
  }
  const order = new Uint32Array(n)
  for (let k = 0; k < n; k++) order[k] = k
  // Sort ordinals by position; a typed-array sort with a numeric comparator.
  const sorted = Array.from(order).sort((a, b) => rawPositions[a]! - rawPositions[b]!)

  const ids = new Array<string>(n)
  const positions = new Float64Array(n)
  const ordinals = new Int32Array(n)
  const slotById = new Map<string, number>()
  for (let k = 0; k < n; k++) {
    const ord = sorted[k]!
    const id = rawIds[ord]!
    ids[k] = id
    positions[k] = rawPositions[ord]!
    ordinals[k] = ord
    slotById.set(id, k)
  }
  return { map, size: n, ids, positions, ordinals, slotById, maxDuration, maxEnd, valid: true }
}

export function invalidateNoteIndex(state: PianoRollState) {
  const index = state.renderCache.noteIndex
  if (index) index.valid = false
}

export function getNoteIndex(state: PianoRollState): NoteIndex {
  let index = state.renderCache.noteIndex
  if (!index || !index.valid || index.map !== state.notes || index.size !== state.notes.size) {
    index = build(state)
    state.renderCache.noteIndex = index
  }
  return index
}

/** First slot whose position is >= value. */
export function lowerBound(positions: Float64Array, value: number): number {
  let lo = 0
  let hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (positions[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First slot whose position is > value. */
export function upperBound(positions: Float64Array, value: number): number {
  let lo = 0
  let hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (positions[mid]! <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface InFlight {
  has: (id: string) => boolean
  ids: Iterable<string>
}

const NONE: InFlight = { has: () => false, ids: [] }

/** True while a gesture is editing notes in place (the index is stale for them). */
export function hasInFlightNotes(state: PianoRollState): boolean {
  const { interaction } = state
  return interaction.isDragging || interaction.isResizing || (interaction.isDrawing && !!interaction.drawNoteId)
}

/** The notes a gesture is editing in place; their indexed positions are stale. */
export function inFlightNotes(state: PianoRollState): InFlight {
  const { interaction } = state
  if (interaction.isDragging) {
    const map = interaction.draggedNoteInitialStates
    return { has: (id) => map.has(id), ids: map.keys() }
  }
  if (interaction.isResizing) {
    const map = interaction.resizeInitialStates
    return { has: (id) => map.has(id), ids: map.keys() }
  }
  if (interaction.isDrawing && interaction.drawNoteId) {
    const drawId = interaction.drawNoteId
    return { has: (id) => id === drawId, ids: [drawId] }
  }
  return NONE
}

const byOrdinal = (a: VisibleNote, b: VisibleNote) => a.ord - b.ord

/**
 * The notes intersecting the viewport, in state.notes iteration order (the
 * order the retained renderer drew them in). `out` is reused between calls.
 */
export function collectVisibleNotes(state: PianoRollState, out: VisibleNote[]): VisibleNote[] {
  out.length = 0
  const stage = state.stage
  if (!stage) return out

  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight } = state.grid
  const viewportWidth = stage.width()
  const viewportHeight = Math.max(0, stage.height()) // the note area is the whole stage (viewport.getNoteAreaHeight)
  const visibleTimeStart = scrollX / quarterNoteWidth
  const visibleTimeEnd = (scrollX + viewportWidth) / quarterNoteWidth
  const visiblePitchMin = Math.floor(scrollY / noteHeight)
  const visiblePitchMax = Math.ceil((scrollY + viewportHeight) / noteHeight)

  const isVisible = (note: NoteData) => {
    if (note.position + note.duration < visibleTimeStart || note.position > visibleTimeEnd) return false
    const row = 127 - note.pitch
    return row >= visiblePitchMin && row <= visiblePitchMax
  }

  const inFlight = inFlightNotes(state)
  const map = state.notes

  for (let attempt = 0; attempt < 2; attempt++) {
    const index = getNoteIndex(state)
    const { ids, positions, ordinals } = index
    const lo = lowerBound(positions, visibleTimeStart - index.maxDuration)
    const hi = upperBound(positions, visibleTimeEnd)
    let stale = false
    for (let i = lo; i < hi; i++) {
      const id = ids[i]!
      if (inFlight.has(id)) continue
      const note = map.get(id)
      if (!note || note.position !== positions[i]) {
        // A position changed without an invalidation: rebuild once and retry.
        stale = true
        break
      }
      if (isVisible(note)) out.push({ id, note, ord: ordinals[i]! })
    }
    if (!stale) {
      let extra = index.size
      for (const id of inFlight.ids) {
        const note = map.get(id)
        if (!note || !isVisible(note)) continue
        const slot = index.slotById.get(id)
        out.push({ id, note, ord: slot === undefined ? extra++ : ordinals[slot]! })
      }
      break
    }
    out.length = 0
    index.valid = false
  }

  out.sort(byOrdinal)
  return out
}
