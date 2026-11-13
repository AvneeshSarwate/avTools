// Push 2 MIDI constant mappings
// Ported from push2-python constants.py and push2_map.py

// --- Buttons: name -> CC number ---
// Buttons send CC with value 127 (pressed) or 0 (released)
export const BUTTONS: Record<string, number> = {
  TapTempo: 3,
  Metronome: 9,
  Delete: 118,
  Undo: 119,
  Mute: 60,
  Solo: 61,
  Stop: 29,
  Convert: 35,
  DoubleLoop: 117,
  Quantize: 116,
  Duplicate: 88,
  New: 87,
  FixedLength: 90,
  Automate: 89,
  Record: 86,
  Play: 85,
  Upper1: 102,
  Upper2: 103,
  Upper3: 104,
  Upper4: 105,
  Upper5: 106,
  Upper6: 107,
  Upper7: 108,
  Upper8: 109,
  Lower1: 20,
  Lower2: 21,
  Lower3: 22,
  Lower4: 23,
  Lower5: 24,
  Lower6: 25,
  Lower7: 26,
  Lower8: 27,
  "1/32t": 43,
  "1/32": 42,
  "1/16t": 41,
  "1/16": 40,
  "1/8t": 39,
  "1/8": 38,
  "1/4t": 37,
  "1/4": 36,
  Setup: 30,
  User: 59,
  AddDevice: 52,
  AddTrack: 53,
  Device: 110,
  Mix: 112,
  Browse: 111,
  Clip: 113,
  Master: 28,
  Up: 46,
  Down: 47,
  Left: 44,
  Right: 45,
  Repeat: 56,
  Accent: 57,
  Scale: 58,
  Layout: 31,
  Note: 50,
  Session: 51,
  OctaveUp: 55,
  OctaveDown: 54,
  PageLeft: 62,
  PageRight: 63,
  Shift: 49,
  Select: 48,
};

// Reverse lookup: CC number -> button name
export const CC_TO_BUTTON: Record<number, string> = Object.fromEntries(
  Object.entries(BUTTONS).map(([name, cc]) => [cc, name]),
);

// Which buttons support RGB color (vs just white on/off)
export const RGB_BUTTONS: Set<string> = new Set([
  "Upper1", "Upper2", "Upper3", "Upper4",
  "Upper5", "Upper6", "Upper7", "Upper8",
  "Lower1", "Lower2", "Lower3", "Lower4",
  "Lower5", "Lower6", "Lower7", "Lower8",
]);

// --- Pads: 8x8 grid, notes 36-99 ---
// (0,0) = top-left = note 92, (7,7) = bottom-right = note 43

export function padNToIJ(n: number): [number, number] {
  // Row 0 top: notes 92-99, Row 7 bottom: notes 36-43
  const fromTop = 99 - n;
  return [Math.floor(fromTop / 8), 7 - (fromTop % 8)];
}

export function padIJToN(i: number, j: number): number {
  return 92 - (i * 8) + j;
}

// --- Encoders: rotation = CC, touch = note on/off ---
export const ENCODERS: Record<string, { cc: number; touchNote: number }> = {
  Tempo: { cc: 14, touchNote: 10 },
  Swing: { cc: 15, touchNote: 9 },
  Track1: { cc: 71, touchNote: 0 },
  Track2: { cc: 72, touchNote: 1 },
  Track3: { cc: 73, touchNote: 2 },
  Track4: { cc: 74, touchNote: 3 },
  Track5: { cc: 75, touchNote: 4 },
  Track6: { cc: 76, touchNote: 5 },
  Track7: { cc: 77, touchNote: 6 },
  Track8: { cc: 78, touchNote: 7 },
  Master: { cc: 79, touchNote: 8 },
};

// Reverse lookups for encoders
export const CC_TO_ENCODER: Record<number, string> = Object.fromEntries(
  Object.entries(ENCODERS).map(([name, { cc }]) => [cc, name]),
);

export const TOUCHNOTE_TO_ENCODER: Record<number, string> = Object.fromEntries(
  Object.entries(ENCODERS).map(([name, { touchNote }]) => [touchNote, name]),
);

// --- Touchstrip ---
// Sends pitchbend messages, value range -8192 to 8128

// --- LED Animation Constants ---
export const ANIMATION = {
  STATIC: 0,
  ONESHOT_24TH: 1,
  ONESHOT_16TH: 2,
  ONESHOT_8TH: 3,
  ONESHOT_QUARTER: 4,
  ONESHOT_HALF: 5,
  PULSING_24TH: 6,
  PULSING_16TH: 7,
  PULSING_8TH: 8,
  PULSING_QUARTER: 9,
  PULSING_HALF: 10,
  BLINKING_24TH: 11,
  BLINKING_16TH: 12,
  BLINKING_8TH: 13,
  BLINKING_QUARTER: 14,
  BLINKING_HALF: 15,
} as const;

// Default color palette indices
export const COLOR = {
  BLACK: 0,
  ORANGE: 3,
  YELLOW: 8,
  TURQUOISE: 15,
  DARK_GRAY: 16,
  PURPLE: 22,
  PINK: 25,
  LIGHT_GRAY: 48,
  WHITE: 122,
  BLUE: 125,
  GREEN: 126,
  RED: 127,
} as const;
