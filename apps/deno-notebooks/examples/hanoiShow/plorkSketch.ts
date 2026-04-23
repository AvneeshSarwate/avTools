/// <reference lib="dom" />

// Plork scene adapted from apps/deno-notebooks/plorkSketch/sketch.ts
// for hanoiShow integration. The core animation + post-processing logic is
// preserved, but the scene now exposes the standard show hooks.

// deno-lint-ignore-file no-case-declarations

import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import {
  FeedbackNode,
  PassthruEffect,
  selectShaderFxFormat,
  type ShaderEffect,
} from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { BloomPreprocessEffect } from "@avtools/shader-fx/generated-raw/shaders/bloomPreprocess.frag.raw.generated.ts";
import { ColorRemoveEffect } from "@avtools/shader-fx/generated-raw/shaders/colorRemove.frag.raw.generated.ts";
import { CompositeEffect } from "@avtools/shader-fx/generated-raw/shaders/composite.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";
import { HorizontalBlurEffect } from "@avtools/shader-fx/generated-raw/shaders/horizontalBlur.frag.raw.generated.ts";
import { VerticalBlurEffect } from "@avtools/shader-fx/generated-raw/shaders/verticalBlur.frag.raw.generated.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";
import { P5GPU } from "../../tools/p5gpu.ts";
import { buildParamSystem } from "../../tools/paramSystem.ts";

const STANDALONE_WIDTH = 1280;
const STANDALONE_HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

const paramDefs = {
  fade: { value: 1.0, min: 0, max: 1, step: 0.001, label: "Scene Fade" },
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
      circleCCW: {
        action: () => launchCircle("ccw"),
        label: "Counter-Clockwise Orbit",
      },
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
  bloom: {
    _folder: "Bloom",
    bloomOn: { value: true },
    preBlackLevel: { value: 0.05, min: 0, max: 1, step: 0.01 },
    preBrightness: { value: 2.0, min: 0, max: 10, step: 0.1 },
    bloomThreshold: { value: 0.12, min: 0, max: 1, step: 0.01 },
    bloomKnee: { value: 0.5, min: 0, max: 1, step: 0.01 },
    bloomBlurSize: { value: 5, min: 1, max: 16, step: 1 },
    bloomIntensity: { value: 1.0, min: 0, max: 5, step: 0.05 },
    bloomBlendMode: {
      value: "screen",
      options: { Add: "add", Screen: "screen" },
    },
    removeThreshold: { value: 0.3, min: 0, max: 1, step: 0.01 },
    removeFeather: { value: 0.1, min: 0, max: 0.5, step: 0.01 },
    bloomDebug: {
      value: "off",
      options: {
        Off: "off",
        Display: "display",
        "Color Removed": "colorRemove",
        Preprocess: "preprocess",
        "Bloom Only": "bloom",
      },
    },
  },
} as const;

type SketchParams = {
  fade: number;
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
  bloomOn: boolean;
  preBlackLevel: number;
  preBrightness: number;
  bloomThreshold: number;
  bloomKnee: number;
  bloomBlurSize: number;
  bloomIntensity: number;
  bloomBlendMode: "add" | "screen";
  removeThreshold: number;
  removeFeather: number;
  bloomDebug: "off" | "display" | "colorRemove" | "preprocess" | "bloom";
};

type Direction = "left" | "right" | "up" | "down" | "cw" | "ccw";

interface CircleState {
  x: number;
  y: number;
  hue: number;
  radius: number;
  handle: {
    cancel: () => void;
    handleCancel: (f: () => void) => () => void;
  };
}

interface WalkCircle {
  x: number;
  y: number;
  vertexIndex: number;
  startX: number;
  startY: number;
}

type FloodFillChain = Awaited<ReturnType<typeof createFloodFillChain>>;

const paramSystem = buildParamSystem(paramDefs);

export const state = {
  params: paramSystem.params as SketchParams,
  meta: {
    width: STANDALONE_WIDTH,
    height: STANDALONE_HEIGHT,
  },
  runtime: {
    rootLoop: null as ReturnType<typeof launch> | null,
    floodFill: null as FloodFillChain | null,
  },
};

const activeCircles: Set<CircleState> = new Set();
const actionQueue: Array<(ctx: DateTimeContext) => void> = [];

let orbitAccum = 0;
let lastOrbitTime = performance.now() * 0.001;
let walkAnimRunning = false;

const SQUARE_VERTS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const walkBlack: WalkCircle = {
  x: 0,
  y: 0,
  vertexIndex: 0,
  startX: 0,
  startY: 0,
};
const walkWhite: WalkCircle = {
  x: 0,
  y: 0,
  vertexIndex: 2,
  startX: 0,
  startY: 0,
};

