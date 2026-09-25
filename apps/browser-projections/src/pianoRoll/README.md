# Piano Roll Component

A Konva.js-based piano roll editor with immediate-mode rendering, wrapped in a Vue component and exportable as a web component.

## Features

- **Immediate-mode rendering**: Only renders visible notes based on viewport
- **Note manipulation**: Add, select, drag, resize notes
- **Multi-selection**: Click + shift or marquee selection with shift
- **Drag quantization**: Vertical (pitch) and horizontal (grid snap) quantization
- **Snap-to-note-start**: Notes snap to non-selected note start positions during drag
- **Overlap preview**: Notes that will be deleted during drag/resize are shown with reduced opacity
- **Scrollbar zoom controls**: Horizontal/vertical bars with draggable ends for anchored zoom + scroll
- **Undo/redo**: Simple snapshot-based command stack
- **Keyboard shortcuts**: Arrow keys, delete, copy/paste, undo/redo
- **Resize handles**: Resize note start or end (affects entire selection)
- **Auto-fit viewport**: `fitZoomToNotes()` zooms and scrolls to the active note bounds with sensible minimums
- **Overlap resolution**: Moves and pastes truncate or remove colliding notes automatically
- **MPE expression**: per-note pitch curves drawn on the notes (MPE mode), plus
  Pressure and Timbre (CC74) lanes under the grid, each toggled on its own.
  See "Expression lanes" below.

## Architecture

### Core Files

- **`pianoRollState.ts`**: State management (pure data, no Konva refs)
- **`pianoRollCore.ts`**: Rendering and interaction logic
- **`pianoRollUtils.ts`**: Coordinate conversion, quantization, overlap detection
- **`commandStack.ts`**: Snapshot-based undo/redo
- **`PianoRollRoot.vue`**: Vue component wrapper
- **`web-component.ts`**: Web component export

### Layer Stack (bottom to top)

1. **Grid Layer** (`listening: false`)
   - Background rectangles (alternating colors per measure)
   - Vertical lines (time grid)
   - Horizontal lines (pitch boundaries)

2. **Notes Layer** (interactive)
   - Note rectangles with labels
   - Resize handles (circles at start/end of selected notes)

3. **Lanes Layer** (`pianoRollLanes.ts`)
   - Pressure/Timbre lanes and the splitter above them, clipped to the strip
     below the note grid

4. **Overlay Layer** (UI elements)
   - Selection rectangle (marquee)
   - Cursor line

## Usage

### As Vue Component

```vue
<template>
  <PianoRollRoot
    :width="800"
    :height="400"
    :initialNotes="notes"
    :gridSubdivision="16"
    @notes-update="handleNotesUpdate"
  />
</template>

<script setup>
import PianoRollRoot from '@/pianoRoll/PianoRollRoot.vue'

const notes = ref([
  ['note1', { id: 'note1', pitch: 60, position: 0, duration: 1, velocity: 0.8 }],
  ['note2', { id: 'note2', pitch: 64, position: 1, duration: 1, velocity: 0.8 }]
])

const handleNotesUpdate = (updatedNotes) => {
  notes.value = updatedNotes
}
</script>
```

### As Web Component

```html
<piano-roll-component
  width="800"
  height="400"
></piano-roll-component>

<script type="module">
import '@/pianoRoll/web-component.ts'
</script>
```

### Public Props

- `width` *(number, default 640)*: Canvas width in pixels
- `height` *(number, default 360)*: Canvas height in pixels
- `initialNotes` *(Array<[id, NoteData]>)*: Seed notes loaded on mount
- `syncState` *(function)*: Callback invoked when internal state changes
- `showControlPanel` *(boolean, default true)*: Toggles the built-in toolbar
- `interactive` *(boolean, default true)*: Enables pointer and keyboard input

### Exposed Methods

- `setNotes(notes: NoteDataInput[])`: Replace all notes with the provided list
- `setLivePlayheadPosition(position: number)`: Update the live playhead (quarter notes)
- `setPlayheadMarkers(markers: Array<{ id, position, color? }>)`: Replace the labeled
  marker lines — any number of them, independent of the single live playhead
  (positions in quarter notes)
