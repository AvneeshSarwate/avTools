// pointer · pressure: shows what the Pointer Events API reports for every
// pointer on the page (pressure, tilt, twist, contact size) and inks strokes
// whose width follows pressure. Events come straight from the HUD canvas
// (p5's own mouse/touch handlers don't carry pressure or tilt). Two layers:
// strokes.ts draws the ink as smooth spline meshes with three.js (bottom
// canvas); p5 draws the readout and cursors on a transparent canvas on top.
// One frame loop: p5's draw() renders the ink layer first, then the HUD.
import p5 from "p5";
import { type StrokeSample, StrokeLayer } from "./strokes";
import "./style.css";

interface PointerReading {
  id: number;
  type: string;
  x: number;
  y: number;
  down: boolean;
  buttons: number;
  pressure: number;
  tangentialPressure: number;
  tiltX: number; // degrees, -90..90
  tiltY: number;
  twist: number; // degrees, 0..359
  altitude: number; // radians, 0 (flat on the surface) .. PI/2 (upright)
  azimuth: number; // radians, 0..2PI, clockwise from +x on screen
  altitudeReported: boolean; // the browser gave altitude/azimuth itself
  width: number; // contact geometry, CSS px
  height: number;
  peakPressure: number; // highest pressure since this pointer went down
}

const readings = new Map<number, PointerReading>();
// The last pointer that moved, so the readout follows the active device.
let focusId: number | null = null;

// Pointer Events spec conversion from tiltX/tiltY to altitude/azimuth, for
// browsers that don't report the angles (or report them only for some devices).
function tiltToSpherical(tiltXDeg: number, tiltYDeg: number): { altitude: number; azimuth: number } {
  if (tiltXDeg === 0 && tiltYDeg === 0) return { altitude: Math.PI / 2, azimuth: 0 };
  const rad = Math.PI / 180;
  if (Math.abs(tiltXDeg) === 90 || Math.abs(tiltYDeg) === 90) {
    const azimuth = Math.abs(tiltXDeg) === 90
      ? (tiltXDeg > 0 ? 0 : Math.PI)
      : (tiltYDeg > 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
    return { altitude: 0, azimuth };
  }
  const tx = Math.tan(tiltXDeg * rad);
  const ty = Math.tan(tiltYDeg * rad);
  let azimuth = Math.atan2(ty, tx);
  if (azimuth < 0) azimuth += 2 * Math.PI;
  return { altitude: Math.atan(1 / Math.hypot(tx, ty)), azimuth };
}

// altitudeAngle / azimuthAngle are newer than some DOM typings; read them loosely.
type AngledPointerEvent = PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };

