# Deno Push 2 Implementation Plan

## Overview

A Deno library for Ableton Push 2 with three capabilities:
1. **MIDI events** — named button/pad/encoder/touchstrip callbacks via existing `midi_bridge`
2. **LED control** — set pad and button colors via MIDI output
3. **Display rendering** — 960x160 screen driven by p5gpu at ~20fps

### File Structure

```
apps/deno-notebooks/
  native/push2_display/
    Cargo.toml
    src/lib.rs

  push2/
    ffi.ts              # Deno.dlopen wrapper for push2_display native lib
    constants.ts        # all button/pad/encoder name mappings
    display.ts          # display pipeline: p5gpu render, readback, FFI send
    push2.ts            # main Push2 class: MIDI routing + LED control + display
    types.ts            # shared types and interfaces

  examples/
    push2_demo.ts       # full API demo
```

---

## Part 1: Rust Crate — `native/push2_display`

### Purpose
Receives RGBA pixel data from TypeScript, converts to the Push 2 display protocol, and sends via USB bulk OUT. "Thick" design — all pixel processing happens in Rust.

### Cargo.toml Dependencies
- `nusb` — pure-Rust USB (bulk OUT transfers)
- No other dependencies needed

### Exported FFI Functions

```rust
/// Find and open the Push 2 USB device (vendor 0x2982, product 0x1967).
/// Claims interface 0, locates the bulk OUT endpoint.
/// Returns opaque handle pointer, or null on failure.
#[no_mangle]
pub extern "C" fn push2_display_open() -> *mut Push2DisplayState

/// Close the USB device and release resources.
#[no_mangle]
pub extern "C" fn push2_display_close(state: *mut Push2DisplayState)

/// Send a complete frame to the display.
/// rgba_ptr: pointer to 960*160*4 = 614,400 bytes of RGBA pixel data
/// Returns 0 on success, negative error code on failure.
///
/// Internally performs:
///   1. RGBA -> BGR565 conversion (960x160 u16 array)
///   2. XOR with signal shaping pattern [0xE7F3, 0xE7FF] repeating
///   3. Pack into line format: 960 pixels (1920 bytes) + 128 filler bytes = 2048 bytes/line
///   4. Send 16-byte frame header via bulk OUT
///   5. Send 327,680-byte frame payload via bulk OUT
#[no_mangle]
pub extern "C" fn push2_display_send_rgba_frame(
    state: *mut Push2DisplayState,
    rgba_ptr: *const u8,
    width: u32,   // expected 960
    height: u32,  // expected 160
) -> i32

/// Check if the USB device is still connected.
/// Returns 1 if connected, 0 if not.
#[no_mangle]
pub extern "C" fn push2_display_is_connected(state: *mut Push2DisplayState) -> u32
```

### Internal Rust Implementation Notes

**Device discovery and setup:**
```rust
let device_info = nusb::list_devices()?
    .find(|d| d.vendor_id() == 0x2982 && d.product_id() == 0x1967)?;
let device = device_info.open()?;       // .open() returns MaybeFuture, use .wait()
let interface = device.claim_interface(0)?;
// Store interface + endpoint reference in Push2DisplayState
```

**Frame sending (blocking, called from TS setInterval):**
```rust
fn send_frame(state: &Push2DisplayState, rgba: &[u8]) -> Result<(), Error> {
    let mut frame_buf = vec![0u8; FRAME_TOTAL_BYTES]; // 327,680

    // 1. Convert RGBA to BGR565 + XOR, pack with filler
    for line in 0..160 {
        for px in 0..960 {
            let src = (line * 960 + px) * 4;
            let r = rgba[src] >> 3;
            let g = rgba[src + 1] >> 2;
            let b = rgba[src + 2] >> 3;
            let bgr565 = (b as u16) << 11 | (g as u16) << 5 | r as u16;
            let xor_val = if px % 2 == 0 { 0xE7F3u16 } else { 0xE7FFu16 };
            let pixel = bgr565 ^ xor_val;

            let dst = line * 2048 + px * 2;
            frame_buf[dst] = (pixel & 0xFF) as u8;       // little-endian
            frame_buf[dst + 1] = (pixel >> 8) as u8;
        }
        // Filler bytes at offset line*2048 + 1920..line*2048 + 2048 stay zero
    }

    // 2. Bulk OUT: header then frame
    let endpoint = interface.bulk_out(0x01);
    endpoint.transfer_blocking(FRAME_HEADER.into(), Duration::from_millis(1000));
    endpoint.transfer_blocking(frame_buf.into(), Duration::from_millis(1000));
    Ok(())
}
```

