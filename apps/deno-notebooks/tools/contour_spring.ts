/**
 * Spring-physics text-on-path renderer.
 *
 * Each character is anchored to a point on the contour path. When the anchor
 * moves (body movement), the character trails behind on an underdamped spring,
 * then oscillates back. Slow movement → text hugs the path. Fast flicks →
 * characters fly off and wobble back.
 *
 * State is keyed by contour ID so springs persist across frames.
 */

import type { Point, P5Like } from "./text_on_path.ts";
import {
  polylineCumDists,
  samplePolyline,
  measureCharAdvances,
} from "./text_on_path.ts";

// ── Types ────────────────────────────────────────────────────────

export interface SpringParams {
  /** Spring stiffness — higher = snappier return (default: 150) */
  stiffness: number;
  /** Damping ratio — <1 = underdamped (bouncy), 1 = critical, >1 = overdamped (default: 0.4) */
  damping: number;
  /** Whether spring physics is enabled (default: true) */
  enabled: boolean;
}

export const defaultSpringParams: SpringParams = {
  stiffness: 150,
  damping: 0.4,
  enabled: true,
};

// Per-character spring state
interface CharSpring {
  px: number; // current position x
  py: number; // current position y
  vx: number; // velocity x
  vy: number; // velocity y
}

// Per-contour spring state (pool of character springs)
interface ContourSprings {
  chars: CharSpring[];
}

// ── Spring text renderer ─────────────────────────────────────────

export function createSpringTextRenderer(params: SpringParams) {
  const states = new Map<number, ContourSprings>();
  let lastTime = performance.now();

  function getWidthFn(p5: P5Like): (s: string) => number {
    if (typeof p5.fontWidth === "function") return (s) => p5.fontWidth!(s);
    if (typeof p5.textWidth === "function") return (s) => p5.textWidth!(s);
    throw new Error("p5 instance must expose fontWidth() or textWidth()");
  }

  return {
    /**
     * Render text along a path with spring physics on each character.
     *
     * @param contourId - Stable ID from the smoother, used to persist spring state
     */
    renderTextOnPath(
      p5: P5Like,
      contourId: number,
      str: string,
      path: Point[],
      opts: {
        offset?: number;
        letterSpacing?: number;
        fillSeparator?: string;
        tangentStencil?: number;
        closed?: boolean;
      } = {},
    ): void {
      if (str.length === 0 || path.length < 2) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);

      const {
        offset = 0,
        letterSpacing = 0,
        fillSeparator = "   ",
        tangentStencil = 1,
      } = opts;
      const widthFn = getWidthFn(p5);

      const cumDists = polylineCumDists(path);
      const totalPathLen = cumDists[cumDists.length - 1];
      if (totalPathLen < 1) return;

      const closed = opts.closed ?? (
        Math.abs(path[0].x - path[path.length - 1].x) < 1 &&
        Math.abs(path[0].y - path[path.length - 1].y) < 1
      );

      // Build repeating unit
      const unit = str + fillSeparator;
      const unitAdvances = measureCharAdvances(widthFn, unit);
      const unitWidth =
        unitAdvances.reduce((s, a) => s + a, 0) +
        letterSpacing * unit.length;
      if (unitWidth < 1) return;

      const mod = (a: number, m: number) => ((a % m) + m) % m;
      const wrappedOff = mod(offset, unitWidth);

      // Compute all anchor positions (same logic as textOnPath "wrap" mode)
      const anchors: Array<{ x: number; y: number; angle: number; ch: string }> = [];
      let cursor = -wrappedOff;
      let charIdx = 0;
      const maxChars = unit.length * (Math.ceil(totalPathLen / unitWidth) + 2);

      while (cursor < totalPathLen && charIdx < maxChars) {
        const i = charIdx % unit.length;
        const adv = unitAdvances[i];
        const center = cursor + adv / 2;
        if (center >= 0 && center < totalPathLen) {
          const sample = samplePolyline(path, cumDists, center, tangentStencil, closed);
          anchors.push({ x: sample.x, y: sample.y, angle: sample.angle, ch: unit[i] });
        }
        cursor += adv + letterSpacing;
        charIdx++;
      }

      if (!params.enabled) {
        // No springs — render directly at anchors
        for (const a of anchors) {
          p5.push();
          p5.translate(a.x, a.y);
          p5.rotate(a.angle);
          p5.textAlign("center", "alphabetic");
          p5.text(a.ch, 0, 0);
          p5.pop();
        }
        return;
      }

      // Get or create spring state for this contour
      let state = states.get(contourId);
      if (!state) {
        state = { chars: [] };
        states.set(contourId, state);
      }

      // Grow or shrink the spring pool to match the number of visible characters
      while (state.chars.length < anchors.length) {
        const a = anchors[state.chars.length];
        state.chars.push({ px: a.x, py: a.y, vx: 0, vy: 0 });
      }
      state.chars.length = anchors.length;

      // Spring simulation + render
      const { stiffness, damping } = params;
      const dampCoeff = damping * 2 * Math.sqrt(stiffness);

      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const s = state.chars[i];

        // Spring force toward anchor
        const ax = stiffness * (a.x - s.px) - dampCoeff * s.vx;
        const ay = stiffness * (a.y - s.py) - dampCoeff * s.vy;

        s.vx += ax * dt;
        s.vy += ay * dt;
        s.px += s.vx * dt;
        s.py += s.vy * dt;

        // Render at spring position, rotated to face anchor
        const angle = Math.atan2(a.y - s.py, a.x - s.px);
        // Use the anchor's tangent angle when close, blend toward
        // the anchor-to-spring angle when far (looks more natural)
        const dist = Math.sqrt((a.x - s.px) ** 2 + (a.y - s.py) ** 2);
        const blendDist = 20; // pixels — distance at which rotation starts blending
        const blend = Math.min(dist / blendDist, 1.0);
        const renderAngle = a.angle + blend * (angle - a.angle + Math.PI);
        // Actually, just use the path tangent angle — looks cleaner
        const _ = blend; // suppress unused
        void _;

        p5.push();
        p5.translate(s.px, s.py);
        p5.rotate(a.angle);
        p5.textAlign("center", "alphabetic");
        p5.text(a.ch, 0, 0);
        p5.pop();
      }
    },

    /** Call once per frame to update the shared timestamp. */
    tick() {
      lastTime = performance.now();
    },

    /** Remove state for contours that no longer exist. */
    cleanup(activeIds: Set<number>) {
      for (const id of states.keys()) {
        if (!activeIds.has(id)) states.delete(id);
      }
    },

    reset() {
      states.clear();
      lastTime = performance.now();
    },
  };
}