resetWalkPositions();

function squareVertexPos(index: number): { x: number; y: number } {
  const [sx, sy] = SQUARE_VERTS[index];
  const half = state.params.walkSquareSize / 2;
  return {
    x: state.meta.width / 2 + sx * half,
    y: state.meta.height / 2 + sy * half,
  };
}

function resetWalkPositions(): void {
  const bp = squareVertexPos(walkBlack.vertexIndex);
  walkBlack.x = bp.x;
  walkBlack.y = bp.y;
  walkBlack.startX = bp.x;
  walkBlack.startY = bp.y;

  const wp = squareVertexPos(walkWhite.vertexIndex);
  walkWhite.x = wp.x;
  walkWhite.y = wp.y;
  walkWhite.startX = wp.x;
  walkWhite.startY = wp.y;
}

function randomAdjacentVertex(current: number): number {
  const dir = Math.random() < 0.5 ? -1 : 1;
  return (current + dir + 4) % 4;
}

function randomWalkDuration(): number {
  return state.params.walkMinDur +
    Math.random() * (state.params.walkMaxDur - state.params.walkMinDur);
}

type LaunchParams = {
  hue: number;
  randomColor: number;
  duration: number;
  radius: number;
  waveAmp: number;
  waveFreq: number;
};

function ensureRootLoop(): void {
  if (state.runtime.rootLoop) return;

  const loop = launch(async (ctx) => {
    startWalkAnim(ctx);
    while (!ctx.isCanceled) {
      while (actionQueue.length > 0) {
        const action = actionQueue.shift();
        action?.(ctx);
      }
      await ctx.waitSec(1 / 60);
    }
  });

  loop.catch((err: unknown) => {
    if ((err as Error)?.message !== "aborted") {
      console.error("plorkSketch root loop error:", err);
    }
  });

  state.runtime.rootLoop = loop;
}

function startWalkAnim(ctx: DateTimeContext): void {
  if (walkAnimRunning) return;
  walkAnimRunning = true;

  ctx.branch(async (branchCtx) => {
    try {
      while (!branchCtx.isCanceled) {
        if (state.params.bwMode !== "walk") {
          await branchCtx.waitSec(1 / 30);
          continue;
        }

        const blackTarget = randomAdjacentVertex(walkBlack.vertexIndex);
        walkBlack.vertexIndex = blackTarget;
        walkBlack.startX = walkBlack.x;
        walkBlack.startY = walkBlack.y;
        const blackDur = randomWalkDuration();
        {
          const start = branchCtx.progTime;
          while (
            !branchCtx.isCanceled && branchCtx.progTime - start < blackDur
          ) {
            const t = Math.min(1, (branchCtx.progTime - start) / blackDur);
            const target = squareVertexPos(walkBlack.vertexIndex);
            walkBlack.x = walkBlack.startX + (target.x - walkBlack.startX) * t;
            walkBlack.y = walkBlack.startY + (target.y - walkBlack.startY) * t;
            await branchCtx.waitSec(1 / 60);
          }
        }
        const blackFinal = squareVertexPos(walkBlack.vertexIndex);
        walkBlack.x = blackFinal.x;
        walkBlack.y = blackFinal.y;
        walkBlack.startX = blackFinal.x;
        walkBlack.startY = blackFinal.y;

        const whiteTarget = randomAdjacentVertex(walkWhite.vertexIndex);
        walkWhite.vertexIndex = whiteTarget;
        walkWhite.startX = walkWhite.x;
        walkWhite.startY = walkWhite.y;
        const whiteDur = randomWalkDuration();
        {
          const start = branchCtx.progTime;
          while (
            !branchCtx.isCanceled && branchCtx.progTime - start < whiteDur
          ) {
            const t = Math.min(1, (branchCtx.progTime - start) / whiteDur);
            const target = squareVertexPos(walkWhite.vertexIndex);
            walkWhite.x = walkWhite.startX + (target.x - walkWhite.startX) * t;
            walkWhite.y = walkWhite.startY + (target.y - walkWhite.startY) * t;
            await branchCtx.waitSec(1 / 60);
          }
        }
        const whiteFinal = squareVertexPos(walkWhite.vertexIndex);
        walkWhite.x = whiteFinal.x;
        walkWhite.y = whiteFinal.y;
        walkWhite.startX = whiteFinal.x;
        walkWhite.startY = whiteFinal.y;
      }
    } finally {
      walkAnimRunning = false;
    }
  });
}

