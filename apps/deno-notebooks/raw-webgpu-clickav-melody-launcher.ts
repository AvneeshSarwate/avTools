import { OfflineRunner } from "@avtools/core-timing";
import { Scale } from "@avtools/music-types";
import { CirclePts } from "@avtools/power2d/core";
import { FlatColorMaterial } from "@avtools/power2d/generated-raw/shaders/flatColor.material.raw.generated.ts";
import { createPower2DScene, selectPower2DFormat, StyledShape } from "@avtools/power2d/raw";
import { FeedbackNode, PassthruEffect } from "@avtools/shader-fx/raw";
import { BloomEffect } from "@avtools/shader-fx/generated-raw/shaders/bloom.frag.raw.generated.ts";
import { HorizontalBlurEffect } from "@avtools/shader-fx/generated-raw/shaders/horizontalBlur.frag.raw.generated.ts";
import { LayerBlendEffect } from "@avtools/shader-fx/generated-raw/shaders/layerBlend.frag.raw.generated.ts";
import { TransformEffect } from "@avtools/shader-fx/generated-raw/shaders/transform.frag.raw.generated.ts";
import { VerticalBlurEffect } from "@avtools/shader-fx/generated-raw/shaders/verticalBlur.frag.raw.generated.ts";
import { MidiAccess } from "./midi/mod.ts";
import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { blit, createBlitPipeline, createGpuWindow } from "./window/mod.ts";

// ---------------------------------------------------------------------------
// Inline helpers copied from channels.ts (xyZip, EventChop, cos, sin)
// ---------------------------------------------------------------------------

let eventIdSeed = 0;

class EventChop<T> {
  public events: Array<{ id: number; start: number; dur: number; metadata: T }> = [];

  public ramp(time: number, metadata: T, startTime: number): void {
    const evt = { id: eventIdSeed++, start: startTime, dur: Math.max(1e-6, time), metadata };
    this.events.push(evt);
  }

  public samples(now: number): Array<T & { evtId: number; val: number }> {
    const out: Array<T & { evtId: number; val: number }> = [];
    this.events = this.events.filter((evt) => {
      const val = (now - evt.start) / evt.dur;
      if (val >= 1) {
        return false;
      }
      out.push({
        ...evt.metadata,
        evtId: evt.id,
        val: Math.max(0, Math.min(1, val)),
      });
      return true;
    });
    return out;
  }
}

const sin = (phase: number): number => {
  return Math.sin(phase * Math.PI * 2);
};

const cos = (phase: number): number => {
  return Math.cos(phase * Math.PI * 2);
};

const xyZip = (
  phase: number,
  xPat: (phase: number) => number,
  yPat: (phase: number) => number,
  count = 100,
  cycles = 1,
): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = (i / count) * cycles + phase;
    out.push({ x: xPat(p), y: yPat(p) });
  }
  return out;
};

type ClipNote = {
  position: number;
  pitch: number;
  duration: number;
  velocity: number;
};

const listToClip = (pitches: number[], stepTime = 0.5, dur = 0.5, vel = 0.5): ClipNote[] => {
  return pitches.map((pitch, i) => ({
    pitch,
    velocity: vel,
    duration: dur,
    position: i * stepTime,
  }));
};

const clipToDeltas = (clip: ClipNote[], totalTime?: number): number[] => {
  const deltas: number[] = [];
  clip.forEach((note, i) => {
    const delta = i === 0 ? note.position : note.position - clip[i - 1].position;
    deltas.push(delta);
  });
  if (totalTime !== undefined && clip.length > 0) {
    const lastNote = clip[clip.length - 1];
    deltas.push(totalTime - lastNote.position);
  }
  return deltas;
};

const toMidiVelocity = (velocity: number): number => {
  if (!Number.isFinite(velocity)) return 64;
  const scaled = velocity <= 1 ? velocity * 127 : velocity;
  return Math.max(0, Math.min(127, Math.round(scaled)));
};

const clampMidiNote = (note: number): number => {
  if (!Number.isFinite(note)) return 0;
  return Math.max(0, Math.min(127, Math.round(note)));
};