**Frame header constant:**
```rust
const FRAME_HEADER: [u8; 16] = [
    0xFF, 0xCC, 0xAA, 0x88,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
];
```

### Build
Standard `cargo build --release` produces `libpush2_display.dylib` (macOS) / `.so` (Linux).
Follows the same pattern as midi_bridge, deno_window, etc.

---

## Part 2: TypeScript — `push2/ffi.ts`

Thin Deno.dlopen wrapper following the pattern in `midi/ffi.ts`, `syphon/ffi.ts`, etc.

```typescript
const symbols = {
  push2_display_open:            { parameters: [], result: "pointer" },
  push2_display_close:           { parameters: ["pointer"], result: "void" },
  push2_display_send_rgba_frame: { parameters: ["pointer", "buffer", "u32", "u32"], result: "i32" },
  push2_display_is_connected:    { parameters: ["pointer"], result: "u32" },
} as const;

export function openLibrary(libPath?: string): Deno.DynamicLibrary<typeof symbols> {
  const path = libPath ?? defaultLibPath("push2_display");
  return Deno.dlopen(path, symbols);
}
```

---

## Part 3: TypeScript — `push2/constants.ts`

Mechanical port of push2-python's `constants.py` and `push2_map.py`.

### Button Definitions

```typescript
// Each button: name -> CC number
// Buttons send CC with value 127 (pressed) or 0 (released)
export const BUTTONS: Record<string, number> = {
  "TapTempo": 3, "Metronome": 9, "Delete": 118, "Undo": 119,
  "Mute": 60, "Solo": 61, "Stop": 29,
  "Convert": 35, "DoubleLoop": 117, "Quantize": 116,
  "Duplicate": 88, "New": 87, "FixedLength": 90,
  "Automate": 89, "Record": 86, "Play": 85,
  "Upper1": 102, "Upper2": 103, /* ...through Upper8: 109 */
  "Lower1": 20, "Lower2": 21, /* ...through Lower8: 27 */
  "Master": 28, "Setup": 30, "User": 59,
  "AddDevice": 52, "AddTrack": 53, "Device": 110,
  "Mix": 112, "Browse": 111, "Clip": 113,
  "Left": 44, "Right": 45, "Up": 46, "Down": 47,
  "PageLeft": 62, "PageRight": 63,
  "OctaveUp": 55, "OctaveDown": 54,
  "Shift": 49, "Select": 48,
  "1/32t": 43, "1/32": 42, "1/16t": 41, "1/16": 40,
  "1/8t": 39, "1/8": 38, "1/4t": 37, "1/4": 36,
  "Scale": 58, "Layout": 31, "Note": 50, "Session": 51,
  // ... complete from push2_map.py
};

// Reverse lookup: CC number -> button name
export const CC_TO_BUTTON: Record<number, string> = Object.fromEntries(
  Object.entries(BUTTONS).map(([name, cc]) => [cc, name])
);

// Which buttons support RGB color (vs just white)
export const RGB_BUTTONS: Set<string> = new Set([
  "Upper1", "Upper2", "Upper3", "Upper4",
  "Upper5", "Upper6", "Upper7", "Upper8",
  "Lower1", "Lower2", "Lower3", "Lower4",
  "Lower5", "Lower6", "Lower7", "Lower8",
]);
```

### Pad Definitions

