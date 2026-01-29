---
name: music-types
description: Music theory and MIDI note manipulation library. Provides type definitions, data structures, and utilities for Ableton Live clips, musical scales, Bezier curve envelopes, and MPE data. Use when writing code that uses @avtools/music-types for clips, notes, scales, curves, or MIDI operations.
metadata:
  author: avtools
  version: "0.0.0"
compatibility: Pure TypeScript with zero external dependencies. Works in any JavaScript runtime.
---

# @avtools/music-types

Music theory and MIDI note manipulation library for the avTools monorepo. Provides type definitions, data structures, and utilities for working with Ableton Live clips, musical scales, Bezier curves/envelopes, and MPE (MIDI Polyphonic Expression) data.

**Package location**: `packages/music-types`
**Entry point**: `mod.ts` (re-exports from `ableton_clip.ts`, `curve_interpolation.ts`, `scale.ts`, `unit_bezier.ts`)
**Import**: `@avtools/music-types`
**External dependencies**: None

---

## Core Concepts

### Immutable Transforms
All transformation methods on `AbletonClip` and `Scale` return new instances. The originals are never mutated. This makes it safe to chain operations or reuse source data.

### Time Units
Positions and durations use Ableton's beat-based units (1.0 = one beat / quarter note). There is no sample-rate or BPM concept in this library; it works in abstract musical time.

### Scale Degree Indexing
`Scale.getByIndex(n)` maps an integer scale-degree index to a MIDI pitch. Index 0 is the root. Indices extend infinitely in both directions, wrapping through octaves. Non-scale pitches produce fractional indices via `getIndFromPitch()`, enabling interpolation between scale degrees.

### Generic Metadata
`AbletonNote<T>` carries an optional `metadata?: T` field that passes through all clone/transform operations unchanged. This lets consumers attach arbitrary data (e.g., instrument assignments, color tags) to notes.

### MPE Curve Data
Notes can carry per-note pitch, pressure, and timbre curves as arrays of `CurveValue` points with Bezier control handles. These curves are automatically scaled when notes are time-stretched or sliced.

---

## Types

### CurveValue
Defined in `curve_value.ts`. A single point on a Bezier envelope curve.

```typescript
type CurveValue = {
  timeOffset: number;  // position along the note's duration (absolute, not normalized)
  value: number;       // the parameter value at this point
  x1: number;          // Bezier control point 1 X (0-1)
  y1: number;          // Bezier control point 1 Y (0-1)
  x2: number;          // Bezier control point 2 X (0-1)
  y2: number;          // Bezier control point 2 Y (0-1)
  rooted?: boolean;    // whether this point is "rooted" for MPE scale transposition
  metadata?: any;      // pass-through data
};
```

### AbletonNote\<T\>
Defined in `ableton_clip.ts`. Represents a single MIDI note with optional MPE curves.

```typescript
type AbletonNote<T = any> = {
  pitch: number;              // MIDI pitch (0-127)
  duration: number;           // length in beats
  velocity: number;           // note-on velocity (0-127)
  offVelocity: number;        // note-off velocity
  probability: number;        // trigger probability (0-1)
  position: number;           // start time in beats from clip start
  isEnabled: boolean;         // whether the note is active
  metadata?: T;               // generic user data
  noteId?: string;            // optional unique identifier
  velocityDeviation?: number; // humanization offset
  pitchCurve?: CurveValue[];     // per-note pitch bend envelope
  pressureCurve?: CurveValue[];  // per-note aftertouch envelope
  timbreCurve?: CurveValue[];    // per-note timbre/CC74 envelope
};
```

### AbletonClipRawData
Plain-object shape matching `AbletonClip` for serialization. Has `name`, `duration`, and a `notes` array of plain note objects (same fields as `AbletonNote` minus the generic).

### PianoRollNoteLike
Simplified note shape used for piano-roll UI adapters:

```typescript
type PianoRollNoteLike = {
  id?: string;
  pitch: number;
  position: number;
  duration: number;
  velocity: number;
  mpePitch?: { points: ReadonlyArray<PianoRollMpePoint> };
  metadata?: any;
};
```

### PianoRollMpePoint
A single MPE pitch point in normalized time (0-1 within the note):

```typescript
type PianoRollMpePoint = {
  time: number;         // 0-1, normalized within note duration
  pitchOffset: number;  // semitone offset from base pitch
  metadata?: any;
  rooted?: boolean;
};
```

