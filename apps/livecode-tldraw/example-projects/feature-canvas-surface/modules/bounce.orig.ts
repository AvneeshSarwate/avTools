import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * Plain Canvas 2D into a named surface. The `canvas: canvas-surface/bounce`
 * view on the tldraw canvas mirrors this canvas every frame when the engine
 * runs in the same tab (the single-page bake). Nothing here knows about the
 * view: the module draws into its own canvas and stops there.
 *
 * `running` is the example's start/stop: a bake auto-launches every module
 * once and cannot relaunch them, so each example owns an independent module
 * and a params toggle the loop honors. Pausing keeps the last frame.
 */
const WIDTH = 480;
const HEIGHT = 300;

const params = canvasParams(
  "canvas-surface/bounce",
  { running: true, speed: 1, radius: 24 },
  {
    running: { label: "running" },
    speed: { label: "speed", min: 0, max: 4, step: 0.1 },
    radius: { label: "radius", min: 4, max: 80, step: 1 },
  },
);

export default async function (ctx: TimeContext) {
  const canvas = canvasSurface("canvas-surface/bounce").createCanvas(
    WIDTH,
    HEIGHT,
  );
  const g = canvas.getContext("2d")!;
  let phase = 0;
  let last = ctx.time;
  while (true) {
    await ctx.waitSec(1 / 60);
    const now = ctx.time;
    const dt = now - last;
    last = now;
    if (!params.running) continue;
    phase += dt * params.speed;
    const x = WIDTH / 2 + Math.sin(phase * 2) * (WIDTH / 2 - params.radius - 8);
    const y = HEIGHT / 2 + Math.cos(phase * 3) * (HEIGHT / 2 - params.radius - 8);
    g.fillStyle = "#12161f";
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle = "#78c8ff";
    g.beginPath();
    g.arc(x, y, params.radius, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#9ca8a2";
    g.font = "12px ui-monospace, monospace";
    g.fillText(`t=${now.toFixed(2)}s`, 10, HEIGHT - 12);
  }
}