```typescript
// Pads are note on/off messages, notes 36-99
// 8x8 grid: (0,0) = top-left = note 92, (7,7) = bottom-right = note 43

export function padNToIJ(n: number): [number, number] {
  return [Math.floor((99 - n) / 8), 7 - ((99 - n) % 8)];
}

export function padIJToN(i: number, j: number): number {
  return 92 - (i * 8) + j;
}
```

### Encoder Definitions

```typescript
// Encoders: rotation = CC, touch = note on/off
export const ENCODERS: Record<string, { cc: number; touchNote: number }> = {
  "Tempo":  { cc: 14, touchNote: 10 },
  "Swing":  { cc: 15, touchNote: 9 },
  "Track1": { cc: 71, touchNote: 0 },
  "Track2": { cc: 72, touchNote: 1 },
  "Track3": { cc: 73, touchNote: 2 },
  "Track4": { cc: 74, touchNote: 3 },
  "Track5": { cc: 75, touchNote: 4 },
  "Track6": { cc: 76, touchNote: 5 },
  "Track7": { cc: 77, touchNote: 6 },
  "Track8": { cc: 78, touchNote: 7 },
  "Master": { cc: 79, touchNote: 8 },
};

export const CC_TO_ENCODER: Record<number, string> = Object.fromEntries(
  Object.entries(ENCODERS).map(([name, { cc }]) => [cc, name])
);

export const TOUCHNOTE_TO_ENCODER: Record<number, string> = Object.fromEntries(
  Object.entries(ENCODERS).map(([name, { touchNote }]) => [touchNote, name])
);
```

### Touchstrip

```typescript
// Touchstrip sends pitchbend messages
// Value range: -8192 to 8128
// (No name mapping needed — there's only one)
```

### LED Animation Constants

```typescript
export const ANIMATION = {
  STATIC: 0,
  ONESHOT_24TH: 1, ONESHOT_16TH: 2, ONESHOT_8TH: 3,
  ONESHOT_QUARTER: 4, ONESHOT_HALF: 5,
  PULSING_24TH: 6, PULSING_16TH: 7, PULSING_8TH: 8,
  PULSING_QUARTER: 9, PULSING_HALF: 10,
  BLINKING_24TH: 11, BLINKING_16TH: 12, BLINKING_8TH: 13,
  BLINKING_QUARTER: 14, BLINKING_HALF: 15,
} as const;

// Default color palette indices (from push2-python constants)
export const COLOR = {
  BLACK: 0, ORANGE: 3, YELLOW: 8, TURQUOISE: 15,
  DARK_GRAY: 16, PURPLE: 22, PINK: 25, LIGHT_GRAY: 48,
  WHITE: 122, BLUE: 125, GREEN: 126, RED: 127,
} as const;
```

---

## Part 4: TypeScript — `push2/display.ts`

Manages the p5gpu render loop, GPU readback, and FFI calls to the Rust crate.

### Architecture

```
setInterval (50ms / 20fps)
  |
  v
[Check: is previous readback buffer mapped?]
  |-- YES --> copy RGBA out, send to Rust FFI (nonblocking)
  |           submit new p5gpu render + readback copy
  |
  |-- NO  --> skip this frame (previous still in flight)
```

### Double-Buffer Readback Design

