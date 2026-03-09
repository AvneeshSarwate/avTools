/**
 * Shared grid layout for Push 2 chromatic keyboard modules.
 * Maps pad (i, j) positions to MIDI note numbers using an isomorphic layout:
 *   - columns = semitones (left to right)
 *   - rows = configurable interval (bottom to top, default perfect 4th = 5 semitones)
 */

export class GridLayout {
  baseNote: number;
  readonly rowInterval: number;
  readonly rows: [number, number]; // [startRow, endRow] inclusive (i coordinates, 0 = top)

  constructor(options?: {
    baseNote?: number;
    rowInterval?: number;
    rows?: [number, number];
  }) {
    this.baseNote = options?.baseNote ?? 36; // C2
    this.rowInterval = options?.rowInterval ?? 5;
    this.rows = options?.rows ?? [2, 7];
  }

  /** MIDI note at grid position (i, j). Returns -1 if outside row range. */
  midiNoteAt(i: number, j: number): number {
    if (!this.inRange(i)) return -1;
    const rowFromBottom = this.rows[1] - i;
    return this.baseNote + rowFromBottom * this.rowInterval + j;
  }

  /** All (i, j) positions within this layout that map to the given MIDI note. */
  padsForNote(note: number): [number, number][] {
    const result: [number, number][] = [];
    for (let i = this.rows[0]; i <= this.rows[1]; i++) {
      for (let j = 0; j < 8; j++) {
        if (this.midiNoteAt(i, j) === note) {
          result.push([i, j]);
        }
      }
    }
    return result;
  }

  inRange(i: number): boolean {
    return i >= this.rows[0] && i <= this.rows[1];
  }

  shift(semitones: number): void {
    this.baseNote = Math.max(0, Math.min(127, this.baseNote + semitones));
  }
}