### NoteWithDelta
Returned by `AbletonClip.peek()` and `next()`. Contains the note plus timing deltas for sequential playback:

```typescript
type NoteWithDelta = {
  note: AbletonNote;
  preDelta: number;     // time gap before this note
  postDelta?: number;   // time gap after last note before clip loops (only on last note)
};
```

### LerpDef
Returned by `pos2lerp()`. Describes a linear interpolation position between two array indices:

```typescript
type LerpDef = {
  startInd: number;
  endInd: number;
  lerpVal: number;  // 0-1 interpolation factor
};
```

---

## API Reference

### Note Factories and Converters

#### `quickNote<T>(pitch, duration, velocity, position, metadata?): AbletonNote<T>`
Creates an `AbletonNote` with sensible defaults: `offVelocity` = velocity, `probability` = 1, `isEnabled` = true, no curves.

```typescript
const note = quickNote(60, 0.5, 100, 0);
// { pitch: 60, duration: 0.5, velocity: 100, offVelocity: 100,
//   probability: 1, position: 0, isEnabled: true }
```

#### `pianoRollNoteToAbletonNote(note: PianoRollNoteLike): AbletonNote`
Converts a piano-roll note (normalized MPE time 0-1) to an `AbletonNote` (absolute `timeOffset` in curve points). Bezier handles default to `(0.5, 0.5, 0.5, 0.5)` (linear).

#### `abletonNoteToPianoRollNote(note: AbletonNote, id?: string): PianoRollNoteLike`
Inverse of above. Converts absolute `timeOffset` values back to normalized 0-1 time. Uses `note.noteId` as the `id` if no explicit `id` is provided.

---

### AbletonClip

```typescript
class AbletonClip {
  name: string;
  duration: number;          // total clip length in beats
  notes: AbletonNote[];      // assumed sorted by position
  index: number;             // internal cursor for peek/next iteration
}
```

#### Constructor
```typescript
new AbletonClip(name: string, duration: number, notes: AbletonNote[])
```

#### `clone(): AbletonClip`
Deep clone. All notes and their curve arrays are copied.

#### `scale(factor: number): AbletonClip`
Time-stretch. Multiplies all positions, durations, and curve timeOffsets by `factor`. Returns a new clip.

```typescript
const doubled = clip.scale(2);   // half speed, twice as long
const halved = clip.scale(0.5);  // double speed, half as long
```

#### `shift(delta: number): AbletonClip`
Time-shift. Adds `delta` to every note position. Extends `duration` if any note now exceeds it.

```typescript
const later = clip.shift(4);  // move everything 4 beats later
```

#### `transpose(delta: number): AbletonClip`
Chromatic transpose. Adds `delta` semitones to every note pitch.

```typescript
const upOctave = clip.transpose(12);
```

#### `scaleTranspose(transpose: number, scale: Scale): AbletonClip`
Scale-aware transpose. Moves each note by `transpose` scale degrees within the given scale. Notes not exactly on a scale degree get snapped via `getIndFromPitch` rounding.

```typescript
const cMajor = new Scale();
const upThird = clip.scaleTranspose(2, cMajor);  // up a diatonic third
```

#### `timeSlice(start: number, end: number): AbletonClip`
Extracts a time window. Notes partially overlapping the window are trimmed. Positions are shifted so the slice starts at 0. Curve offsets are rescaled proportionally when notes are trimmed.

```typescript
const secondBar = clip.timeSlice(4, 8);
```

#### `filterDisabledNotes(): AbletonClip`
Returns a new clip with only notes where `isEnabled === true`.

#### `deltas(): number[]`
Returns inter-onset intervals. The array has `notes.length + 1` entries: each note's distance from the previous note, plus a final entry for the gap from the last note to the clip end.

#### `peek(): NoteWithDelta`
Returns the note at the current cursor position with its timing delta, without advancing the cursor. The last note in the clip also receives a `postDelta`.

#### `next(): NoteWithDelta`
Like `peek()`, but advances the cursor (wrapping around).

#### `noteBuffer(): NoteWithDelta[]`
Returns all notes as `NoteWithDelta` entries by iterating through the entire clip once. Does not disturb the current cursor position.

#### `static concat(...clips: AbletonClip[]): AbletonClip`
Concatenates clips end-to-end. Each clip is shifted so it starts where the previous one ended. Result name is `'concat'`.