```typescript
class Push2Display {
  private lib: Push2DisplayLibrary;
  private state: Deno.PointerObject;
  private p5: P5GPU;
  private device: GPUDevice;

  // Double buffer for readback
  private readbackBuffers: [GPUBuffer, GPUBuffer];
  private readbackIndex: number = 0;
  private pendingMap: Promise<void> | null = null;
  private rgbaStaging: Uint8Array; // 960 * 160 * 4

  private drawFn: (p5: P5GPU) => void;
  private intervalId: number | null = null;

  constructor(device: GPUDevice, drawFn: (p5: P5GPU) => void) {
    // Create p5gpu at 960x160 on the provided device
    // Allocate two GPUBuffers with MAP_READ | COPY_DST
    // Open the USB device via FFI
  }

  start(fps: number = 20) {
    const intervalMs = Math.floor(1000 / fps);
    this.intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  private tick() {
    // 1. If previous readback is mapped, consume it
    if (this.pendingMap === null) {
      // First frame — just render and submit readback
      this.renderAndSubmitReadback();
    }
    // Check if pending map resolved
    // (we don't await — we check via a flag set by .then())
  }

  private renderAndSubmitReadback() {
    // Call user's draw function
    this.drawFn(this.p5);

    // Encode copyTextureToBuffer for current frame
    const buf = this.readbackBuffers[this.readbackIndex];
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.p5.getCurrentTexture() },
      { buffer: buf, bytesPerRow: 960 * 4 },
      { width: 960, height: 160 }
    );
    this.device.queue.submit([encoder.finish()]);

    // Start mapping (non-blocking)
    this.pendingMap = buf.mapAsync(GPUMapMode.READ).then(() => {
      // Copy data out
      const mapped = new Uint8Array(buf.getMappedRange());
      this.rgbaStaging.set(mapped);
      buf.unmap();

      // Send to display via FFI (nonblocking so it doesn't block next frame)
      this.lib.symbols.push2_display_send_rgba_frame(
        this.state, this.rgbaStaging, 960, 160
      );

      this.pendingMap = null;
    });

    // Flip buffer index
    this.readbackIndex = (this.readbackIndex + 1) % 2;
  }

  close() {
    this.stop();
    this.lib.symbols.push2_display_close(this.state);
    this.readbackBuffers.forEach(b => b.destroy());
  }
}
```

### Key Design Decisions

- **`setInterval` drives timing** — simple, no fastSleep needed at 20fps
- **`mapAsync` is fire-and-forget** — the `.then()` callback consumes the buffer and sends USB; if it hasn't resolved by next tick, we skip
- **`push2_display_send_rgba_frame` is called from the `.then()` callback** — this means USB send happens as soon as readback completes, not on the next tick. At 20fps with tiny frames, this won't cause issues
- **The FFI call could optionally use `nonblocking: true`** to avoid blocking the JS thread during the ~1ms USB transfer, but at 20fps this is unlikely to matter. Can revisit if needed
- **`drawFn` receives the p5gpu instance** — user draws with full p5 API (rect, ellipse, text, etc.)

---

## Part 5: TypeScript — `push2/push2.ts`

Main class that ties MIDI + Display together.

### API Surface

```typescript
import { MidiAccess } from "../midi/midi_access.ts";

interface Push2Options {
  midiPortName?: string;       // default: auto-detect "Ableton Push 2"
  displayFps?: number;         // default: 20
  displayLibPath?: string;     // path to libpush2_display.dylib
  midiLibPath?: string;        // path to libmidi_bridge.dylib
}

class Push2 {
  // --- Lifecycle ---
  static async create(options?: Push2Options): Promise<Push2>;
  close(): void;

  // --- Button Events (CC messages) ---
  // Specific button:
  onButtonPressed(name: string, fn: () => void): () => void;
  onButtonReleased(name: string, fn: () => void): () => void;
  // Any button:
  onAnyButtonPressed(fn: (name: string) => void): () => void;
  onAnyButtonReleased(fn: (name: string) => void): () => void;

  // --- Pad Events (Note messages, notes 36-99) ---
  onPadPressed(fn: (padN: number, padIJ: [number, number], velocity: number) => void): () => void;
  onPadReleased(fn: (padN: number, padIJ: [number, number]) => void): () => void;
  onPadAftertouch(fn: (padN: number, padIJ: [number, number], pressure: number) => void): () => void;

  // --- Encoder Events ---
  // Specific encoder:
  onEncoderRotated(name: string, fn: (delta: number) => void): () => void;
  onEncoderTouched(name: string, fn: () => void): () => void;
  onEncoderReleased(name: string, fn: () => void): () => void;
  // Any encoder:
  onAnyEncoderRotated(fn: (name: string, delta: number) => void): () => void;
  onAnyEncoderTouched(fn: (name: string) => void): () => void;
  onAnyEncoderReleased(fn: (name: string) => void): () => void;

  // --- Touchstrip (Pitchbend) ---
  onTouchstrip(fn: (value: number) => void): () => void;

  // --- LEDs ---
  setPadColor(padN: number, colorIndex: number, animation?: number): void;
  setButtonColor(name: string, colorIndex: number, animation?: number): void;

  // --- Display ---
  // Creates own GPUDevice, starts render loop at specified fps
  startDisplay(drawFn: (p5: P5GPU) => void): Promise<void>;
  stopDisplay(): void;

  // --- Raw access (escape hatch) ---
  sendMidi(bytes: Uint8Array): void;
}
```