- `getPlayheadMarkers(): PlayheadMarker[]`: Read the markers currently rendered
- `getPlayStartPosition(): number`: Read the current queue playhead (quarter notes)
- `fitZoomToNotes()`: Zoom and scroll to fit all notes with minimum 4 beats × 12 pitches

## Interactions

### Adding Notes
- **Double-click** on empty area → adds quantized note at clicked position

### Selection
- **Click** on note → select (clears previous selection)
- **Shift + Click** → toggle note in/out of selection
- **Click + drag** on background → marquee selection
- **Shift + marquee** → add to selection

### Dragging
- **Click + drag** on selected note → move all selected notes
- Vertical dragging snaps to pitch (semitone)
- Horizontal dragging:
  - Small movements: free
  - Large movements: snap to grid
- Notes automatically snap to non-selected note start positions
- Overlapping notes shown with reduced opacity (delete preview)

### Resizing
- **Click + drag** resize handle → resize all selected notes
- Same quantization as dragging
- Start handle: changes position + duration
- End handle: changes duration only

### Keyboard Shortcuts
- **Cmd/Ctrl + Z**: Undo
- **Cmd/Ctrl + Shift + Z**: Redo
- **Backspace/Delete**: Delete selected notes
- **Arrow keys**: Move selected notes (1 semitone or 1/4 note)
- **Cmd/Ctrl + C**: Copy selected notes
- **Cmd/Ctrl + V**: Paste notes at cursor position

## Data Structures

### NoteData
```typescript
{
  id: string
  pitch: number        // 0-1
  position: number     // in quarter notes
  duration: number     // in quarter notes
  velocity: number     // 0-1
  metadata?: any
}
```

### Metadata

Metadata is free-form JSON per note, with one typed key: a top-level
`color` must be a six-digit hex string (`"#ababab"`) and becomes the note's
fill; a selected colored note keeps its fill and shows selection as a heavy
stroke. Invalid colors fall back to the default fill. Rules for known keys
live in `noteMetadataRules.ts`.

The Metadata panel edits every selected note at once. `metadataGroupEdit.ts`
merges the selection into one tree whose leaves are `shared`, `mixed`,
`partial` (`n of N`), or `conflict` (object in some notes, value in others);
arrays are atomic. Edits are path operations applied to every note as one undo
step. Setting a path where notes hold a different value is allowed and flagged
as overwriting; a rule violation blocks Save. Raw mode edits the document of
fields shared by all selected notes and diffs it back into path operations.

## Performance

- **Culling**: Only renders notes in visible viewport
- **Grid caching**: Grid only redraws on scroll/zoom
- **Batch drawing**: Single `batchDraw()` per RAF frame
- **Layer optimization**: Grid layer is `listening: false`

## Differences from SVG Version

1. **Immediate-mode rendering**: Notes outside viewport are not rendered
2. **Simpler state management**: Pure data with no Konva references in note state
3. **Snapshot-based undo/redo**: Entire state serialized as JSON for commands
4. **No explicit modes**: Interactions determined by click target
5. **RAF-based rendering**: Redraw triggered by `needsRedraw` flag

## Expression lanes

Pressure and timbre are stored per note as `mpePressure` / `mpeTimbre`:
`{ points: [{ time, value }] }`, `time` 0..1 across the note (like
`mpePitch`) and `value` 0..127. They map to `AbletonNote.pressureCurve` /
`timbreCurve` in `@avtools/music-types`.

The lanes share the stage with the notes. Everything vertical (scroll bounds,
zoom, visibility, the vertical scrollbar) uses `getNoteAreaHeight`, the stage
height minus the lanes, never the raw stage height. Stage-level note handlers
ignore pointer positions inside the lane strip, because a lane click can
destroy the node under the pointer and Konva then reports the stage as target.

Editing, modeled on Ableton's Note Expression lanes: select a note (in the grid
or by clicking its dimmed curve); click its line to add a point; drag points
(Shift for fine steps; selected points move together); double-click or Delete
to remove; drag the bar above the lanes to resize them. All edits go through
the command stack. `showPressureLane` / `showTimbreLane` props set the initial
visibility.