function launchCircle(
  dir: Direction,
  launchParams?: Partial<LaunchParams>,
): void {
  actionQueue.push((ctx) => {
    const lp = launchParams ?? {};
    const randCol = lp.randomColor ?? (state.params.randomColor ? 1 : 0);
    const hue = randCol ? Math.random() * 360 : (lp.hue ?? state.params.hue);
    const duration = lp.duration ?? state.params.duration;
    const radius = lp.radius ?? state.params.radius;
    const waveAmp = lp.waveAmp ?? state.params.waveAmp;
    const waveFreq = lp.waveFreq ?? state.params.waveFreq;
    const circle: CircleState = { x: 0, y: 0, hue, radius, handle: null! };

    const rad = radius + 2;
    const handle = ctx.branch(async (branchCtx) => {
      while (!branchCtx.isCanceled && branchCtx.progTime < duration) {
        const t = branchCtx.progTime / duration;
        const wave = Math.sin(branchCtx.progTime * waveFreq * Math.PI * 2) *
          waveAmp;

        switch (dir) {
          case "right":
            circle.x = -rad + t * (state.meta.width + 2 * rad);
            circle.y = state.meta.height / 2 + wave;
            break;
          case "left":
            circle.x = state.meta.width + rad -
              t * (state.meta.width + 2 * rad);
            circle.y = state.meta.height / 2 + wave;
            break;
          case "down":
            circle.x = state.meta.width / 2 + wave;
            circle.y = -rad + t * (state.meta.height + 2 * rad);
            break;
          case "up":
            circle.x = state.meta.width / 2 + wave;
            circle.y = state.meta.height + rad -
              t * (state.meta.height + 2 * rad);
            break;
          case "cw":
            const angle = (state.params.startAngle * Math.PI / 180) +
              (t * 2 * Math.PI);
            circle.x = state.meta.width / 2 +
              Math.cos(angle) * state.params.orbitRad;
            circle.y = state.meta.height / 2 +
              Math.sin(angle) * state.params.orbitRad;
            break;
          case "ccw":
            const angle2 = (state.params.startAngle * Math.PI / 180) -
              (t * 2 * Math.PI);
            circle.x = state.meta.width / 2 +
              Math.cos(angle2) * state.params.orbitRad;
            circle.y = state.meta.height / 2 +
              Math.sin(angle2) * state.params.orbitRad;
            break;
        }
        await branchCtx.waitSec(1 / 60);
      }
      activeCircles.delete(circle);
    });

    handle.handleCancel(() => activeCircles.delete(circle));
    circle.handle = handle;
    activeCircles.add(circle);
  });
}

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  paramSystem.setupPane(pane);
}

export async function setup(
  config: { width: number; height: number; device: GPUDevice },
): Promise<void> {
  state.meta.width = config.width;
  state.meta.height = config.height;
  lastOrbitTime = performance.now() * 0.001;
  resetWalkPositions();
  ensureRootLoop();

  disposeFloodFill();
  state.runtime.floodFill = await createFloodFillChain(
    config.device,
    config.width,
    config.height,
  );
}