### MIDI Routing Logic

The `create()` factory:
1. Opens `MidiAccess`
2. Finds port matching "Ableton Push 2" (or user-specified name)
3. Opens `MidiInput` and `MidiOutput`
4. Registers internal handlers that route to user callbacks

```typescript
// Internal MIDI routing (inside create/constructor):

midiInput.onCC((channel, cc, value) => {
  // Button press/release
  const buttonName = CC_TO_BUTTON[cc];
  if (buttonName) {
    if (value === 127) {
      this.emit("button:pressed", buttonName);
      this.emit(`button:${buttonName}:pressed`);
    } else if (value === 0) {
      this.emit("button:released", buttonName);
      this.emit(`button:${buttonName}:released`);
    }
    return;
  }

  // Encoder rotation
  const encoderName = CC_TO_ENCODER[cc];
  if (encoderName) {
    // value 1-63 = clockwise, 64-127 = counter-clockwise
    const delta = value < 64 ? value : value - 128;
    this.emit("encoder:rotated", encoderName, delta);
    this.emit(`encoder:${encoderName}:rotated`, delta);
    return;
  }
});

midiInput.onNoteOn((channel, note, velocity) => {
  // Pad press (notes 36-99)
  if (note >= 36 && note <= 99) {
    const ij = padNToIJ(note);
    this.emit("pad:pressed", note, ij, velocity);
    return;
  }

  // Encoder touch (notes 0-10)
  const encoderName = TOUCHNOTE_TO_ENCODER[note];
  if (encoderName) {
    this.emit("encoder:touched", encoderName);
    this.emit(`encoder:${encoderName}:touched`);
  }
});

midiInput.onNoteOff((channel, note, velocity) => {
  if (note >= 36 && note <= 99) {
    const ij = padNToIJ(note);
    this.emit("pad:released", note, ij);
    return;
  }

  const encoderName = TOUCHNOTE_TO_ENCODER[note];
  if (encoderName) {
    this.emit("encoder:released", encoderName);
    this.emit(`encoder:${encoderName}:released`);
  }
});

midiInput.onPitchBend((channel, value) => {
  this.emit("touchstrip", value);
});

midiInput.onChannelPressure((channel, pressure) => {
  this.emit("aftertouch:channel", pressure);
});

midiInput.onPolyPressure((channel, note, pressure) => {
  if (note >= 36 && note <= 99) {
    const ij = padNToIJ(note);
    this.emit("pad:aftertouch", note, ij, pressure);
  }
});
```

### LED Control

```typescript
setPadColor(padN: number, colorIndex: number, animation: number = 0) {
  // Pad LEDs are set via note_on: channel = animation, note = padN, velocity = colorIndex
  this.midiOutput.noteOn(animation, padN, colorIndex);
}

setButtonColor(name: string, colorIndex: number, animation: number = 0) {
  const cc = BUTTONS[name];
  if (cc === undefined) throw new Error(`Unknown button: ${name}`);
  // Button LEDs are set via CC: channel = animation, cc = button cc, value = colorIndex
  this.midiOutput.cc(animation, cc, colorIndex);
}
```

### Internal Event System

Simple typed event emitter (not exported — internal routing only):

```typescript
// Lightweight internal emitter
private listeners = new Map<string, Set<Function>>();

private on(event: string, fn: Function): () => void {
  if (!this.listeners.has(event)) this.listeners.set(event, new Set());
  this.listeners.get(event)!.add(fn);
  return () => this.listeners.get(event)?.delete(fn);
}

private emit(event: string, ...args: unknown[]) {
  this.listeners.get(event)?.forEach(fn => fn(...args));
}
```

