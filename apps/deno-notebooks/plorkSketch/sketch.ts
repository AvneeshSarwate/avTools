/// <reference lib="dom" />

// P5GPU sketch with a tweakpane control panel in a separate window.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all plorkSketch/sketch.ts
//
// CODE MAP
// ────────
//   1. IMPORTS
//   2. CONSTANTS
//   3. PARAM DEFINITIONS             — paramDefs, SketchParams type
//   4. PARAM SYSTEM & PLAYBACK STATE — buildParamSystem, paneBindings, animationPlayback
//   5. SKETCH STATE                  — orbit accumulator, square-walk state, active circles
//   6. BRANCH LAUNCHERS              — startWalkAnim, launchCircle, actionQueue
//   7. BRIDGE & HELPERS              — setupPane, clampPlaybackTime, animationBridge, callbacks
//   8. BOOT                          — device, renderWindow, p5, shader chain, animationHandle
//   9. ROOT LOOP                     — drain actionQueue, advance playback, scrub editor
//  10. FRAME FUNCTIONS               — renderFrame, cleanup
//  11. SCENE COMPOSITION             — drawCircle
//  12. SHADER CHAIN SETUP            — createFloodFillChain
//  13. COLOR HELPERS                 — hslToRgb, hue2rgb
//
// See plorkSketch/sketch_tools.md for a library-by-library overview.

// ============================================================================
// 1. IMPORTS
// ============================================================================
// deno-lint-ignore-file no-case-declarations

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
  type PaneBinding,
} from "../window/mod.ts";
import { FeedbackNode, PassthruEffect, selectShaderFxFormat } from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { launch, type DateTimeContext } from "@avtools/core-timing";
import { createAnimationEditorBridge, type AnimationPlaybackState } from "../tools/animationEditorAdapter.ts";
import {
  buildParamSystem,
  createAnimationCallbacks,
  snapshotToAnimation,
} from "../tools/paramSystem.ts";

// ============================================================================
// 2. CONSTANTS
// ============================================================================

const WIDTH = 1280;
const HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

// ============================================================================
// 3. PARAM DEFINITIONS — edit paramDefs to add/remove controls; mirror the leaf
//    keys into SketchParams. All leaf keys must be globally unique (params is flat).
// ============================================================================

const paramDefs = {
  launch: {
    _folder: "Launch",
    duration: { value: 2.0, min: 0.1, max: 10, step: 0.1 },
    radius: { value: 20, min: 1, max: 200, step: 1 },
    hue: { value: 180, min: 0, max: 360, step: 1 },
    randomColor: { value: false },
    waveAmp: { value: 80, min: 0, max: 300, step: 1 },
    waveFreq: { value: 2.0, min: 0, max: 10, step: 0.1 },
    orbitRad: { value: 100, min: 1, max: 400, step: 1 },
    startAngle: { value: 0, min: 0, max: 360, step: 1 },
    _actions: {
      launchRight: { action: () => launchCircle("right"), label: "Right" },
      launchLeft: { action: () => launchCircle("left"), label: "Left" },
      launchDown: { action: () => launchCircle("down"), label: "Down" },
      launchUp: { action: () => launchCircle("up"), label: "Up" },
      circleCW: { action: () => launchCircle("cw"), label: "Clockwise Orbit" },
      circleCCW: { action: () => launchCircle("ccw"), label: "Counter-Clockwise Orbit" },
    },
  },
  animations: {
    _folder: "Animations",
    bwMode: { value: "orbit", options: { Orbit: "orbit", Walk: "walk" } },
    orbit: {
      _folder: "Orbit",
      orbitRadius: { value: 150, min: 0, max: 400, step: 1 },
      orbitSpeed: { value: 1.0, min: -5, max: 5, step: 0.05 },
      orbitPhase: { value: 0, min: 0, max: 1, step: 0.01 },
      orbitCircleRadius: { value: 15, min: 1, max: 100, step: 1 },
    },
    walk: {
      _folder: "Walk",
      walkSquareSize: { value: 200, min: 10, max: 600, step: 1 },
      walkMinDur: { value: 0.3, min: 0.05, max: 5, step: 0.05 },
      walkMaxDur: { value: 1.5, min: 0.05, max: 5, step: 0.05 },
      walkCircleRadius: { value: 15, min: 1, max: 100, step: 1 },
    },
  },
  center: {
    _folder: "Center Circle",
    centerOn: { value: true },
    centerRadius: { value: 30, min: 1, max: 200, step: 1 },
    centerHue: { value: 0, min: 0, max: 360, step: 1 },
  },
  floodFill: {
    _folder: "Flood Fill",
    alphaThreshold: { value: 0.99, min: 0, max: 1, step: 0.01 },
    useDisk: { value: true },
    diskRadius: { value: 4, min: 1, max: 10, step: 1 },
  },
} as const;

