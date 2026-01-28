# MPE Clip Playback Implementation Plan

This document outlines the implementation plan for adding Ableton clip parsing with MPE data extraction and playback to denoMusicNotebook.

## Overview

The goal is to port the MPE clip parsing and playback functionality from `kot-live-lib-3` to TypeScript, integrating with the existing `TimeContext` timing engine and `MPEDevice` infrastructure in denoMusicNotebook.

## Reference Implementations

| Feature | Kotlin (kot-live-lib-3) | TypeScript (browser_drawn_projections) |
|---------|-------------------------|----------------------------------------|
| ALS Parsing | `AlsParsing.kt` | `node_src/alsParsing.ts` |
| Note Structure | `AbletonNote` class | `AbletonNote` type |
| MPE Curves | `CurveValue`, per-note curves | Not implemented |
| Curve Interpolation | `UnitBezier.kt`, `curve2val()` | Not implemented |
| MPE Playback | `launchAbletonNote()`, `launchCurve2()` | Not implemented |
| File Watching | N/A | `fs.watchFile()` + WebSocket |

---

## Phase 1: MPE Data Structures

### 1.1 Add `CurveValue` to `packages/music-types/curve_value.ts`

Port the `CurveValue` class from `AlsParsing.kt:96-138`:

```typescript
export type CurveValue = {
  timeOffset: number;  // relative time within note duration (0-1 normalized or absolute)
  value: number;       // automation value
  x1: number;          // Bezier control point 1 X (default 0.5)
  y1: number;          // Bezier control point 1 Y (default 0.5)
  x2: number;          // Bezier control point 2 X (default 0.5)
  y2: number;          // Bezier control point 2 Y (default 0.5)
};

export function createCurveValue(timeOffset: number, value: number): CurveValue;
export function cloneCurveValue(cv: CurveValue): CurveValue;
```

### 1.2 Add `UnitBezier` to `packages/music-types/unit_bezier.ts`

Port the `UnitBezier` class from `UnitBezier.kt`:

```typescript
export class UnitBezier {
  constructor(p1x: number, p1y: number, p2x: number, p2y: number);
  solve(x: number, epsilon?: number): number;
}
```

Key implementation details:
- Newton's method for fast solving (8 iterations)
- Bisection fallback for reliability
- Polynomial coefficients computed from control points

### 1.3 Extend `packages/music-types/ableton_clip.ts`

Extend `AbletonNote` type to include MPE data:

```typescript
export type AbletonNote<T = any> = {
  pitch: number;
  duration: number;
  velocity: number;
  offVelocity: number;
  probability: number;
  position: number;
  isEnabled: boolean;
  metadata?: T;
  // NEW: MPE curve data
  noteId?: string;
  velocityDeviation?: number;
  pitchCurve?: CurveValue[];    // CC "-2" in Ableton
  pressureCurve?: CurveValue[]; // CC "-1" in Ableton
  timbreCurve?: CurveValue[];   // CC "74" in Ableton
};
```

Update `AbletonClip.clone()` to deep-clone curve arrays.

Update time-scaling methods (`scale()`, `timeSlice()`) to also scale curve `timeOffset` values - following `AbletonNote.tscale()` in Kotlin.

---

## Phase 2: ALS Parsing with MPE Extraction

### 2.1 Create `tools/alsParsing.ts`

A Deno-native ALS parser that extracts MPE data. Based on `browser_drawn_projections/node_src/alsParsing.ts` but extended with MPE extraction from `kot-live-lib-3`.

**Dependencies:**
- `pako` or native `DecompressionStream` for GZIP decompression
- `fast-xml-parser` or similar XML parser

**Parsing Logic:**

```typescript
export async function parseAbletonLiveSet(alsPath: string): Promise<Map<string, AbletonClip>>;
```

1. Read .als file as bytes
2. GZIP decompress to XML string
3. Parse XML to object tree
4. Navigate to clips: `Ableton/LiveSet/Tracks/MidiTrack[n]/DeviceChain/MainSequencer/ClipSlotList/ClipSlot[n]`
5. For each `MidiClip`:
   - Extract clip metadata (name, duration from `CurrentEnd`)
   - Extract notes from `Notes/KeyTracks/KeyTrack/Notes/MidiNoteEvent`
   - Build `noteId -> AbletonNote` map