```typescript
const combined = AbletonClip.concat(intro, verse, chorus);
```

#### `loop(n: number): AbletonClip`
Repeats the clip `n` times by concatenating shallow copies.

```typescript
const fourBars = oneBar.loop(4);
```

---

### clipMap

```typescript
const clipMap: Map<string, AbletonClip>
```

Global registry for named clips. Used as shared state between ALS parsing and playback/rendering code.

---

### Scale

```typescript
class Scale {
  // Default: C major diatonic (degrees [0,2,4,5,7,9,11,12], root 60)
  constructor(notes?: number[], root?: number)
}
```

If `notes` is provided, they are normalized so the smallest is 0, sorted ascending, and used as the degree pattern. The last entry defines the "octave" width (e.g., 12 for standard scales).

#### `getByIndex(index: number | string): number`
Maps a scale-degree index to a MIDI pitch. Handles octave wrapping in both directions.

**Numeric index**: Standard scale degree lookup. Index 0 = root, positive/negative extends through octaves.

**String index**: Two forms:
- `"N"` (e.g., `"3"`) -- interpreted as a chromatic offset from root: `root + N`
- `"N+M"` (e.g., `"3+1"`) -- `getByIndex(N) + M`, i.e., scale degree N plus M chromatic semitones

```typescript
const scale = new Scale();  // C major, root 60
scale.getByIndex(0);    // 60 (C4)
scale.getByIndex(2);    // 64 (E4)
scale.getByIndex(7);    // 72 (C5, one octave up)
scale.getByIndex(-1);   // 59 (B3)
scale.getByIndex("3");  // 63 (root + 3 chromatic semitones = Eb)
scale.getByIndex("2+1"); // 65 (E4 + 1 = F4)
```

#### `getIndFromPitch(pitch: number): number`
Inverse of `getByIndex`. Returns the scale-degree index for a MIDI pitch. If the pitch is not in the scale, returns a fractional index representing interpolation between the two nearest scale degrees.

```typescript
const scale = new Scale();  // C major
scale.getIndFromPitch(64);   // 2 (E4 is degree 2)
scale.getIndFromPitch(61);   // 0.5 (C#, halfway between C and D in terms of index)
```

#### `getShapeFromInd(rootInd: number, shape: number[]): number[]`
Maps an array of relative scale-degree offsets from a root index to MIDI pitches. Useful for building chords.

```typescript
const scale = new Scale();
scale.getShapeFromInd(0, [0, 2, 4]);  // [60, 64, 67] -- C major triad
scale.getShapeFromInd(5, [0, 2, 4]);  // [69, 72, 76] -- A minor triad
```

#### `getMultiple(indices: (number | string)[]): number[]`
Batch version of `getByIndex`. Maps multiple indices at once.

#### `cycle(n: number): Scale`
Rotates the interval pattern by `n` steps. Positive cycles up (removes first interval, appends to end), negative cycles down. Does not change the root.

```typescript
const dorian = new Scale().cycle(1);   // D dorian interval pattern, root still 60
```

#### `invert(n: number): Scale`
Like `cycle` but also shifts the root. `invert(1)` sets the new root to what was scale degree 1, `invert(-1)` sets root to scale degree -1. Produces modal inversions that start on a different pitch.

```typescript
const dDorian = new Scale().invert(1);  // root = 62, dorian intervals
```

#### `deltas(): number[]`
Returns the intervals between consecutive degrees. For default major: `[2, 2, 1, 2, 2, 2, 1]`.

#### `setDegrees(degrees: number[]): void` / `getDegrees(): number[]`
Get/set the raw degree array. Mutates in place (used internally by `cycle`/`invert`).

#### `setRoot(root: number): void` / `getRoot(): number`
Get/set the MIDI root pitch. Mutates in place.

---

### Scale Utilities

#### `bestFitScale(clip: AbletonClip): Scale`
Finds the best-fitting diatonic scale/mode for a clip by trying all 12 roots x 7 modes. Scores by number of in-scale notes, with tiebreakers favoring root/fifth/fourth emphasis.

#### `fitToScale(clip: AbletonClip, scale?: Scale): { clip: AbletonClip; scale: Scale }`
Snaps out-of-scale notes to the nearest scale degree. If no scale is provided, calls `bestFitScale` first. Returns both the adjusted clip and the scale used.