The public `onButtonPressed("Play", fn)` methods are thin wrappers:

```typescript
onButtonPressed(name: string, fn: () => void): () => void {
  if (!BUTTONS[name]) throw new Error(`Unknown button: ${name}`);
  return this.on(`button:${name}:pressed`, fn);
}

onAnyButtonPressed(fn: (name: string) => void): () => void {
  return this.on("button:pressed", fn);
}

onPadPressed(fn: (padN: number, padIJ: [number, number], velocity: number) => void): () => void {
  return this.on("pad:pressed", fn);
}

// etc.
```

Each `on*` method returns an unsubscribe function.

---

## Part 6: Example — `examples/push2_demo.ts`

```typescript
import { Push2 } from "../push2/push2.ts";
import { COLOR, ANIMATION } from "../push2/constants.ts";

const push = await Push2.create();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// How much a single encoder tick changes the 0-1 value.
// Push 2 encoders send delta ±1..±63 per tick depending on rotation speed.
// A small SENSITIVITY means many turns to go 0→1; a large one means fewer.
const ENCODER_SENSITIVITY = 0.01;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Normalized 0-1 values for each of the 8 track encoders
const encoderValues: Record<string, number> = {};
for (let t = 1; t <= 8; t++) encoderValues[`Track${t}`] = 0;

// Which encoders are currently being touched (finger on the knob)
const encoderTouched: Record<string, boolean> = {};

// Last pad event string for display
let lastPadText = "Hello Push 2";

// ---------------------------------------------------------------------------
// Button events
// ---------------------------------------------------------------------------

push.onButtonPressed("Play", () => {
  console.log("Play pressed!");
  push.setButtonColor("Play", COLOR.GREEN);
});

push.onButtonReleased("Play", () => {
  push.setButtonColor("Play", COLOR.BLACK);
});

push.onAnyButtonPressed((name) => {
  console.log(`Button: ${name}`);
});

// ---------------------------------------------------------------------------
// Pad events
// ---------------------------------------------------------------------------

push.onPadPressed((padN, [i, j], velocity) => {
  console.log(`Pad (${i},${j}) pressed, velocity: ${velocity}`);
  push.setPadColor(padN, COLOR.BLUE);
  lastPadText = `Pad (${i},${j}) vel:${velocity}`;
});

push.onPadReleased((padN, [i, j]) => {
  push.setPadColor(padN, COLOR.BLACK);
});

push.onPadAftertouch((padN, [i, j], pressure) => {
  const color = pressure > 64 ? COLOR.RED : COLOR.BLUE;
  push.setPadColor(padN, color);
});

// ---------------------------------------------------------------------------
// Encoder events — infinite rotation mapped to 0-1 range
// ---------------------------------------------------------------------------

// Rotation: delta is positive (clockwise) or negative (counter-clockwise).
// We accumulate into a 0-1 range, clamped.
push.onAnyEncoderRotated((name, delta) => {
  if (!(name in encoderValues)) return; // ignore Tempo/Swing/Master for now
  const prev = encoderValues[name];
  encoderValues[name] = Math.max(0, Math.min(1, prev + delta * ENCODER_SENSITIVITY));
  console.log(`${name}: ${encoderValues[name].toFixed(3)}`);
});

// Touch detection — track which knobs have a finger on them
push.onAnyEncoderTouched((name) => {
  encoderTouched[name] = true;
  console.log(`${name} touched`);
});

push.onAnyEncoderReleased((name) => {
  encoderTouched[name] = false;
  console.log(`${name} released`);
});

// ---------------------------------------------------------------------------
// Touchstrip
// ---------------------------------------------------------------------------

push.onTouchstrip((value) => {
  console.log(`Touchstrip: ${value}`);
});

// ---------------------------------------------------------------------------
// Display — 960x160 at ~20fps
// ---------------------------------------------------------------------------

await push.startDisplay((p5) => {
  p5.background(0);

  // Title
  p5.fill(255);
  p5.textSize(28);
  p5.textAlign("center", "top");
  p5.text("Deno Push 2", 480, 4);

  // Last pad event
  p5.textSize(16);
  p5.fill(100, 200, 255);
  p5.text(lastPadText, 480, 38);

  // Encoder visualization — one column per Track1-8
  // Each column shows: bar fill + numeric value, white normally, red if touched
  const barW = 80;
  const barH = 80;
  const barY = 70;
  const gap = (960 - barW * 8) / 9; // spacing between bars

  for (let t = 1; t <= 8; t++) {
    const name = `Track${t}`;
    const val = encoderValues[name];
    const touched = encoderTouched[name] ?? false;
    const x = gap + (t - 1) * (barW + gap);

    // Background bar
    p5.noStroke();
    p5.fill(30);
    p5.rect(x, barY, barW, barH);

    // Filled portion (bottom-up)
    const fillH = val * barH;
    p5.fill(touched ? p5.color(255, 60, 60) : p5.color(100, 200, 100));
    p5.rect(x, barY + barH - fillH, barW, fillH);

    // Value text — white normally, red if touched
    p5.textAlign("center", "top");
    p5.textSize(14);
    p5.fill(touched ? p5.color(255, 80, 80) : p5.color(255));
    p5.text(val.toFixed(2), x + barW / 2, barY + barH + 2);

    // Label
    p5.fill(120);
    p5.textSize(10);
    p5.text(name, x + barW / 2, barY - 12);
  }
});

// Keep alive
console.log("Push 2 demo running. Press Ctrl+C to exit.");
await new Promise(() => {});
```