6. **NEW: Extract MPE curves** from `Notes/PerNoteEventStore/EventLists/PerNoteEventList`:
   - Each `PerNoteEventList` has `NoteId` and `CC` attributes
   - CC values: `"-1"` = pressure, `"-2"` = pitch, `"74"` = timbre
   - Extract `PerNoteEvent` children with `TimeOffset`, `Value`, `CurveControl1X/Y`, `CurveControl2X/Y`
   - Attach curves to corresponding notes via `noteId`

**XML Structure Reference** (from kot-live-lib-3 mpe_clip2.xml):
```xml
<PerNoteEventList Id="0" NoteId="1" CC="-2">
  <Events>
    <PerNoteEvent TimeOffset="0.881889..." Value="0"
      CurveControl1X="0.5" CurveControl1Y="0.5"
      CurveControl2X="0.5" CurveControl2Y="0.5" />
    <PerNoteEvent TimeOffset="1.0748..." Value="341.3125" ... />
  </Events>
</PerNoteEventList>
```

### 2.2 File Watching with Live Reload

Create `tools/abletonWatcher.ts`:

A notebook-friendly class that watches an ALS file and provides simple clip access:

```typescript
export class AbletonWatcher {
  /**
   * Create a watcher for an Ableton Live Set
   * Automatically parses on construction and watches for changes
   */
  constructor(alsPath: string);

  /**
   * Get a clip by name
   * @returns AbletonClip or null if not found
   */
  clip(name: string): AbletonClip | null;

  /**
   * Get a clip by track and slot index (1-indexed to match Ableton UI)
   * @returns AbletonClip or null if not found
   */
  clip(trackNum: number, clipSlotNum: number): AbletonClip | null;

  /**
   * List all available clip names
   */
  listClips(): string[];

  /**
   * Force re-parse of the ALS file
   */
  refresh(): Promise<void>;

  /**
   * Register callback for when clips are updated
   */
  onUpdate(callback: () => void): () => void;

  /**
   * Stop watching and clean up
   */
  dispose(): void;

  /**
   * Path to the watched ALS file
   */
  readonly path: string;

  /**
   * Whether the watcher is currently active
   */
  readonly isWatching: boolean;
}
```

**Implementation Details:**

```typescript
export class AbletonWatcher {
  #path: string;
  #clipsByName = new Map<string, AbletonClip>();
  #clipsByPosition = new Map<string, AbletonClip>(); // "trackNum-slotNum" -> clip
  #watcher: Deno.FsWatcher | null = null;
  #updateCallbacks = new Set<() => void>();
  #debounceTimer: number | null = null;
  #isWatching = false;

  constructor(alsPath: string) {
    this.#path = alsPath;
    // Initial parse (sync or kicked off async)
    this.#parseAndStore();
    this.#startWatching();
  }

  clip(nameOrTrack: string | number, clipSlotNum?: number): AbletonClip | null {
    if (typeof nameOrTrack === "string") {
      return this.#clipsByName.get(nameOrTrack) ?? null;
    }
    if (typeof clipSlotNum === "number") {
      const key = `${nameOrTrack}-${clipSlotNum}`;
      return this.#clipsByPosition.get(key) ?? null;
    }
    return null;
  }

  // ... rest of implementation
}
```

**Usage in Notebook:**

```typescript
// Create watcher - starts watching immediately
const watcher = new AbletonWatcher("./my_project/my_project.als");

// Access clips by name
const melody = watcher.clip("melody");

// Access clips by position (track 1, slot 3)
const bassline = watcher.clip(1, 3);

// List available clips
console.log(watcher.listClips());

// React to changes
watcher.onUpdate(() => {
  console.log("Clips updated!");
  const newMelody = watcher.clip("melody");
});

// Clean up when done
watcher.dispose();
```

**Key Features:**
- No WebSocket needed - direct file system access in Deno
- Debounced updates (Ableton saves frequently during editing)
- Dual access patterns: by name or by track/slot position
- Optional update callbacks for reactive notebook cells
- Easy cleanup with `dispose()`

---

## Phase 3: Curve Interpolation

### 3.1 Add `curve_interpolation.ts` to `packages/music-types`