```typescript
const { clip: fitted, scale } = fitToScale(rawClip);
```

#### `scaleFromClip(clip: AbletonClip, rootPicker?: (clip: AbletonClip) => number): Scale`
Builds a custom scale from the unique pitch classes in a clip. By default uses the lowest pitch as root. An optional `rootPicker` function can choose a different root.

```typescript
const customScale = scaleFromClip(myClip);
const customScale2 = scaleFromClip(myClip, (c) => 60);  // force root to C4
```

---

### MPE Scale Transposition

#### `scaleTransposeMPE(note: AbletonNote, transpose: number, scale: Scale): AbletonNote`
Scale-aware transposition that also adjusts MPE pitch curves. Each "rooted" point in the pitch curve is mapped through the scale independently, so pitch bends between scale degrees are preserved correctly. Non-rooted points receive interpolated shifts.

This is the MPE-aware version of `AbletonClip.scaleTranspose()` and should be used when notes have pitch curves that need to respect scale structure.

```typescript
const transposed = scaleTransposeMPE(mpeNote, 2, cMajor);
```

---

### Curve Interpolation

Defined in `curve_interpolation.ts`.

#### `pos2lerp(pos: number, positions: number[]): LerpDef`
Given a position and a sorted array of positions, returns the two bounding indices and the interpolation factor.

#### `curve2val(pos: number, curveVals: CurveValue[]): number`
Evaluates a Bezier envelope at a given time position. Finds the surrounding `CurveValue` points, uses the left point's Bezier handles to compute the easing, then interpolates the value.

```typescript
const curve = [
  createCurveValue(0, 0),      // start at 0
  createCurveValue(1, 127),    // ramp to 127 over 1 beat
];
curve2val(0.5, curve);  // ~63.5 (linear by default)
```

Returns the first value if `pos` is before the curve, last value if after. Returns 0 for empty curves, the single value for length-1 curves.

---

### UnitBezier

```typescript
class UnitBezier {
  constructor(p1x: number, p1y: number, p2x: number, p2y: number)
  solve(x: number, epsilon?: number): number
}
```

Cubic Bezier curve solver on the unit square (CSS timing function style). Given control points `(p1x, p1y)` and `(p2x, p2y)`, `solve(x)` returns the corresponding `y` value. Uses Newton-Raphson with bisection fallback.

Ported from `kotlin-live-lib-3 UnitBezier.kt`.

---

### CurveValue Factories

#### `createCurveValue(timeOffset, value, x1?, y1?, x2?, y2?): CurveValue`
Creates a `CurveValue`. Bezier handles default to `(0.5, 0.5, 0.5, 0.5)` which produces a linear-ish easing.

#### `cloneCurveValue(cv: CurveValue): CurveValue`
Shallow clone via spread. Sufficient because all fields are primitives.

---

## Usage Patterns

### Building a clip from scratch

```typescript
import { AbletonClip, quickNote, Scale } from "@avtools/music-types";

const scale = new Scale(); // C major
const notes = [0, 2, 4, 5, 7].map((deg, i) =>
  quickNote(scale.getByIndex(deg), 0.5, 100, i * 0.5)
);
const clip = new AbletonClip("ascending", 4, notes);
```

### Chaining transformations

```typescript
const variation = clip
  .scaleTranspose(2, scale)   // up a third
  .scale(0.5)                 // double speed
  .shift(4);                  // start at beat 4
```

### Sequential playback with deltas

```typescript
for (const { note, preDelta, postDelta } of clip.noteBuffer()) {
  await sleep(preDelta * msPerBeat);
  playNote(note.pitch, note.velocity, note.duration * msPerBeat);
}
```

### Iterative playback with cursor

```typescript
while (true) {
  const { note, preDelta, postDelta } = clip.next();
  await sleep(preDelta * msPerBeat);
  playNote(note.pitch, note.velocity, note.duration * msPerBeat);
  if (postDelta) await sleep(postDelta * msPerBeat);
}
```

### Building chords from scale shapes

```typescript
const scale = new Scale([0, 2, 4, 5, 7, 9, 11, 12], 48); // C major, root C3
const majorTriad = scale.getShapeFromInd(0, [0, 2, 4]);   // [48, 52, 55]
const minorTriad = scale.getShapeFromInd(1, [0, 2, 4]);   // [50, 53, 57]
```