const baseSeq = [1, 3, 5, 6, 8, 10, 12];
const baseDur = 0.125 / 2;
const circle0 = xyZip(0, cos, sin, baseSeq.length);
const orbitRadius = 50;
const circleBasePoints = CirclePts({ cx: 0, cy: 0, radius: 1, segments: 32 });
const scale = new Scale(undefined, 24);

type CircleEvent = {
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
};

const device = await requestWebGpuDevice();
const format = await selectPower2DFormat(device, ["rgba16float", "rgba32float", "rgba8unorm"]);

const midi = MidiAccess.open();
const midiOutputs = midi.listOutputs();
if (midiOutputs.length === 0) {
  throw new Error("No MIDI outputs available. Check your MIDI bridge setup.");
}
const MIDI_OUTPUT_NAME = "IAC Driver Bus 1";
const midiOutputInfo = midiOutputs.find((port) => port.name.includes(MIDI_OUTPUT_NAME));
if (!midiOutputInfo) {
  const available = midiOutputs.map((port) => port.name).join(", ");
  throw new Error(`MIDI output not found: ${MIDI_OUTPUT_NAME}. Available outputs: ${available}`);
}
console.log("Using MIDI output:", midiOutputInfo.name);
const midiOutput = midi.openOutput(midiOutputInfo.id);

const win = await createGpuWindow(device, { width: 900, height: 700, title: "clickav melody launcher (raw)" });
const blitPipeline = createBlitPipeline(device, win.format);

const scene = createPower2DScene({
  device,
  width: win.width,
  height: win.height,
  format,
  clearColor: { r: 0, g: 0, b: 0, a: 0 },
});

let passthru: PassthruEffect;
let feedback: FeedbackNode;
let vertBlur: VerticalBlurEffect;
let horBlur: HorizontalBlurEffect;
let transform: TransformEffect;
let layerBlend: LayerBlendEffect;
let bloom: BloomEffect;
let finalFx: BloomEffect;

const rebuildFxChain = (width: number, height: number) => {
  const clear = { r: 0, g: 0, b: 0, a: 0 };
  finalFx?.disposeAll();

  passthru = new PassthruEffect(device, { src: scene.outputTexture }, width, height, format, clear, "nearest");
  feedback = new FeedbackNode(device, passthru, width, height, format, clear, "linear");
  vertBlur = new VerticalBlurEffect(device, { src: feedback }, width, height, format, clear);
  horBlur = new HorizontalBlurEffect(device, { src: vertBlur }, width, height, format, clear);
  transform = new TransformEffect(device, { src: horBlur }, width, height, format, clear);
  layerBlend = new LayerBlendEffect(device, { src1: passthru, src2: transform }, width, height, format, clear);
  feedback.setFeedbackSrc(layerBlend);

  transform.setUniforms({
    rotate: 0,
    anchor: [0.5, 0.5],
    translate: [0, 0],
    scale: [0.995, 0.995],
  });
  vertBlur.setUniforms({ pixels: 2, resolution: height });
  horBlur.setUniforms({ pixels: 2, resolution: width });

  bloom = new BloomEffect(device, { src: layerBlend }, width, height, format, clear);
  bloom.setUniforms({
    preBlackLevel: 0.05,
    preBrightness: 1.6,
    bloomThreshold: 0.12,
    bloomIntensity: 1.1,
    minBloomRadius: 0.1,
    maxBloomRadius: 0.6,
  });

  finalFx = bloom;
};

rebuildFxChain(win.width, win.height);

const runner = new OfflineRunner(async (ctx) => {
  // Keep the root context alive; child branches drive the animation.
  await ctx.waitSec(1e9);
});

const eventChops: EventChop<CircleEvent>[] = [];
const eventShapes = new Map<number, StyledShape<typeof FlatColorMaterial>>();

const spawnShape = (evtId: number): StyledShape<typeof FlatColorMaterial> => {
  const shape = new StyledShape({
    scene,
    points: circleBasePoints,
    bodyMaterial: FlatColorMaterial,
  });
  shape.body.setUniforms({ color: [1, 1, 1, 1] });
  eventShapes.set(evtId, shape);
  return shape;
};