export function draw(
  p5: P5GPU,
  autoClear = true,
  forceSkip = false,
): GPUTextureView {
  const now = performance.now() * 0.001;
  const dt = now - lastOrbitTime;
  lastOrbitTime = now;

  if (state.params.bwMode === "orbit") {
    orbitAccum += dt * state.params.orbitSpeed;
  }

  p5.beginFrame();
  if (autoClear) p5.clear();

  const fade = forceSkip ? 0 : state.params.fade;
  if (fade > 0) {
    drawCircles(p5, fade);
  }

  const sourceTexture = p5.endFrame();
  const floodFill = state.runtime.floodFill;
  if (!floodFill || fade <= 0) {
    return sourceTexture.createView();
  }

  floodFill.timeStamper.setSrcs({ src: sourceTexture });
  floodFill.timeStamper.setUniforms({
    drawTime: now,
    alphaThreshold: state.params.alphaThreshold,
  });

  const stepUniforms = {
    diskRadius: state.params.diskRadius,
    useDisk: state.params.useDisk ? 1 : 0,
  };
  floodFill.floodFillSeed.setUniforms(stepUniforms);
  floodFill.floodFill.setUniforms(stepUniforms);

  if (!state.params.bloomOn) {
    floodFill.display.renderAll();
    return floodFill.display.output;
  }

  floodFill.colorRemove.setUniforms({
    targetR: 1,
    targetG: 1,
    targetB: 1,
    threshold: state.params.removeThreshold,
    feather: state.params.removeFeather,
  });
  floodFill.bloomPreprocess.setUniforms({
    blackLevel: state.params.preBlackLevel,
    brightness: state.params.preBrightness,
    threshold: state.params.bloomThreshold,
    knee: state.params.bloomKnee,
  });

  for (let i = 0; i < floodFill.hBlurs.length; i += 1) {
    floodFill.hBlurs[i].setUniforms({
      pixels: state.params.bloomBlurSize,
      resolution: floodFill.mipWidths[i],
    });
    floodFill.vBlurs[i].setUniforms({
      pixels: state.params.bloomBlurSize,
      resolution: floodFill.mipHeights[i],
    });
  }

  for (const up of floodFill.upComposites) {
    up.setUniforms({ mode: 0, opacity: state.params.bloomIntensity });
  }
  floodFill.bloomToFullRes.setUniforms({
    mode: 0,
    opacity: state.params.bloomIntensity,
  });

  const blendMode = state.params.bloomBlendMode === "add" ? 0 : 1;
  floodFill.bloomComposite.setUniforms({
    mode: blendMode,
    opacity: state.params.bloomIntensity,
  });

  switch (state.params.bloomDebug) {
    case "display":
      floodFill.display.renderAll();
      return floodFill.display.output;
    case "colorRemove":
      floodFill.colorRemove.renderAll();
      return floodFill.colorRemove.output;
    case "preprocess":
      floodFill.bloomPreprocess.renderAll();
      return floodFill.bloomPreprocess.output;
    case "bloom":
      floodFill.bloomToFullRes.renderAll();
      return floodFill.bloomToFullRes.output;
    default:
      floodFill.bloomComposite.renderAll();
      return floodFill.bloomComposite.output;
  }
}

export function cleanup(): void {
  state.runtime.rootLoop?.cancel();
  state.runtime.rootLoop = null;
  walkAnimRunning = false;

  for (const circle of activeCircles) {
    circle.handle.cancel();
  }
  activeCircles.clear();
  actionQueue.length = 0;

  disposeFloodFill();
}

function disposeFloodFill(): void {
  const floodFill = state.runtime.floodFill;
  if (!floodFill) return;
  floodFill.bloomComposite.disposeAll();
  floodFill.placeholder.destroy();
  state.runtime.floodFill = null;
}

function drawCircles(p5: P5GPU, fade: number): void {
  const cx = p5.width / 2;
  const cy = p5.height / 2;
  const alpha = Math.round(255 * fade);

  p5.noStroke();

  if (state.params.bwMode === "orbit") {
    const phase = (orbitAccum + state.params.orbitPhase) * Math.PI * 2;
    const orbitDiameter = state.params.orbitCircleRadius * 2;

    p5.fill(255, 255, 255, alpha);
    p5.circle(
      cx + Math.cos(phase) * state.params.orbitRadius,
      cy + Math.sin(phase) * state.params.orbitRadius,
      orbitDiameter,
    );
    p5.fill(0, 0, 0, alpha);
    p5.circle(
      cx + Math.cos(phase + Math.PI) * state.params.orbitRadius,
      cy + Math.sin(phase + Math.PI) * state.params.orbitRadius,
      orbitDiameter,
    );
  } else {
    const walkDiameter = state.params.walkCircleRadius * 2;
    p5.fill(0, 0, 0, alpha);
    p5.circle(walkBlack.x, walkBlack.y, walkDiameter);
    p5.fill(255, 255, 255, alpha);
    p5.circle(walkWhite.x, walkWhite.y, walkDiameter);
  }

  if (state.params.centerOn) {
    const cc = hslToRgb(state.params.centerHue / 360, 0.8, 0.6);
    p5.fill(cc[0], cc[1], cc[2], alpha);
    p5.circle(cx, cy, state.params.centerRadius * 2);
  }

  for (const circle of activeCircles) {
    const c = hslToRgb(circle.hue / 360, 0.8, 0.6);
    p5.fill(c[0], c[1], c[2], alpha);
    p5.circle(circle.x, circle.y, circle.radius * 2);
  }
}

