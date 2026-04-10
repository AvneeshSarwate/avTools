/// <reference lib="dom" />

// P5GPU sketch with a tweakpane control panel in a separate window.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all plorkSketch/sketch.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { FeedbackNode, PassthruEffect, selectShaderFxFormat } from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { launch, type DateTimeContext } from "@avtools/core-timing";

const WIDTH = 1280;
const HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

const params = {
  duration: 2.0,
  hue: 180,
  radius: 20,
  alphaThreshold: 0.99,
  bwMode: "orbit" as "orbit" | "walk",
  orbitRadius: 150,
  orbitSpeed: 1.0,
  orbitPhase: 0,
  orbitCircleRadius: 15,
  walkSquareSize: 200,
  walkMinDur: 0.3,
  walkMaxDur: 1.5,
  walkCircleRadius: 15,
  useDisk: true,
  diskRadius: 4,
  waveAmp: 80,
  waveFreq: 2.0,
  randomColor: false,
  centerOn: true,
  centerRadius: 30,
  centerHue: 0,
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

const rootAnim = launch(async (ctx) => {
  while (true) {
    while (actionQueue.length > 0) {
      const action = actionQueue.shift()!;
      action(ctx);
    }
    await ctx.waitSec(1 / 60);
  }
});
rootAnim.catch((err: unknown) => {
  if ((err as Error)?.message !== "aborted") console.error("Root context error:", err);
});

startWalkAnim();

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
  floodFill.display.disposeAll();
  floodFill.placeholder.destroy();
  p5.dispose();
}

function setupPane(pane: WindowTweakpane): void {
  const launch = pane.addFolder({ title: "Launch" });
  launch.addBinding(params, "duration", { min: 0.1, max: 10, step: 0.1 });
  launch.addBinding(params, "radius", { min: 1, max: 200, step: 1 });
  launch.addBinding(params, "hue", { min: 0, max: 360, step: 1 });
  launch.addBinding(params, "randomColor");
  launch.addBinding(params, "waveAmp", { min: 0, max: 300, step: 1 });
  launch.addBinding(params, "waveFreq", { min: 0, max: 10, step: 0.1 });
  launch.addButton({ title: "Right" }).on("click", () => launchCircle("right"));
  launch.addButton({ title: "Left" }).on("click", () => launchCircle("left"));
  launch.addButton({ title: "Down" }).on("click", () => launchCircle("down"));
  launch.addButton({ title: "Up" }).on("click", () => launchCircle("up"));

  const anim = pane.addFolder({ title: "Animations" });
  anim.addBinding(params, "bwMode", { options: { Orbit: "orbit", Walk: "walk" } });

  const orbit = anim.addFolder({ title: "Orbit" });
  orbit.addBinding(params, "orbitRadius", { min: 0, max: 400, step: 1 });
  orbit.addBinding(params, "orbitSpeed", { min: -5, max: 5, step: 0.05 });
  orbit.addBinding(params, "orbitPhase", { min: 0, max: 1, step: 0.01 });
  orbit.addBinding(params, "orbitCircleRadius", { min: 1, max: 100, step: 1 });

  const walk = anim.addFolder({ title: "Walk" });
  walk.addBinding(params, "walkSquareSize", { min: 10, max: 600, step: 1 });
  walk.addBinding(params, "walkMinDur", { min: 0.05, max: 5, step: 0.05 });
  walk.addBinding(params, "walkMaxDur", { min: 0.05, max: 5, step: 0.05 });
  walk.addBinding(params, "walkCircleRadius", { min: 1, max: 100, step: 1 });

  const center = pane.addFolder({ title: "Center Circle" });
  center.addBinding(params, "centerOn");
  center.addBinding(params, "centerRadius", { min: 1, max: 200, step: 1 });
  center.addBinding(params, "centerHue", { min: 0, max: 360, step: 1 });

  const fx = pane.addFolder({ title: "Flood Fill" });
  fx.addBinding(params, "alphaThreshold", { min: 0, max: 1, step: 0.01 });
  fx.addBinding(params, "useDisk");
  fx.addBinding(params, "diskRadius", { min: 1, max: 10, step: 1 });
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