const removeStaleShapes = (activeIds: Set<number>) => {
  for (const [id, shape] of eventShapes.entries()) {
    if (!activeIds.has(id)) {
      scene.removeShape(shape);
      eventShapes.delete(id);
    }
  }
};

const updateShapes = (timeSec: number) => {
  const activeIds = new Set<number>();
  for (const chop of eventChops) {
    const samples = chop.samples(timeSec);
    for (const sample of samples) {
      activeIds.add(sample.evtId);
      const shape = eventShapes.get(sample.evtId) ?? spawnShape(sample.evtId);
      const radius = Math.max(0.001, 40 * (1 - sample.val));
      shape.x = sample.x;
      shape.y = sample.y;
      shape.scaleX = radius;
      shape.scaleY = radius;
      shape.body.setUniforms({ color: [sample.r, sample.g, sample.b, 1] });
    }
  }
  removeStaleShapes(activeIds);
};

const launchClickLoop = (x: number, y: number, normX: number, normY: number) => {
  const transposition = Math.floor((1 - normY) * 36);
  const seq = baseSeq.map((value) => value + transposition);
  const evtDur = baseDur * Math.pow(2, (1 - normX) * 4);
  const pitches = scale.getMultiple(seq);
  const mel = listToClip(pitches, evtDur);
  const durs = clipToDeltas(mel);
  const evtChop = new EventChop<CircleEvent>();
  eventChops.push(evtChop);

  runner.ctx.branch(async (ctx) => {
    while (true) {
      for (let i = 0; i < mel.length; i += 1) {
        const delta = durs[i] ?? 0;
        await ctx.waitSec(delta);
        const orbit = circle0[i];
        const posX = orbit.x * orbitRadius + x;
        const posY = orbit.y * orbitRadius + y;
        evtChop.ramp(evtDur * 4, {
          r: x / win.width,
          g: y / win.height,
          b: Math.random(),
          x: posX,
          y: posY,
        }, ctx.time);

        const { pitch, duration, velocity } = mel[i];
        const midiNote = clampMidiNote(pitch);
        const midiVelocity = toMidiVelocity(velocity);
        midiOutput.noteOn(0, midiNote, midiVelocity);
        ctx.branch(async (noteCtx) => {
          await noteCtx.waitSec(duration);
          midiOutput.noteOff(0, midiNote, 0);
        });
      }
      await ctx.waitSec(evtDur);
    }
  }, "click-loop");
};

const handleResize = (width: number, height: number) => {
  scene.resize(width, height);
  for (const shape of eventShapes.values()) {
    shape.setCanvasSize(width, height);
  }
  rebuildFxChain(width, height);
};

let running = true;
let lastTick = performance.now();
const loop = async () => {
  while (running) {
    const events = win.pollEvents();
    for (const event of events) {
      if (event.type === "close") {
        running = false;
      } else if (event.type === "resize") {
        handleResize(event.width, event.height);
      } else if (event.type === "mouse_button") {
        if (event.button === 0 && event.down) {
          const normX = event.x / Math.max(1, win.width);
          const normY = event.y / Math.max(1, win.height);
          launchClickLoop(event.x, event.y, normX, normY);
        }
      }
    }

    if (!running) break;

    const now = performance.now();
    let dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!Number.isFinite(dt) || dt <= 0) {
      dt = 1 / 60;
    } else if (dt > 0.25) {
      dt = 0.25;
    }
    await runner.stepSec(dt);
    const timeSec = runner.ctx.rootContext?.mostRecentDescendentTime ?? runner.ctx.time;
    updateShapes(timeSec);

    scene.render();
    finalFx.renderAll();

    const swapTexture = win.ctx.getCurrentTexture();
    const swapView = swapTexture.createView();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, finalFx.output, swapView);
    device.queue.submit([encoder.finish()]);
    win.present();

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  win.close();
};

try {
  await loop();
} finally {
  runner.ctx.cancel();
  midiOutput.close();
  midi.close();
}