function read(event: PointerEvent, canvas: HTMLCanvasElement, previous?: PointerReading): PointerReading {
  const rect = canvas.getBoundingClientRect();
  const angled = event as AngledPointerEvent;
  const reported = typeof angled.altitudeAngle === "number" && typeof angled.azimuthAngle === "number";
  const spherical = reported
    ? { altitude: angled.altitudeAngle!, azimuth: angled.azimuthAngle! }
    : tiltToSpherical(event.tiltX, event.tiltY);
  const down = event.buttons !== 0;
  return {
    id: event.pointerId,
    type: event.pointerType || "unknown",
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    down,
    buttons: event.buttons,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    altitude: spherical.altitude,
    azimuth: spherical.azimuth,
    altitudeReported: reported,
    width: event.width,
    height: event.height,
    peakPressure: down ? Math.max(previous?.down ? previous.peakPressure : 0, event.pressure) : 0,
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

// Ink colour: hue from tilt direction, saturation from how far the pen leans
// (upright = pale, flat = saturated).
function toSample(r: PointerReading, timeStampMs: number): StrokeSample {
  const lean = 1 - r.altitude / (Math.PI / 2);
  const [cr, cg, cb] = hslToRgb(r.azimuth / (2 * Math.PI), 0.2 + 0.7 * lean, 0.7 - 0.2 * lean);
  return { x: r.x, y: r.y, pressure: r.pressure, t: timeStampMs / 1000, r: cr, g: cg, b: cb };
}

const strokes = new StrokeLayer(document.body);

const sketch = (p: p5) => {

  function attach(canvas: HTMLCanvasElement) {
    const onMove = (event: PointerEvent) => {
      // Coalesced events carry the full-rate samples between frames (pens
      // report at 120-240 Hz); fall back to the event itself where unsupported.
      const samples = event.getCoalescedEvents?.() ?? [];
      const list = samples.length ? samples : [event];
      for (const sample of list) {
        const previous = readings.get(event.pointerId);
        const next = read(sample, canvas, previous);
        next.id = event.pointerId; // coalesced samples may not carry it consistently
        readings.set(event.pointerId, next);
        if (next.down) strokes.add(event.pointerId, toSample(next, sample.timeStamp));
      }
      focusId = event.pointerId;
    };
    const onDown = (event: PointerEvent) => {
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId); // keep the stroke when it leaves the canvas
      } catch {
        // Synthetic or already-released pointers can't be captured; inking still works.
      }
      const next = read(event, canvas);
      readings.set(event.pointerId, next);
      focusId = event.pointerId;
      strokes.begin(event.pointerId, toSample(next, event.timeStamp));
    };
    const onUp = (event: PointerEvent) => {
      strokes.end(event.pointerId);
      // Touch contacts vanish on lift; a pen or mouse stays as a hover reading.
      if (event.pointerType === "touch") {
        readings.delete(event.pointerId);
        if (focusId === event.pointerId) focusId = readings.keys().next().value ?? null;
      } else {
        readings.set(event.pointerId, read(event, canvas, readings.get(event.pointerId)));
      }
    };
    const onLeave = (event: PointerEvent) => {
      strokes.end(event.pointerId);
      if (event.pointerType === "mouse") return;
      readings.delete(event.pointerId);
      if (focusId === event.pointerId) focusId = readings.keys().next().value ?? null;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onLeave);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  p.setup = () => {
    const renderer = p.createCanvas(p.windowWidth, p.windowHeight);
    strokes.resize(p.windowWidth, p.windowHeight, window.devicePixelRatio || 1);
    attach(renderer.elt as HTMLCanvasElement);
    p.textFont("ui-monospace, SFMono-Regular, Menlo, monospace");
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    strokes.resize(p.windowWidth, p.windowHeight, window.devicePixelRatio || 1);
  };

  p.keyPressed = () => {
    if (p.key === "c" || p.key === "C" || p.key === "Escape") strokes.clear();
  };

  function drawCursor(r: PointerReading) {
    const lean = Math.cos(r.altitude); // 0 upright .. 1 flat
    p.push();
    p.translate(r.x, r.y);

    // Contact geometry (touch reports a real size; pens/mice usually 1x1).
    if (r.width > 1 || r.height > 1) {
      p.noFill();
      p.stroke(255, 60);
      p.strokeWeight(1);
      p.ellipse(0, 0, r.width, r.height);
    }

    // Pressure ring (a ring, so the ink under the tip stays visible).
    p.noFill();
    p.stroke(255, 140, 60, r.down ? 220 : 90);
    p.strokeWeight(2);
    p.circle(0, 0, 8 + r.pressure * 90);

    // Tilt: a shadow line pointing where the pen's barrel leans, longer when flatter.
    const len = 20 + lean * 120;
    p.stroke(120, 200, 255);
    p.strokeWeight(3);
    p.line(0, 0, Math.cos(r.azimuth) * len, Math.sin(r.azimuth) * len);

    // Twist: a tick around a ring.
    if (r.twist !== 0) {
      const t = (r.twist * Math.PI) / 180;
      p.stroke(200, 255, 140);
      p.strokeWeight(2);
      p.noFill();
      p.circle(0, 0, 60);
      p.line(Math.cos(t) * 24, Math.sin(t) * 24, Math.cos(t) * 36, Math.sin(t) * 36);
    }

    p.noStroke();
    p.fill(255, 200);
    p.textSize(11);
    p.text(`${r.type} #${r.id}`, 14, -14);
    p.pop();
  }

  function bar(x: number, y: number, w: number, value: number, min: number, max: number, color: [number, number, number]) {
    const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
    p.noStroke();
    p.fill(255, 30);
    p.rect(x, y, w, 8, 2);
    p.fill(...color);
    if (min < 0) {
      // Signed values grow out from the centre.
      const mid = x + w / 2;
      const end = x + t * w;
      p.rect(Math.min(mid, end), y, Math.abs(end - mid), 8, 2);
    } else {
      p.rect(x, y, t * w, 8, 2);
    }
  }

  function drawReadout(r: PointerReading | undefined) {
    const x = 16;
    let y = 16;
    const w = 300;
    p.noStroke();
    p.fill(0, 170);
    p.rect(x - 8, y - 8, r ? w + 110 : w + 16, r ? 302 : 70, 8);

    p.fill(255);
    p.textSize(13);
    p.textAlign(p.LEFT, p.TOP);
    if (!r) {
      p.text("touch, click or use a pen", x, y);
      p.fill(255, 120);
      p.text("C clears the ink", x, y + 22);
      return;
    }

    p.text(`${r.type}  id ${r.id}  ${r.down ? "DOWN" : "hover"}  buttons ${r.buttons}`, x, y);
    y += 26;

    const rows: Array<[string, string, number, number, number, [number, number, number]]> = [
      ["pressure", r.pressure.toFixed(3), r.pressure, 0, 1, [255, 140, 60]],
      ["peak", r.peakPressure.toFixed(3), r.peakPressure, 0, 1, [255, 90, 40]],
      ["tangential", r.tangentialPressure.toFixed(3), r.tangentialPressure, -1, 1, [255, 200, 90]],
      ["tiltX", `${r.tiltX.toFixed(1)}°`, r.tiltX, -90, 90, [120, 200, 255]],
      ["tiltY", `${r.tiltY.toFixed(1)}°`, r.tiltY, -90, 90, [120, 200, 255]],
      ["altitude", `${((r.altitude * 180) / Math.PI).toFixed(1)}°`, r.altitude, 0, Math.PI / 2, [150, 170, 255]],
      ["azimuth", `${((r.azimuth * 180) / Math.PI).toFixed(1)}°`, r.azimuth, 0, 2 * Math.PI, [150, 170, 255]],
      ["twist", `${r.twist.toFixed(0)}°`, r.twist, 0, 359, [200, 255, 140]],
      ["width", `${r.width.toFixed(1)}px`, r.width, 0, 100, [200, 200, 200]],
      ["height", `${r.height.toFixed(1)}px`, r.height, 0, 100, [200, 200, 200]],
    ];
    for (const [label, value, raw, min, max, color] of rows) {
      p.fill(255, 170);
      p.text(label, x, y);
      p.fill(255);
      p.text(value, x + 100, y);
      bar(x + 180, y + 3, w - 180, raw, min, max, color);
      y += 20;
    }

    p.fill(255, 110);
    p.textSize(11);
    y += 4;
    p.text(r.altitudeReported ? "altitude/azimuth reported by the browser" : "altitude/azimuth derived from tiltX/tiltY", x, y);
    if (r.type === "mouse") p.text("mice report a fixed pressure (0.5 while pressed)", x, y + 14);
    p.text(`${readings.size} pointer${readings.size === 1 ? "" : "s"}  ·  C clears the ink`, x, y + 28);

    // Tilt compass: where the pen's tip-to-top vector points, seen from above.
    const cx = x + w + 50;
    const cy = 16 + 80;
    p.noFill();
    p.stroke(255, 60);
    p.strokeWeight(1);
    p.circle(cx, cy, 72);
    p.circle(cx, cy, 36);
    p.line(cx - 36, cy, cx + 36, cy);
    p.line(cx, cy - 36, cx, cy + 36);
    const lean = Math.cos(r.altitude);
    p.noStroke();
    p.fill(120, 200, 255);
    p.circle(cx + Math.cos(r.azimuth) * lean * 36, cy + Math.sin(r.azimuth) * lean * 36, 9);
  }

  p.draw = () => {
    strokes.render();
    p.clear();
    for (const r of readings.values()) drawCursor(r);
    drawReadout(focusId !== null ? readings.get(focusId) : undefined);
  };
};

new p5(sketch, document.body);