type SketchParams = {
  duration: number;
  radius: number;
  hue: number;
  randomColor: boolean;
  waveAmp: number;
  waveFreq: number;
  bwMode: "orbit" | "walk";
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  orbitCircleRadius: number;
  walkSquareSize: number;
  walkMinDur: number;
  walkMaxDur: number;
  walkCircleRadius: number;
  centerOn: boolean;
  centerRadius: number;
  centerHue: number;
  alphaThreshold: number;
  useDisk: boolean;
  diskRadius: number;
  startAngle: number;
  orbitRad: number;
};

// ============================================================================
// 4. PARAM SYSTEM & PLAYBACK STATE
//    params: mutable flat value map read throughout the sketch.
//    paneBindings: captured inside pane.setup; used by callbacks to .refresh() sliders.
//    animationPlayback: shared with the animation editor; root loop advances currentTime.
// ============================================================================

const paramSystem = buildParamSystem(paramDefs);
const params = paramSystem.params as SketchParams;
const paneBindings = new Map<string, PaneBinding>();
const syncRef = { enabled: true };
const animationPlayback: AnimationPlaybackState = {
  playing: false,
  currentTime: 0,
  duration: 1,
  loop: false,
  speed: 1,
};

// ============================================================================
// 5. SKETCH STATE
//    Plain module-level state read by drawCircle and mutated by branches.
//    Orbit: continuous phase integrator. Walk: discrete tween between square vertices.
//    Active circles: Set populated by launchCircle branches.
// ============================================================================

type Direction = "left" | "right" | "up" | "down" | "cw" | "ccw";

interface CircleState {
  x: number;
  y: number;
  hue: number;
  radius: number;
  handle: { cancel: () => void; handleCancel: (f: () => void) => () => void };
}

const activeCircles: Set<CircleState> = new Set();

let orbitAccum = 0;
let lastOrbitTime = performance.now() * 0.001;

// Square walk state: 4 vertices indexed 0=TL, 1=TR, 2=BR, 3=BL
const SQUARE_VERTS: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function squareVertexPos(index: number): { x: number; y: number } {
  const [sx, sy] = SQUARE_VERTS[index];
  const half = params.walkSquareSize / 2;
  return { x: WIDTH / 2 + sx * half, y: HEIGHT / 2 + sy * half };
}

function randomAdjacentVertex(current: number): number {
  const dir = Math.random() < 0.5 ? -1 : 1;
  return (current + dir + 4) % 4;
}

function randomWalkDuration(): number {
  return params.walkMinDur + Math.random() * (params.walkMaxDur - params.walkMinDur);
}

interface WalkCircle {
  x: number;
  y: number;
  vertexIndex: number;
  startX: number;
  startY: number;
}

const walkBlack: WalkCircle = { x: 0, y: 0, vertexIndex: 0, startX: 0, startY: 0 };
const walkWhite: WalkCircle = { x: 0, y: 0, vertexIndex: 2, startX: 0, startY: 0 };

