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

function read(event: PointerEvent, rect: DOMRect, previous?: PointerReading): PointerReading {
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

// For checking frame rate on a device: ?hud=0 hides the readout and cursors
// (the FPS meter stays).
const showHud = new URLSearchParams(location.search).get("hud") !== "0";

const strokes = new StrokeLayer(document.body);

// The bottom bar: the drawing area is the window above it.
const BAR_HEIGHT = 72;
const drawHeight = () => Math.max(1, window.innerHeight - BAR_HEIGHT);

// Reshape parameters, edited in the params pane.
const params = { points: 10, distance: 80, seconds: 1 };

// The wander process (button 3): one step a second while it is on, run from
// the frame loop.
let wanderOn = false;
let nextWander = 0;
function tickWander(now: number) {
  if (!wanderOn || now < nextWander) return;
  strokes.wanderStep(params.points, params.distance, params.seconds * 1000);
  nextWander = Math.max(nextWander + 1000, now - 1000); // catch up at most one step after a stall
}

const bar = document.createElement("div");
bar.className = "button-bar";
const pane = buildParamsPane();
const buttons: Array<[string, ((button: HTMLButtonElement) => void) | null]> = [
  ["scatter", () => strokes.scatter(params.points, params.distance, params.seconds * 1000)],
  ["restore", () => strokes.restore(params.seconds * 1000)],
  ["wander", (button) => {
    wanderOn = !wanderOn;
    nextWander = performance.now();
    button.classList.toggle("on", wanderOn);
  }],
  ["4", null],
  ["params", (button) => {
    const open = pane.hidden;
    pane.hidden = !open;
    button.classList.toggle("on", open);
  }],
];
for (const [label, action] of buttons) {
  const button = document.createElement("button");
  button.textContent = label;
  if (action) button.addEventListener("click", () => action(button));
  else button.disabled = true;
  bar.append(button);
}
document.body.append(pane, bar);

// A pane above the bar's right end: one slider per parameter, with its value.
function buildParamsPane() {
  const el = document.createElement("div");
  el.className = "params-pane";
  el.hidden = true;
  const sliders: Array<{ key: keyof typeof params; label: string; min: number; max: number; step: number; format: (v: number) => string }> = [
    { key: "points", label: "points", min: 5, max: 50, step: 1, format: (v) => `${v}` },
    { key: "distance", label: "distance", min: 20, max: 300, step: 1, format: (v) => `${v} px` },
    { key: "seconds", label: "lerp time", min: 0.2, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)} s` },
  ];
  for (const s of sliders) {
    const row = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = s.label;
    const value = document.createElement("span");
    value.className = "value";
    const input = document.createElement("input");
    input.type = "range";
    input.min = `${s.min}`;
    input.max = `${s.max}`;
    input.step = `${s.step}`;
    input.value = `${params[s.key]}`;
    const show = () => (value.textContent = s.format(params[s.key]));
    input.addEventListener("input", () => {
      params[s.key] = Number(input.value);
      show();
    });
    show();
    row.append(name, input, value);
    el.append(row);
  }
  return el;
}

// Main-thread time spent in pointer handlers since the last frame.
let inputMs = 0;

const sketch = (p: p5) => {

  function attach(canvas: HTMLCanvasElement) {
    const onMove = (event: PointerEvent) => {
      const t0 = performance.now();
      const rect = canvas.getBoundingClientRect();
      // Coalesced events carry the full-rate samples between frames (pens
      // report at 120-240 Hz); fall back to the event itself where unsupported.
      const samples = event.getCoalescedEvents?.() ?? [];
      const list = samples.length ? samples : [event];
      for (const sample of list) {
        const previous = readings.get(event.pointerId);
        const next = read(sample, rect, previous);
        next.id = event.pointerId; // coalesced samples may not carry it consistently
        readings.set(event.pointerId, next);
        if (next.down) strokes.add(event.pointerId, toSample(next, sample.timeStamp));
      }
      focusId = event.pointerId;
      inputMs += performance.now() - t0;
    };
    const onDown = (event: PointerEvent) => {
      const t0 = performance.now();
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId); // keep the stroke when it leaves the canvas
      } catch {
        // Synthetic or already-released pointers can't be captured; inking still works.
      }
      const next = read(event, canvas.getBoundingClientRect());
      readings.set(event.pointerId, next);
      focusId = event.pointerId;
      strokes.begin(event.pointerId, toSample(next, event.timeStamp));
      inputMs += performance.now() - t0;
    };
    const onUp = (event: PointerEvent) => {
      const t0 = performance.now();
      strokes.end(event.pointerId);
      inputMs += performance.now() - t0;
      // Touch contacts vanish on lift; a pen or mouse stays as a hover reading.
      if (event.pointerType === "touch") {
        readings.delete(event.pointerId);
        if (focusId === event.pointerId) focusId = readings.keys().next().value ?? null;
      } else {
        readings.set(event.pointerId, read(event, canvas.getBoundingClientRect(), readings.get(event.pointerId)));
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
    const renderer = p.createCanvas(p.windowWidth, drawHeight());
    strokes.resize(p.windowWidth, drawHeight(), window.devicePixelRatio || 1);
    attach(renderer.elt as HTMLCanvasElement);
    p.textFont("ui-monospace, SFMono-Regular, Menlo, monospace");
    // p5 caps draw() at 60 fps by default (it skips animation frames that come
    // sooner); uncap it so 120 Hz displays get every frame.
    p.frameRate(1000);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, drawHeight());
    strokes.resize(p.windowWidth, drawHeight(), window.devicePixelRatio || 1);
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

  // FPS meter: intervals between draw() calls (the real frame rate) and
  // main-thread CPU time per frame, split into pointer handling, the ink layer
  // (tessellation, uploads, issuing GL calls) and the p5 HUD. GPU and
  // compositor time are not included: if fps drops while these stay small,
  // the cost is there.
  const FRAMES = 120;
  const intervals = new Float32Array(FRAMES);
  const inputT = new Float32Array(FRAMES);
  const inkT = new Float32Array(FRAMES);
  const hudT = new Float32Array(FRAMES);
  let frameIndex = 0;
  let lastFrameAt = 0;
  const flags = showHud ? "" : "hud off";

  function drawFps() {
    const n = Math.min(frameIndex, FRAMES);
    if (n < 2) return;
    // Averages over the last ~half second of frames, worst over the whole window.
    let sum = 0, count = 0, worst = 0, best = Infinity, inS = 0, inkS = 0, hudS = 0;
    for (let k = 1; k <= n; k++) {
      const i = (frameIndex - k + FRAMES) % FRAMES;
      if (count < 30) {
        sum += intervals[i];
        inS += inputT[i];
        inkS += inkT[i];
        hudS += hudT[i];
        count++;
      }
      if (intervals[i] > worst) worst = intervals[i];
      if (intervals[i] < best) best = intervals[i];
    }
    // The display's refresh period: the shortest recent frame.
    const refresh = Math.max(4, best);
    const avg = sum / count;
    const w = 196, h = flags ? 120 : 106;
    const x = p.width - w - 12, y = 12;
    p.noStroke();
    p.fill(0, 170);
    p.rect(x, y, w, h, 8);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(20);
    p.fill(255);
    p.text(`${(1000 / avg).toFixed(0)} fps`, x + 10, y + 8);
    p.textSize(11);
    p.fill(255, 150);
    p.text(`${avg.toFixed(1)} ms  worst ${worst.toFixed(1)}`, x + 10, y + 32);
    p.text(`cpu ms  input ${(inS / count).toFixed(1)}`, x + 10, y + 46);
    p.text(`ink ${(inkS / count).toFixed(1)}  hud ${(hudS / count).toFixed(1)}`, x + 52, y + 60);
    if (flags) p.text(flags, x + 10, y + 74);

    // Frame-time bars, newest on the right, coloured against the refresh
    // period (green on time, amber one frame missed, red more); guides at
    // 120 Hz and 60 Hz.
    const gx = x + 10, gy = y + h - 30, gw = w - 20, gh = 22, scale = gh / 33.3;
    const bars = Math.min(n, gw);
    p.fill(255, 25);
    p.rect(gx, gy, gw, gh);
    for (let k = 0; k < bars; k++) {
      const i = (frameIndex - 1 - k + FRAMES) % FRAMES;
      const ms = intervals[i];
      p.fill(ms > refresh * 2.5 ? p.color(255, 90, 70) : ms > refresh * 1.5 ? p.color(255, 200, 90) : p.color(120, 220, 140));
      const bh = Math.min(gh, ms * scale);
      p.rect(gx + gw - 1 - k, gy + gh - bh, 1, bh);
    }
    p.stroke(255, 70);
    p.strokeWeight(1);
    p.line(gx, gy + gh - 8.33 * scale, gx + gw, gy + gh - 8.33 * scale);
    p.line(gx, gy + gh - 16.67 * scale, gx + gw, gy + gh - 16.67 * scale);
  }

  p.draw = () => {
    const start = performance.now();
    const slot = frameIndex % FRAMES;
    const counted = lastFrameAt > 0;
    if (counted) intervals[slot] = start - lastFrameAt;
    lastFrameAt = start;
    tickWander(start);
    strokes.render();
    const inkDone = performance.now();
    p.clear();
    if (showHud) {
      for (const r of readings.values()) drawCursor(r);
      drawReadout(focusId !== null ? readings.get(focusId) : undefined);
    }
    drawFps();
    if (counted) {
      inputT[slot] = inputMs;
      inkT[slot] = inkDone - start;
      hudT[slot] = performance.now() - inkDone;
      frameIndex++;
    }
    inputMs = 0;
  };
};

new p5(sketch, document.body);
