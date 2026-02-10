/**
 * Pixel-scanning font metrics for canvaskit-wasm canvases.
 *
 * Since @gfx/canvas-wasm's measureText() only returns width (no vertical
 * metrics), we render test characters to a scratch canvas and scan the pixel
 * data to determine the actual ascent and descent for each font.
 *
 * Results are cached per CSS font string so the scan only runs once per
 * unique font configuration.
 */

export interface FontMetrics {
  /** Pixels above the alphabetic baseline (positive) */
  ascent: number;
  /** Pixels below the alphabetic baseline (positive) */
  descent: number;
  /** Parsed font size in px */
  fontSize: number;
}

const ALPHA_THRESHOLD = 8; // ignore anti-aliasing fringes

// Pixi's own test string for font measurement: '|ÉqÅ'
// We add extra descender/ascender characters for robustness.
const TEST_CHARS = "|ÉqÅjgypf̂";

interface PixelScanContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  font: string;
  fillStyle: string;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
}

interface PixelScanCanvas {
  getContext(type: "2d"): PixelScanContext | null;
  dispose?: () => void;
}

/**
 * Measures font metrics by rendering test characters and scanning pixels.
 * Accepts the raw canvaskit `createCanvas` function (not the wrapper).
 */
export class PixelFontMetrics {
  private _cache = new Map<string, FontMetrics>();
  private _createCanvas: (w: number, h: number) => PixelScanCanvas;

  constructor(createCanvas: (w: number, h: number) => PixelScanCanvas) {
    this._createCanvas = createCanvas;
  }

  /**
   * Get metrics for a CSS font string (e.g. "bold 24px sans-serif").
   * Cached after the first call for each unique font.
   */
  measure(font: string): FontMetrics {
    const cached = this._cache.get(font);
    if (cached) return cached;

    const metrics = this._scan(font);
    this._cache.set(font, metrics);
    return metrics;
  }

  private _scan(font: string): FontMetrics {
    const fontSize = parseFontSize(font);

    // Canvas must be large enough to contain the full text with generous padding.
    // Use 4× font size for height to accommodate both tall ascenders and deep
    // descenders without clipping.
    const canvasW = Math.ceil(fontSize * TEST_CHARS.length * 1.5) + 20;
    const canvasH = Math.ceil(fontSize * 4);
    const baselineY = Math.floor(canvasH / 2);

    let canvas: PixelScanCanvas;
    try {
      canvas = this._createCanvas(canvasW, canvasH);
    } catch {
      return fallbackMetrics(fontSize);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      tryDispose(canvas);
      return fallbackMetrics(fontSize);
    }

    // Render test characters at the known baseline position.
    // canvaskit-wasm's textBaseline setter is a no-op, but the default
    // Canvas 2D behavior is "alphabetic" which places the baseline at y.
    try {
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.font = font;
      ctx.fillStyle = "rgba(255, 255, 255, 1)";
      ctx.fillText(TEST_CHARS, 10, baselineY);
    } catch {
      tryDispose(canvas);
      return fallbackMetrics(fontSize);
    }

    // Read pixels
    let data: Uint8ClampedArray;
    try {
      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      data = imageData.data;
    } catch {
      tryDispose(canvas);
      return fallbackMetrics(fontSize);
    }

    // Scan from top down to find the first row with visible pixels
    let topPixel = -1;
    outer_top:
    for (let y = 0; y < canvasH; y++) {
      const rowStart = y * canvasW * 4;
      for (let x = 0; x < canvasW; x++) {
        const idx = rowStart + x * 4;
        if (data[idx] > ALPHA_THRESHOLD || data[idx + 1] > ALPHA_THRESHOLD ||
            data[idx + 2] > ALPHA_THRESHOLD || data[idx + 3] > ALPHA_THRESHOLD) {
          topPixel = y;
          break outer_top;
        }
      }
    }

    // Scan from bottom up to find the last row with visible pixels
    let bottomPixel = -1;
    outer_bottom:
    for (let y = canvasH - 1; y >= 0; y--) {
      const rowStart = y * canvasW * 4;
      for (let x = 0; x < canvasW; x++) {
        const idx = rowStart + x * 4;
        if (data[idx] > ALPHA_THRESHOLD || data[idx + 1] > ALPHA_THRESHOLD ||
            data[idx + 2] > ALPHA_THRESHOLD || data[idx + 3] > ALPHA_THRESHOLD) {
          bottomPixel = y;
          break outer_bottom;
        }
      }
    }

    tryDispose(canvas);

    if (topPixel < 0 || bottomPixel < 0) {
      // No pixels found — canvaskit may not have rendered. Fall back.
      return fallbackMetrics(fontSize);
    }

    // +1 because pixel rows are 0-indexed; the extent includes both edge rows
    let ascent = baselineY - topPixel + 1;
    let descent = bottomPixel - baselineY + 1;

    // Sanity: ensure minimums so pixi never creates a 0-height canvas
    ascent = Math.max(ascent, fontSize * 0.6);
    descent = Math.max(descent, fontSize * 0.15);

    // Add a small safety margin for anti-aliasing and rounding
    ascent = Math.ceil(ascent + 1);
    descent = Math.ceil(descent + 1);

    return { ascent, descent, fontSize };
  }
}

function fallbackMetrics(fontSize: number): FontMetrics {
  // Conservative heuristics based on typical Latin font metrics.
  // Most sans-serif fonts: ascent ≈ 0.88em, descent ≈ 0.28em
  // We use slightly generous values to avoid clipping.
  return {
    ascent: Math.ceil(fontSize * 0.92),
    descent: Math.ceil(fontSize * 0.32),
    fontSize,
  };
}

function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/i);
  return match ? parseFloat(match[1]) : 16;
}

function tryDispose(canvas: PixelScanCanvas | null | undefined): void {
  try { canvas?.dispose?.(); } catch { /* ignore */ }
}