// Initialize start positions
{
  const bp = squareVertexPos(walkBlack.vertexIndex);
  walkBlack.x = bp.x; walkBlack.y = bp.y;
  walkBlack.startX = bp.x; walkBlack.startY = bp.y;
  const wp = squareVertexPos(walkWhite.vertexIndex);
  walkWhite.x = wp.x; walkWhite.y = wp.y;
  walkWhite.startX = wp.x; walkWhite.startY = wp.y;
}

// ============================================================================
// 6. BRANCH LAUNCHERS
//    UI callbacks and one-shot events push closures into actionQueue; the root
//    loop drains it and each closure spawns a ctx.branch under live root time.
//    startWalkAnim is a long-running branch that gates on params.bwMode === "walk".
//    launchCircle creates a short-lived branch per direction.
// ============================================================================

let walkAnimRunning = false;

function startWalkAnim() {
  if (walkAnimRunning) return;
  walkAnimRunning = true;
  actionQueue.push((ctx) => {
    ctx.branch(async (branchCtx) => {
      while (!branchCtx.isCanceled) {
        if (params.bwMode !== "walk") {
          await branchCtx.waitSec(1 / 30);
          continue;
        }
        // Black's turn
        const blackTarget = randomAdjacentVertex(walkBlack.vertexIndex);
        walkBlack.vertexIndex = blackTarget;
        walkBlack.startX = walkBlack.x;
        walkBlack.startY = walkBlack.y;
        const blackDur = randomWalkDuration();
        {
          const start = branchCtx.progTime;
          while (!branchCtx.isCanceled && branchCtx.progTime - start < blackDur) {
            const t = Math.min(1, (branchCtx.progTime - start) / blackDur);
            const target = squareVertexPos(walkBlack.vertexIndex);
            walkBlack.x = walkBlack.startX + (target.x - walkBlack.startX) * t;
            walkBlack.y = walkBlack.startY + (target.y - walkBlack.startY) * t;
            await branchCtx.waitSec(1 / 60);
          }
        }
        // Snap to final position
        const blackFinal = squareVertexPos(walkBlack.vertexIndex);
        walkBlack.x = blackFinal.x; walkBlack.y = blackFinal.y;
        walkBlack.startX = blackFinal.x; walkBlack.startY = blackFinal.y;

        // White's turn
        const whiteTarget = randomAdjacentVertex(walkWhite.vertexIndex);
        walkWhite.vertexIndex = whiteTarget;
        walkWhite.startX = walkWhite.x;
        walkWhite.startY = walkWhite.y;
        const whiteDur = randomWalkDuration();
        {
          const start = branchCtx.progTime;
          while (!branchCtx.isCanceled && branchCtx.progTime - start < whiteDur) {
            const t = Math.min(1, (branchCtx.progTime - start) / whiteDur);
            const target = squareVertexPos(walkWhite.vertexIndex);
            walkWhite.x = walkWhite.startX + (target.x - walkWhite.startX) * t;
            walkWhite.y = walkWhite.startY + (target.y - walkWhite.startY) * t;
            await branchCtx.waitSec(1 / 60);
          }
        }
        const whiteFinal = squareVertexPos(walkWhite.vertexIndex);
        walkWhite.x = whiteFinal.x; walkWhite.y = whiteFinal.y;
        walkWhite.startX = whiteFinal.x; walkWhite.startY = whiteFinal.y;
      }
    });
  });
}

const actionQueue: Array<(ctx: DateTimeContext) => void> = [];

