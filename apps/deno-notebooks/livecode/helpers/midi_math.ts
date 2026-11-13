// Pure MIDI value math shared by midi_helpers.ts and piano_roll_helpers.ts.
// Kept side-effect free so both can import it statically without triggering the
// eager FFI device init that lives in midi_helpers.ts (piano_roll_helpers.ts
// deliberately dynamic-imports midi_helpers.ts to defer that init).
export function clampMidi(value: number, min = 0, max = 127): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