### Modal scales

```typescript
const ionian = new Scale();           // C Ionian (major)
const dorian = ionian.cycle(1);       // Dorian interval pattern, root C
const dDorian = ionian.invert(1);     // Dorian rooted on D (root=62)
const phrygian = ionian.invert(2);    // Phrygian rooted on E (root=64)
```

### Fitting notes to a scale

```typescript
import { fitToScale, bestFitScale, scaleFromClip } from "@avtools/music-types";

// Auto-detect scale and snap
const { clip: snapped, scale: detected } = fitToScale(rawClip);

// Use a specific scale
const minor = new Scale([0, 2, 3, 5, 7, 8, 10, 12], 60);
const { clip: snapped2 } = fitToScale(rawClip, minor);

// Build a scale from existing material
const custom = scaleFromClip(referenceClip);
```

### Evaluating MPE curves

```typescript
import { curve2val, createCurveValue } from "@avtools/music-types";

const pressureCurve = [
  createCurveValue(0, 0),
  createCurveValue(0.25, 127),  // attack
  createCurveValue(1, 80),      // sustain
];

// Sample at any point
const pressure = curve2val(0.1, pressureCurve);
```

### Piano roll conversion round-trip

```typescript
import {
  pianoRollNoteToAbletonNote,
  abletonNoteToPianoRollNote,
} from "@avtools/music-types";

// From UI to engine
const abletonNote = pianoRollNoteToAbletonNote(pianoRollNote);

// From engine to UI
const uiNote = abletonNoteToPianoRollNote(abletonNote, "note-123");
```

---

## Caveats and Gotchas

1. **Notes assumed sorted by position.** `AbletonClip` does not enforce sorting. If you construct a clip manually, sort notes by `position` before passing them in, or `deltas()`, `peek()`, and `next()` will produce incorrect timing.

2. **`scale()` stretches curves too.** Time-stretching a clip also scales `pitchCurve`, `pressureCurve`, and `timbreCurve` `timeOffset` values. This is correct behavior but means you should not manually adjust curve offsets after calling `scale()`.

3. **`shift()` extends duration.** If shifting notes causes any note to end beyond the current `duration`, the clip duration is expanded to fit. It does not wrap notes.

4. **`loop()` uses shallow copies.** The individual clips passed to `concat` are shallow references (the same `this`), but `concat` calls `shift()` which calls `clone()`, so the resulting notes are properly independent.

5. **`scaleTranspose` vs `scaleTransposeMPE`.** The `AbletonClip.scaleTranspose()` method only moves the base pitch. If notes have MPE pitch curves, use `scaleTransposeMPE()` instead to properly remap curve control points through the scale.

6. **Fractional scale indices.** `getIndFromPitch` returns fractional indices for notes not in the scale. Passing a fractional index to `getByIndex` will truncate to integer, so round explicitly if you need the nearest scale tone.

7. **String index semantics.** `scale.getByIndex("5")` returns `root + 5` (chromatic), while `scale.getByIndex(5)` returns the 5th scale degree. These are different values for most scales.

8. **`cycle` vs `invert`.** `cycle(n)` rotates the interval pattern but keeps the same root pitch. `invert(n)` rotates the intervals AND moves the root to the nth scale degree. Use `cycle` for abstract mode changes; use `invert` for concrete modal transpositions.

9. **CurveValue timeOffset is absolute.** Unlike `PianoRollMpePoint.time` (normalized 0-1), `CurveValue.timeOffset` is in beats relative to the note start. The conversion functions handle this difference.

10. **`clipMap` is global mutable state.** It is a plain `Map` with no event system. Coordinate access carefully if multiple consumers read/write it.

---

## Monorepo Context

- **Source files**: `packages/music-types/` -- `mod.ts`, `ableton_clip.ts`, `scale.ts`, `curve_value.ts`, `curve_interpolation.ts`, `unit_bezier.ts`
- **Package config**: `packages/music-types/deno.json` -- exports `./mod.ts`
- **Consumers**:
  - `deno-notebooks`: ALS file parsing, clip analysis, generative music experiments
  - `browser-projections`: clip management, piano roll rendering, MPE playback
- **No external dependencies.** This package is entirely self-contained.
- **Deno-first.** Uses `.ts` extensions in imports. Compatible with Deno and bundlers that handle TypeScript imports natively.