function launchCircle(dir: Direction) {
  actionQueue.push((ctx) => {
    const hue = params.randomColor ? Math.random() * 360 : params.hue;
    const duration = params.duration;
    const radius = params.radius;
    const waveAmp = params.waveAmp;
    const waveFreq = params.waveFreq;
    const state: CircleState = { x: 0, y: 0, hue, radius, handle: null! };

    const rad = radius + 2;
    const handle = ctx.branch(async (branchCtx) => {
      while (!branchCtx.isCanceled && branchCtx.progTime < duration) {
        const t = branchCtx.progTime / duration;
        const wave = Math.sin(branchCtx.progTime * waveFreq * Math.PI * 2) * waveAmp;

        switch (dir) {
          case "right":
            state.x = -rad + t * (WIDTH + 2 * rad);
            state.y = HEIGHT / 2 + wave;
            break;
          case "left":
            state.x = WIDTH + rad - t * (WIDTH + 2 * rad);
            state.y = HEIGHT / 2 + wave;
            break;
          case "down":
            state.x = WIDTH / 2 + wave;
            state.y = -rad + t * (HEIGHT + 2 * rad);
            break;
          case "up":
            state.x = WIDTH / 2 + wave;
            state.y = HEIGHT + rad - t * (HEIGHT + 2 * rad);
            break;
          case "cw":
            const angle = (params.startAngle * Math.PI / 180) + (t * 2 * Math.PI);
            state.x = WIDTH / 2 + Math.cos(angle) * params.orbitRad;
            state.y = HEIGHT / 2 + Math.sin(angle) * params.orbitRad;
            break;
          case "ccw":
            const angle2 = (params.startAngle * Math.PI / 180) - (t * 2 * Math.PI);
            state.x = WIDTH / 2 + Math.cos(angle2) * params.orbitRad;
            state.y = HEIGHT / 2 + Math.sin(angle2) * params.orbitRad;
            break;
        }
        await branchCtx.waitSec(1 / 60);
      }
      activeCircles.delete(state);
    });

    handle.handleCancel(() => activeCircles.delete(state));
    state.handle = handle;
    activeCircles.add(state);
  });
}

// ============================================================================
// 7. BRIDGE & HELPERS
//    setupPane: the pane.setup callback — installs paramSystem bindings, captures
//      them for later .refresh() calls from playback.
//    animationBridge: spawns the editor webview, snapshots current params on demand.
//    animationCallbacks: applied via animationHandle.setCallbacks to let the editor
//      write into `params` (and trigger actions on func-track keyframes).
// ============================================================================

function setupPane(pane: WindowTweakpane): void {
  const nextBindings = paramSystem.setupPane(pane);
  paneBindings.clear();
  for (const [key, binding] of nextBindings) {
    paneBindings.set(key, binding);
  }
}

function clampPlaybackTime(time: number): number {
  return Math.min(Math.max(time, 0), animationPlayback.duration);
}

let animationBridge = createAnimationEditorBridge({
  management: {
    trackInputs: paramSystem.trackInputs,
    syncRef,
    playbackRef: animationPlayback,
    snapshotCurrentState: (animationName, time) => {
      snapshotToAnimation(params, paramSystem.paramMeta, animationBridge.tracks, animationName, time);
    },
  },
});

const animationCallbacks = createAnimationCallbacks(
  params,
  paneBindings,
  paramSystem.paramMeta,
  paramSystem.actionMap,
  syncRef,
);

animationBridge.tracks.setFromInputs("default", paramSystem.trackInputs);

// ============================================================================
// 8. BOOT
//    Top-level await for WebGPU device, native window (+ Syphon + tweakpane),
//    P5GPU instance, shader-fx/raw chain, and the animation-editor webview.
//    Order matters: renderWindow is created before p5 so pane.setup can run.
// ============================================================================

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "P5GPU + Tweakpane",
  syphon: {
    serverName: "P5GPU_Panel_Demo",
    flipY: true,
  },
  pane: {
    title: "Circle Demo",
    panelWidth: 420,
    panelHeight: 300,
    setup: setupPane,
  },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const floodFill = await createFloodFillChain(device, WIDTH, HEIGHT);

