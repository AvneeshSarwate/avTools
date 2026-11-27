// One Euro filter (Casiez et al. 2012): a low-pass whose cutoff rises with
// speed, so slow strokes lose their jitter and fast ones keep their shape
// without lagging. Times are in seconds.
export class OneEuroFilter {
  private x = 0;
  private dx = 0;
  private lastT = -1;

  constructor(
    private minCutoff: number, // Hz at rest
    private beta: number, // cutoff increase per unit/s of speed
    private dCutoff = 1, // Hz, for the speed estimate itself
  ) {}

  reset() {
    this.lastT = -1;
  }

  filter(value: number, t: number): number {
    if (this.lastT < 0) {
      this.lastT = t;
      this.x = value;
      this.dx = 0;
      return value;
    }
    // Coalesced samples can share a timestamp; treat them as ~1 ms apart.
    const dt = Math.max(t - this.lastT, 1e-3);
    this.lastT = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

// The 2D version for positions: one cutoff from the speed (vector magnitude)
// applied to both axes. Filtering x and y separately lets each axis lag by a
// different amount whenever its own velocity crosses zero (every crest of a
// wave, every corner of a zigzag), which bends the path.
export class OneEuroFilter2D {
  x = 0;
  y = 0;
  private dx = 0;
  private dy = 0;
  private lastT = -1;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}

  filter(x: number, y: number, t: number) {
    if (this.lastT < 0) {
      this.lastT = t;
      this.x = x;
      this.y = y;
      this.dx = this.dy = 0;
      return;
    }
    const dt = Math.max(t - this.lastT, 1e-3);
    this.lastT = t;
    const ad = alpha(this.dCutoff, dt);
    this.dx += ad * ((x - this.x) / dt - this.dx);
    this.dy += ad * ((y - this.y) / dt - this.dy);
    const a = alpha(this.minCutoff + this.beta * Math.hypot(this.dx, this.dy), dt);
    this.x += a * (x - this.x);
    this.y += a * (y - this.y);
  }
}