### What this example demonstrates

1. **Button events** — `onButtonPressed`/`onButtonReleased` for a specific button, `onAnyButtonPressed` for wildcard
2. **Pad events** — press/release/aftertouch with coordinate and velocity info, LED color feedback
3. **Infinite encoder → 0-1 mapping** — `onAnyEncoderRotated` accumulates delta × SENSITIVITY, clamped to [0, 1]
4. **Encoder touch detection** — `onAnyEncoderTouched`/`onAnyEncoderReleased` tracks finger-on-knob state
5. **Touchstrip** — raw pitchbend value logging
6. **Display rendering** — p5gpu draw callback shows:
   - Title text and last pad event
   - 8 vertical bars (one per track encoder) filled proportionally to the 0-1 value
   - Bar fill and value text turn **red** when the encoder is being touched, **white/green** otherwise
   - Numeric value displayed below each bar
7. **ENCODER_SENSITIVITY constant** — single knob at the top of the script to tune how many turns = full range

---

## Implementation Order

### Phase 0: midi_bridge — Add RAW_CC Mode (prerequisite)

The existing midi_bridge coalesces CC values using **last-value-wins** — if CC 71
receives values 3, 5, 2 within one dispatch window, only `2` is reported. This is
correct for absolute controllers (faders) but **destructive for Push 2's relative
encoders**, which encode rotation speed in each CC value (1-63 = clockwise,
65-127 = counter-clockwise). Fast turns produce multiple sub-millisecond CC messages
that must all be summed, not deduplicated.

**Required change to `native/midi_bridge/src/lib.rs`:**

Add a `RAW_CC` flag (e.g. bit 0 of the existing `flags` parameter on `midi_open_input`).
When set, the coalescer thread changes CC handling from "overwrite + dirty bit" to
"append to queue":

```rust
// Current behavior (coalesce): last value wins
cc_val[ch][cc] = value;
dirty_cc[ch].set(cc);

// New RAW_CC behavior: queue every message individually
raw_cc_queue.push_back(RawRecord { ts, ch, cc, value });
```

On each dispatch tick, the queued CC records are serialized into the callback packet
as individual records (same binary format, just more of them). The packet already
supports variable record counts, so the TS-side packet decoder needs no changes —
`onCC` simply fires once per record instead of once per dirty CC.

**Changes needed:**