const animationHandle = animationBridge.showBoundInWindow(renderWindow.window, "default", {
  title: "Animation Editor",
  panelWidth: 1100,
  panelHeight: 760,
});
animationHandle.setCallbacks(animationCallbacks);

// ============================================================================
// 9. ROOT LOOP
//    Exactly one core-timing root. Ticks at 1/60s (branches launched via
//    actionQueue inherit this tick rate as their base time).
//    Per tick: (a) drain actionQueue, (b) advance animationPlayback.currentTime
//    if playing, (c) push the playhead to the editor via scrubAndEvaluate
//    (applies keyframes to params) / scrubToTime (playback metadata changed only).
// ============================================================================

const rootAnim = launch(async (ctx) => {
  let lastTickTime = ctx.progTime;
  let lastAppliedTime: number | null = null;
  let lastPlaybackSignature = "";

  while (true) {
    while (actionQueue.length > 0) {
      const action = actionQueue.shift()!;
      action(ctx);
    }

    const now = ctx.progTime;
    const deltaTime = Math.max(0, now - lastTickTime);
    lastTickTime = now;

    const duration = Math.max(animationPlayback.duration, 0);
    const speed = Number.isFinite(animationPlayback.speed) ? Math.max(0, animationPlayback.speed) : 1;
    if (animationPlayback.playing) {
      const nextTime = animationPlayback.currentTime + deltaTime * speed;
      if (duration <= 0) {
        animationPlayback.currentTime = 0;
        animationPlayback.playing = false;
      } else if (nextTime >= duration) {
        if (animationPlayback.loop) {
          animationHandle.scrubAndEvaluate(duration);
          animationHandle.scrubToTime(0);
          lastAppliedTime = null;
          animationPlayback.currentTime = nextTime % duration;
        } else {
          animationPlayback.currentTime = duration;
          animationPlayback.playing = false;
        }
      } else {
        animationPlayback.currentTime = nextTime;
      }
    }

    const playbackTime = clampPlaybackTime(animationPlayback.currentTime);
    animationPlayback.currentTime = playbackTime;
    const playbackSignature = JSON.stringify({
      playing: animationPlayback.playing,
      currentTime: playbackTime,
      duration: animationPlayback.duration,
      loop: animationPlayback.loop,
      speed: animationPlayback.speed,
    });

    if (lastAppliedTime === null || Math.abs(playbackTime - lastAppliedTime) > 1e-6) {
      animationHandle.scrubAndEvaluate(playbackTime);
      lastAppliedTime = playbackTime;
      lastPlaybackSignature = playbackSignature;
    } else if (playbackSignature !== lastPlaybackSignature) {
      animationHandle.scrubToTime(playbackTime);
      lastPlaybackSignature = playbackSignature;
    }

    animationHandle.setLivePlayhead(playbackTime);
    await ctx.waitSec(1 / 60);
  }
});
rootAnim.catch((err: unknown) => {
  if ((err as Error)?.message !== "aborted") console.error("Root context error:", err);
});

startWalkAnim();

await renderWindow.run(renderFrame, { cleanup: cleanup });

// ============================================================================
// 10. FRAME FUNCTIONS
//     renderFrame must be synchronous and return a WindowRenderSource
//     (ShaderEffect | GPUTexture | GPUTextureView). The manager blits that
//     to the window swap chain and publishes via Syphon if configured.
//     cleanup runs before the window disposes.
// ============================================================================

function renderFrame() {
  const time = performance.now() * 0.001;

  p5.beginFrame();
  drawCircle();
  const sourceTexture = p5.endFrame();

  floodFill.timeStamper.setSrcs({ src: sourceTexture });
  floodFill.timeStamper.setUniforms({ drawTime: time, alphaThreshold: params.alphaThreshold });
  const stepUniforms = {
    diskRadius: params.diskRadius,
    useDisk: params.useDisk ? 1 : 0,
  };
  floodFill.floodFillSeed.setUniforms(stepUniforms);
  floodFill.floodFill.setUniforms(stepUniforms);
  floodFill.display.renderAll();

  return floodFill.display;
}