async function createFloodFillChain(
  device: GPUDevice,
  width: number,
  height: number,
) {
  const format = await selectShaderFxFormat(device, ["rgba16float"]);
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });

  const timeStamper = new AlphaTimeTagEffect(
    device,
    { src: placeholder },
    width,
    height,
    format,
    CLEAR_COLOR,
  );
  const floodFillSeed = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: timeStamper },
    width,
    height,
    format,
    CLEAR_COLOR,
    "nearest",
  );
  const feedbackSeed = new PassthruEffect(
    device,
    { src: floodFillSeed },
    width,
    height,
    format,
    CLEAR_COLOR,
    "nearest",
  );
  const feedback = new FeedbackNode(
    device,
    feedbackSeed,
    width,
    height,
    format,
    CLEAR_COLOR,
    "nearest",
  );
  const floodFill = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback },
    width,
    height,
    format,
    CLEAR_COLOR,
    "nearest",
  );
  const display = new FloodFillDisplayEffect(
    device,
    { src: floodFill },
    width,
    height,
    format,
    CLEAR_COLOR,
  );

  const colorRemove = new ColorRemoveEffect(
    device,
    { src: display },
    width,
    height,
    format,
    CLEAR_COLOR,
  );
  const bloomPreprocess = new BloomPreprocessEffect(
    device,
    { src: colorRemove },
    width,
    height,
    format,
    CLEAR_COLOR,
  );

  const MIP_LEVELS = 4;
  const mipWidths: number[] = [];
  const mipHeights: number[] = [];
  for (let i = 0; i < MIP_LEVELS; i += 1) {
    mipWidths.push(Math.ceil(width / Math.pow(2, i + 1)));
    mipHeights.push(Math.ceil(height / Math.pow(2, i + 1)));
  }

  const downs: PassthruEffect[] = [];
  const hBlurs: HorizontalBlurEffect[] = [];
  const vBlurs: VerticalBlurEffect[] = [];

  for (let i = 0; i < MIP_LEVELS; i += 1) {
    const w = mipWidths[i];
    const h = mipHeights[i];
    const downSrc = i === 0 ? bloomPreprocess : downs[i - 1];

    const down = new PassthruEffect(
      device,
      { src: downSrc },
      w,
      h,
      format,
      CLEAR_COLOR,
    );
    const hBlur = new HorizontalBlurEffect(
      device,
      { src: down },
      w,
      h,
      format,
      CLEAR_COLOR,
    );
    const vBlur = new VerticalBlurEffect(
      device,
      { src: hBlur },
      w,
      h,
      format,
      CLEAR_COLOR,
    );

    downs.push(down);
    hBlurs.push(hBlur);
    vBlurs.push(vBlur);
  }

  const upComposites: CompositeEffect[] = [];
  let accumulated: ShaderEffect = vBlurs[MIP_LEVELS - 1];

  for (let i = MIP_LEVELS - 2; i >= 0; i -= 1) {
    const up = new CompositeEffect(
      device,
      { src1: vBlurs[i], src2: accumulated },
      mipWidths[i],
      mipHeights[i],
      format,
      CLEAR_COLOR,
    );
    up.setUniforms({ mode: 0, opacity: 1.0 });
    upComposites.push(up);
    accumulated = up;
  }

  const bloomToFullRes = new CompositeEffect(
    device,
    { src1: bloomPreprocess, src2: accumulated },
    width,
    height,
    format,
    CLEAR_COLOR,
  );
  bloomToFullRes.setUniforms({ mode: 0, opacity: 1.0 });

  const bloomComposite = new CompositeEffect(
    device,
    { src1: display, src2: bloomToFullRes },
    width,
    height,
    format,
    CLEAR_COLOR,
  );
  bloomComposite.setUniforms({ mode: 1, opacity: 1.0 });

  feedback.setFeedbackSrc(floodFill);

  return {
    placeholder,
    timeStamper,
    floodFillSeed,
    floodFill,
    display,
    colorRemove,
    bloomPreprocess,
    mipWidths,
    mipHeights,
    hBlurs,
    vBlurs,
    upComposites,
    bloomToFullRes,
    bloomComposite,
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }
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

if (import.meta.main) {
  const device = await requestWebGpuDevice();
  await setup({
    width: STANDALONE_WIDTH,
    height: STANDALONE_HEIGHT,
    device,
  });

  const renderWindow = await createWindowRenderManager({
    device,
    width: STANDALONE_WIDTH,
    height: STANDALONE_HEIGHT,
    title: "Plork Sketch",
    syphon: {
      serverName: "P5GPU_Panel_Demo",
      flipY: true,
    },
    pane: {
      title: "Plork Sketch",
      panelWidth: 420,
      panelHeight: 680,
      setup: (pane) => setupPane(pane),
    },
  });
  const p5 = new P5GPU(device, {
    width: STANDALONE_WIDTH,
    height: STANDALONE_HEIGHT,
  });

  await renderWindow.run(() => draw(p5), {
    cleanup() {
      cleanup();
      p5.dispose();
    },
  });
}