1. **Rust coalescer** (`midi_bridge/src/lib.rs`):
   - Add `RAW_CC` flag constant (e.g. `const FLAG_RAW_CC: u16 = 1;`)
   - When flag is set, push CC messages to a `VecDeque<RawRecord>` instead of
     updating `cc_val`/`dirty_cc`
   - On dispatch tick, drain the queue into the packet as individual CC records
   - All other message types (notes, pitchbend, pressure) are unaffected — notes
     are already queued individually, and pitchbend/pressure last-value-wins is
     fine for the Push 2 touchstrip and aftertouch

2. **TypeScript wrapper** (`midi/midi_input.ts`):
   - Add `rawCC?: boolean` to `MidiInputOptions`
   - Pass `FLAG_RAW_CC` in the `flags` bitmask when opening
   - No changes to `onCC` callback signature — it already receives
     `(channel, cc, value)` per record

3. **Rebuild**: `cargo build --release` in `native/midi_bridge/`

**Testing**: Open a Push 2 input with `rawCC: true`, spin an encoder fast, verify
that `onCC` fires for every individual CC message (not just the last value per
dispatch window). The sum of all deltas should match the total physical rotation.

### Phase 1: Rust Crate
1. Create `native/push2_display/` with Cargo.toml (nusb dependency)
2. Implement `push2_display_open` — device discovery, interface claim, endpoint setup
3. Implement `push2_display_send_rgba_frame` — RGBA->BGR565->XOR->header->bulk OUT
4. Implement `push2_display_close` and `push2_display_is_connected`
5. Test with a simple Rust main() that sends a solid color frame
6. `cargo build --release`

### Phase 2: Constants & Types
1. Port all button/pad/encoder mappings from push2-python constants.py
2. Cross-reference with push2_map.py for completeness
3. Verify CC numbers and note numbers against Ableton's official docs

### Phase 3: MIDI Integration
1. Create `push2/push2.ts` with MidiAccess integration
2. Wire up CC routing to button events with name lookup
3. Wire up note routing to pad events with coordinate conversion
4. Wire up encoder rotation (CC) and touch (note) events
5. Wire up pitchbend to touchstrip
6. Wire up aftertouch to pad aftertouch
7. Implement LED control methods (noteOn for pads, CC for buttons)
8. Test with just MIDI (no display) — log all events, light up pads

### Phase 4: Display Pipeline
1. Create `push2/ffi.ts` — Deno.dlopen wrapper
2. Create `push2/display.ts` — p5gpu integration with double-buffered readback
3. Wire `startDisplay()` into the Push2 class
4. Test: render static text, verify it appears on Push 2 screen
5. Test: animate at 20fps, verify no stalls

### Phase 5: Example & Polish
1. Build the full demo example
2. Verify all event types work
3. Verify LED colors work for pads and buttons
4. Verify display renders correctly with proper colors (BGR565 conversion)
5. Document any Push 2 hardware quirks discovered during testing

---

## Open Questions (to resolve during implementation)

1. **MIDI port auto-detection**: On macOS the port is "Ableton Push 2 Live Port" vs "Ableton Push 2 User Port". Which should we default to? Python library uses "Live Port". Need to check if our midi_bridge list_inputs returns the same name strings.

2. **p5gpu texture access**: Need to verify that p5gpu exposes a `getCurrentTexture()` or equivalent that we can `copyTextureToBuffer` from. May need to add a method to p5gpu if it doesn't currently expose the render target texture.

3. **GPUDevice creation in display.ts**: The `startDisplay()` method needs to create its own GPUDevice via `navigator.gpu.requestAdapter()` + `adapter.requestDevice()`. Need to verify Deno supports multiple GPUDevice instances simultaneously.

4. **BGR565 byte order**: The Python code does byte-swap operations. Need to verify the exact endianness expected by the Push 2 and ensure our Rust conversion matches. The official Ableton docs say little-endian, which is what x86/ARM native u16 layout gives us — so no explicit swap should be needed.

5. **Sustain pedal**: The Python library has `on_sustain_pedal` (CC 64). Worth including? It's just another CC mapping — trivial to add.


cd /Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks && deno run --unstable-webgpu --unstable-ffi --allow-all examples/push2_demo.ts
