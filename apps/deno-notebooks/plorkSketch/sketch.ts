/// <reference lib="dom" />

// P5GPU sketch with a tweakpane control panel in a separate window.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all plorkSketch/sketch.ts

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

const WIDTH = 1280;
const HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

const paramDefs = {
  launch: {
    _folder: "Launch",
    duration: { value: 2.0, min: 0.1, max: 10, step: 0.1 },
    radius: { value: 20, min: 1, max: 200, step: 1 },
    hue: { value: 180, min: 0, max: 360, step: 1 },
    randomColor: { value: false },
    waveAmp: { value: 80, min: 0, max: 300, step: 1 },
    waveFreq: { value: 2.0, min: 0, max: 10, step: 0.1 },
    _actions: {
      launchRight: { action: () => launchCircle("right"), label: "Right" },
      launchLeft: { action: () => launchCircle("left"), label: "Left" },
      launchDown: { action: () => launchCircle("down"), label: "Down" },
      launchUp: { action: () => launchCircle("up"), label: "Up" },
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
};

const paramSystem = buildParamSystem(paramDefs);
const params = paramSystem.params as SketchParams;
const paneBindings = new Map<string, PaneBinding>();
const syncRef = { enabled: true };
const animationPlayback: AnimationPlaybackState = {
  playing: false,
  currentTime: 0,
  duration: 1,
};

type Direction = "left" | "right" | "up" | "down";

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

const rootAnim = launch(async (ctx) => {
  let lastTickTime = ctx.progTime;
  let lastAppliedTime: number | null = null;

  while (true) {
    while (actionQueue.length > 0) {
      const action = actionQueue.shift()!;
      action(ctx);
    }

    const now = ctx.progTime;
    const deltaTime = Math.max(0, now - lastTickTime);
    lastTickTime = now;

    if (animationPlayback.playing) {
      const nextTime = animationPlayback.currentTime + deltaTime;
      if (nextTime >= animationPlayback.duration) {
        animationPlayback.currentTime = animationPlayback.duration;
        animationPlayback.playing = false;
      } else {
        animationPlayback.currentTime = nextTime;
      }
    }

    const playbackTime = clampPlaybackTime(animationPlayback.currentTime);
    animationPlayback.currentTime = playbackTime;

    if (lastAppliedTime === null || Math.abs(playbackTime - lastAppliedTime) > 1e-6) {
      animationHandle.scrubAndEvaluate(playbackTime);
      lastAppliedTime = playbackTime;
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