Port `curve2val()` and supporting functions from `AlsParsing.kt:240-280`:

```typescript
import { UnitBezier } from "./unit_bezier.ts";
import type { CurveValue } from "./curve_value.ts";

type LerpDef = {
  startInd: number;
  endInd: number;
  lerpVal: number;
};

/**
 * Find interpolation position between curve points
 */
export function pos2lerp(pos: number, positions: number[]): LerpDef;

/**
 * Evaluate curve value at arbitrary position using Bezier interpolation
 * @param pos - Position to evaluate (typically 0 to note duration)
 * @param curveVals - Array of curve control points
 * @returns Interpolated value
 */
export function curve2val(pos: number, curveVals: CurveValue[]): number;
```

Key implementation details from Kotlin:
- Single point curves return constant value
- Positions before first point extrapolate to first value
- Positions after last point extrapolate to last value
- Between points: find segment, compute Bezier t-parameter, interpolate values

---

## Phase 4: MPE Playback Engine

### 4.1 Create `tools/mpePlayback.ts`

This is the core playback engine that integrates with `TimeContext` and `MPEDevice`.

**Value Range Conversions:**

Ableton stores MPE values in specific ranges that need conversion for MIDI output:
- **Pitch bend**: Ableton uses semitone-based values; convert to 14-bit MIDI (0-16383, center 8192)
- **Pressure**: 0-127 (already MIDI compatible)
- **Timbre (CC74)**: 0-127 (already MIDI compatible)

```typescript
export type MPEPlaybackConfig = {
  pitchBendRange?: number;  // semitones, default 48 (like kot-live-lib-3)
  curveStepMs?: number;     // curve update rate, default 10ms
  noteGap?: number;         // duration multiplier for early note-off, default 0.975
};

/**
 * Convert Ableton pitch bend value to MIDI 14-bit value
 * @param abletonValue - Value from Ableton curve
 * @param pbRange - Pitch bend range in semitones
 */
export function abletonBendToMidi(abletonValue: number, pbRange: number): number;
```

### 4.2 Curve Playback Coroutine

Port `launchCurve2()` from `AlsParsing.kt:302-324`:

```typescript
import type { TimeContext } from "@avtools/core-timing";
import type { MPENoteRef } from "../midi/mpe_device.ts";

export type CurveType = "pressure" | "pitchBend" | "timbre";

/**
 * Launch a coroutine that plays back an automation curve
 * Updates the MPE note reference at regular intervals
 */
export function launchCurve(
  ctx: TimeContext,
  noteRef: MPENoteRef,
  curveVals: CurveValue[],
  duration: number,
  curveType: CurveType,
  config: MPEPlaybackConfig
): { cancel: () => void };
```

Implementation:
- Use `ctx.branch()` to spawn curve playback coroutine
- Sample curve at `curveStepMs` intervals using `curve2val()`
- Call appropriate `noteRef.pitchBend()`, `noteRef.pressure()`, or `noteRef.timbre()`
- Scale curve timeOffset values by `noteGap` to end slightly early
- Return cancel handle for cleanup

### 4.3 Note Playback

Port `launchAbletonNote()` from `AlsParsing.kt:338-362`:

```typescript
export type NotePlaybackResult = {
  cancel: () => void;
  noteRef: MPENoteRef | null;
};

/**
 * Launch parallel coroutines for a single MPE note:
 * - Pressure curve automation
 * - Pitch bend curve automation
 * - Timbre curve automation
 * - Note on/off with timing
 */
export async function playMPENote(
  ctx: TimeContext,
  note: AbletonNote,
  mpeDevice: MPEDevice,
  config?: MPEPlaybackConfig
): Promise<NotePlaybackResult>;
```

Implementation:
1. Allocate MPE channel via `mpeDevice.noteOn()` with initial curve values
2. Launch parallel curve coroutines via `ctx.branch()` for each non-empty curve
3. Schedule note-off after `note.duration * noteGap`
4. Return cancel handle that cleans up all coroutines

---

## Phase 5: Clip Playback Helper

### 5.1 Create `playMPEClip()` Function

The main user-facing API:

```typescript
import type { TimeContext } from "@avtools/core-timing";
import type { AbletonClip } from "@avtools/music-types";
import type { MPEDevice } from "../midi/mpe_device.ts";

export type ClipPlaybackOptions = {
  /** Pitch bend range in semitones (default 48) */
  pitchBendRange?: number;

  /** Curve update rate in milliseconds (default 10) */
  curveStepMs?: number;

  /** Duration multiplier for early note-off (default 0.975) */
  noteGap?: number;

  /** Optional callback before each note plays */
  onNoteStart?: (note: AbletonNote, index: number) => AbletonNote | null;

  /** If true, wait for all notes to finish. If false, return after scheduling (default true) */
  waitForCompletion?: boolean;
};

export type ClipPlaybackHandle = {
  cancel: () => void;
  promise: Promise<void>;
};

/**
 * Play an Ableton clip with full MPE expression through an MPE device
 *
 * @param clip - The AbletonClip to play
 * @param ctx - TimeContext for timing control
 * @param mpeDevice - MPE output device
 * @param options - Playback configuration
 * @returns Handle with cancel function and completion promise
 *
 * @example
 * ```typescript
 * const clip = clipMap.get("my-clip")!;
 * const handle = playMPEClip(clip, ctx, mpeDevice);
 *
 * // Later, to cancel:
 * handle.cancel();
 *
 * // Or wait for completion:
 * await handle.promise;
 * ```
 */
export function playMPEClip(
  clip: AbletonClip,
  ctx: TimeContext,
  mpeDevice: MPEDevice,
  options?: ClipPlaybackOptions
): ClipPlaybackHandle;
```

**Implementation Strategy:**

Based on `play3()` from `NoteStructs.kt:271-296`:

```typescript
export function playMPEClip(
  clip: AbletonClip,
  ctx: TimeContext,
  mpeDevice: MPEDevice,
  options?: ClipPlaybackOptions
): ClipPlaybackHandle {
  const config: MPEPlaybackConfig = {
    pitchBendRange: options?.pitchBendRange ?? 48,
    curveStepMs: options?.curveStepMs ?? 10,
    noteGap: options?.noteGap ?? 0.975,
  };

  const noteHandles: NotePlaybackResult[] = [];

  const mainTask = ctx.branch(async (branchCtx) => {
    const notes = clip.notes.filter(n => n.isEnabled);

    for (let i = 0; i < notes.length; i++) {
      let note = notes[i];

      // Apply optional note callback
      if (options?.onNoteStart) {
        const modified = options.onNoteStart(note, i);
        if (modified === null) continue; // skip this note
        note = modified;
      }

      // Calculate wait time to this note's position
      const currentTime = branchCtx.progTime;
      const noteStart = note.position;
      if (noteStart > currentTime) {
        await branchCtx.waitSec(noteStart - currentTime);
      }

      // Launch note (non-blocking - note plays in parallel)
      const handle = await playMPENote(branchCtx, note, mpeDevice, config);
      noteHandles.push(handle);
    }

    // Optionally wait for clip duration
    if (options?.waitForCompletion !== false) {
      const remaining = clip.duration - branchCtx.progTime;
      if (remaining > 0) {
        await branchCtx.waitSec(remaining);
      }
    }
  });

  return {
    cancel: () => {
      mainTask.cancel();
      noteHandles.forEach(h => h.cancel());
    },
    promise: mainTask.promise,
  };
}
```

---

## Phase 6: Integration & Testing

### 6.1 Module Exports

Create `tools/mpe_clip_playback/mod.ts`:

```typescript
export * from "@avtools/music-types";
export * from "./alsParsing.ts";
export * from "./alsFileWatcher.ts";
export * from "./mpePlayback.ts";
```

### 6.2 Example Usage

Create `examples/mpe_clip_example.ts`:

```typescript
import { MidiAccess } from "../midi/mod.ts";
import { MPEDevice } from "../midi/mpe_device.ts";
import { launch } from "@avtools/core-timing";
import { AbletonWatcher } from "../tools/abletonWatcher.ts";
import { playMPEClip } from "../tools/mpePlayback.ts";

// Create watcher - parses immediately and watches for changes
const watcher = new AbletonWatcher("./my_project/my_project.als");

// Access clips by name or position
const melody = watcher.clip("melody")!;
const bassline = watcher.clip(1, 2); // track 1, slot 2

const midi = await MidiAccess.open();
const output = midi.openOutput("My Synth");
const mpeDevice = new MPEDevice(output, { zone: "lower" });

await launch(async (ctx) => {
  // Play clip once
  await playMPEClip(melody, ctx, mpeDevice).promise;

  // Play transposed with custom pitch bend range
  await playMPEClip(melody.transpose(7), ctx, mpeDevice, {
    pitchBendRange: 24,
  }).promise;

  // Play looped
  const looped = melody.loop(4);
  await playMPEClip(looped, ctx, mpeDevice).promise;
});

// React to Ableton saves
watcher.onUpdate(() => {
  console.log("Clips updated, re-fetch with watcher.clip()");
});

// Clean up when done
watcher.dispose();
```

### 6.3 Test Cases

Create `tools/mpe_clip_playback/tests/`:

1. **Curve interpolation tests**: Verify `curve2val()` matches Kotlin behavior
2. **Bezier solver tests**: Verify `UnitBezier.solve()` accuracy
3. **ALS parsing tests**: Parse known .als files and verify MPE data extraction
4. **Timing tests**: Verify curve updates happen at correct intervals
5. **Integration test**: Parse real clip, play through virtual MIDI, verify output

---

## File Structure Summary

```
avTools/
├── packages/
│   └── music-types/
│       ├── ableton_clip.ts        # Extended with MPE fields
│       ├── curve_value.ts         # NEW
│       ├── unit_bezier.ts         # NEW
│       └── curve_interpolation.ts # NEW
└── apps/deno-notebooks/
    ├── tools/
    │   ├── alsParsing.ts         # NEW - ALS parser with MPE
    │   ├── abletonWatcher.ts     # NEW - Live reload watcher class
    │   └── mpePlayback.ts        # NEW - playMPEClip, playMPENote
    ├── midi/
    │   └── mpe_device.ts         # Existing (no changes needed)
    └── examples/
        └── mpe_clip_example.ts   # NEW
```

---

## Implementation Order

1. **Phase 1.1-1.2**: `CurveValue` type and `UnitBezier` class (no dependencies)
2. **Phase 1.3**: Extend `AbletonNote` type (depends on 1.1)
3. **Phase 3**: Curve interpolation functions (depends on 1.1, 1.2)
4. **Phase 2.1**: ALS parsing with MPE extraction (depends on 1.3)
5. **Phase 4.1-4.3**: MPE playback engine (depends on 3, existing MPEDevice)
6. **Phase 5**: `playMPEClip()` helper (depends on 4)
7. **Phase 2.2**: File watching (can be done in parallel after 2.1)
8. **Phase 6**: Integration and testing

---

## Notes & Considerations

### Pitch Bend Value Conversion

Ableton stores pitch bend as semitone offsets. The Kotlin implementation uses:
- `pbRange = 48` semitones default
- Conversion: `getBend(start, end)` converts semitone distance to MIDI bend value

MIDI pitch bend is 14-bit (0-16383, center 8192):
```typescript
function semitoneToMidiBend(semitones: number, pbRange: number): number {
  const normalized = semitones / pbRange; // -1 to 1
  const midi = Math.round(8192 + normalized * 8191);
  return Math.max(0, Math.min(16383, midi));
}
```

### Curve TimeOffset Interpretation

From Ableton XML, `TimeOffset` values appear to be relative to note start, not normalized. The Kotlin code applies `gap` scaling:
```kotlin
gappedVals.forEach { it.timeOffset *= gap }
```

Need to verify if timeOffset is in beats or seconds in Ableton's format.

### Offline vs Realtime

The `TimeContext` abstraction should make offline and realtime playback use identical code. For offline rendering (e.g., MIDI file export), use `OfflineRunner` to step through time.

### Voice Stealing

The existing `MPEDevice` handles voice overflow with "oldest" stealing. This should work transparently with clip playback - notes that can't allocate a channel will return `null` from `noteOn()`.

### Memory Management

Long clips with many notes and curves could accumulate handles. The `playMPEClip` cancel function should clean up all spawned coroutines. Consider using `WeakRef` or explicit cleanup for long-running sessions.