function cleanup(): void {
  rootAnim.cancel();
  animationHandle.disconnect();
  animationBridge.shutdown();
  floodFill.display.disposeAll();
  floodFill.placeholder.destroy();
  p5.dispose();
}

// ============================================================================
// 11. SCENE COMPOSITION
//     Immediate-mode p5gpu draw calls. Reads params + module state; must be
//     sandwiched between p5.beginFrame() / p5.endFrame() (done by renderFrame).
// ============================================================================

function drawCircle(): void {
  p5.clear();
  p5.noStroke();

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const now = performance.now() * 0.001;
  const dt = now - lastOrbitTime;
  lastOrbitTime = now;

  if (params.bwMode === "orbit") {
    orbitAccum += dt * params.orbitSpeed;
    const phase = (orbitAccum + params.orbitPhase) * Math.PI * 2;
    const orbitDiameter = params.orbitCircleRadius * 2;

    p5.fill(255, 255, 255);
    p5.circle(
      cx + Math.cos(phase) * params.orbitRadius,
      cy + Math.sin(phase) * params.orbitRadius,
      orbitDiameter,
    );
    p5.fill(0, 0, 0);
    p5.circle(
      cx + Math.cos(phase + Math.PI) * params.orbitRadius,
      cy + Math.sin(phase + Math.PI) * params.orbitRadius,
      orbitDiameter,
    );
  } else {
    const walkDiameter = params.walkCircleRadius * 2;
    p5.fill(0, 0, 0);
    p5.circle(walkBlack.x, walkBlack.y, walkDiameter);
    p5.fill(255, 255, 255);
    p5.circle(walkWhite.x, walkWhite.y, walkDiameter);
  }

  if (params.centerOn) {
    const cc = hslToRgb(params.centerHue / 360, 0.8, 0.6);
    p5.fill(cc[0], cc[1], cc[2]);
    p5.circle(cx, cy, params.centerRadius * 2);
  }

  for (const state of activeCircles) {
    const c = hslToRgb(state.hue / 360, 0.8, 0.6);
    p5.fill(c[0], c[1], c[2]);
    p5.circle(state.x, state.y, state.radius * 2);
  }
}

// ============================================================================
// 12. SHADER CHAIN SETUP
//     Builds a flood-fill-with-time-decay DAG: source → AlphaTimeTag (stamp
//     draw time into alpha) → FloodFillStep(seed) → Passthru → FeedbackNode
//     → FloodFillStep(feedback) → FloodFillDisplay (terminal). Uses rgba16float
//     for feedback precision. Terminal is returned from renderFrame.
// ============================================================================

async function createFloodFillChain(device: GPUDevice, width: number, height: number) {
  const format = await selectShaderFxFormat(device, ["rgba16float"]);
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });

  const timeStamper = new AlphaTimeTagEffect(
    device,
    { src: placeholder },
    width, height, format, CLEAR_COLOR,
  );
  const floodFillSeed = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: timeStamper },
    width, height, format, CLEAR_COLOR, "nearest",
  );
  const feedbackSeed = new PassthruEffect(
    device,
    { src: floodFillSeed },
    width, height, format, CLEAR_COLOR, "nearest",
  );
  const feedback = new FeedbackNode(
    device,
    feedbackSeed,
    width, height, format, CLEAR_COLOR, "nearest",
  );
  const floodFill = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback },
    width, height, format, CLEAR_COLOR, "nearest",
  );
  const display = new FloodFillDisplayEffect(
    device,
    { src: floodFill },
    width, height, format, CLEAR_COLOR,
  );

  feedback.setFeedbackSrc(floodFill);

  return {
    placeholder,
    timeStamper,
    floodFillSeed,
    floodFill,
    display,
  };
}

// ============================================================================
// 13. COLOR HELPERS
// ============================================================================

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
