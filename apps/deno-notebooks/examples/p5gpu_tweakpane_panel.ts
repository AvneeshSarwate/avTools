/// <reference lib="dom" />

// P5GPU sketch with a tweakpane control panel in a separate window.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/p5gpu_tweakpane_panel.ts

import { P5GPU } from "../tools/p5gpu.ts";
import { createBlitPipeline, blit, createGpuWindow, createWindowTweakpane } from "../window/mod.ts";
import { createSyphonGpuWindow } from "../syphon/mod.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const MAX_FRAMES = Number(Deno.env.get("P5_MAX_FRAMES") ?? 60000);
const AUTOCHECK = Deno.env.get("P5_TWEAKPANE_AUTOCHECK") === "1";
const READY_TIMEOUT_MS = Number(Deno.env.get("P5_TWEAKPANE_TIMEOUT_MS") ?? 8000);
const EXPECTED_BINDINGS = 5;

type ExampleWindow =
  | Awaited<ReturnType<typeof createGpuWindow>>
  | Awaited<ReturnType<typeof createSyphonGpuWindow>>;

function hasSyphon(window: ExampleWindow): window is Awaited<ReturnType<typeof createSyphonGpuWindow>> {
  return "syphon" in window;
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No WebGPU adapter");
const device = await adapter.requestDevice();

let win: ExampleWindow | null = null;
let panel: ReturnType<typeof createWindowTweakpane>["panel"] | null = null;
let pane: ReturnType<typeof createWindowTweakpane>["pane"] | null = null;
let p5: P5GPU | null = null;

try {
  // ─── GPU + window ──────────────────────────────────────────────────────

  win = AUTOCHECK
    ? await createGpuWindow(device, {
      width: WIDTH,
      height: HEIGHT,
      title: "P5GPU + Tweakpane",
    })
    : await createSyphonGpuWindow(device, {
      width: WIDTH,
      height: HEIGHT,
      title: "P5GPU + Tweakpane",
      syphon: { serverName: "P5GPU_Panel_Demo", flipY: true },
    });

  const blitPipeline = createBlitPipeline(device, win.format);

  // ─── Tweakpane (separate window) ───────────────────────────────────────

  const params = {
    speed: 2.0,
    radius: 200,
    count: 12,
    hue: 180,
    bgAlpha: 20,
  };

  ({ pane, panel } = createWindowTweakpane(win, { title: "Circle Demo" }));

  pane.addBinding(params, "speed", { min: 0.1, max: 10, step: 0.1 });
  pane.addBinding(params, "radius", { min: 50, max: 400, step: 1 });
  pane.addBinding(params, "count", { min: 3, max: 36, step: 1 });
  pane.addBinding(params, "hue", { min: 0, max: 360, step: 1 });
  pane.addBinding(params, "bgAlpha", { min: 0, max: 255, step: 1 });

  pane.addButton({ title: "Randomize" }).on("click", () => {
    params.speed = 0.1 + Math.random() * 9.9;
    params.radius = 50 + Math.random() * 350;
    params.count = 3 + Math.floor(Math.random() * 33);
    params.hue = Math.random() * 360;
    pane?.refresh();
  });

  // ─── P5GPU ─────────────────────────────────────────────────────────────

  p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  // ─── Render loop ───────────────────────────────────────────────────────

  let running = true;
  const readyDeadline = performance.now() + READY_TIMEOUT_MS;

  for (let frame = 0; frame < MAX_FRAMES && running; frame++) {
    const events = win.pollEvents();
    for (const ev of events) {
      if (ev.type === "close") running = false;
      panel.handleEvent(ev);
    }
    if (!running || win.closed) break;

    // Process tweakpane IPC messages (mutates params in place)
    pane.processMessages(panel);

    if (pane.lastError) {
      throw new Error(`Tweakpane panel error [${pane.lastError.stage}]: ${pane.lastError.message}`);
    }

    if (AUTOCHECK && pane.readyInfo) {
      const ready = pane.readyInfo;
      if (ready.bindingCount !== EXPECTED_BINDINGS) {
        throw new Error(
          `Unexpected tweakpane binding count: expected ${EXPECTED_BINDINGS}, got ${ready.bindingCount}`,
        );
      }
      if (ready.title !== "Circle Demo") {
        throw new Error(`Unexpected tweakpane title: ${String(ready.title)}`);
      }
      console.log(
        `[p5gpu_tweakpane_panel] ready title=${ready.title} bindings=${ready.bindingCount} operations=${ready.operationCount}`,
      );
      break;
    }

    if (AUTOCHECK && performance.now() > readyDeadline) {
      throw new Error(`Timed out after ${READY_TIMEOUT_MS}ms waiting for tweakpane panel to become ready`);
    }

    // Draw
    p5.beginFrame();
    p5.background(0, 0, 0, params.bgAlpha);
    p5.noStroke();

    const t = performance.now() * 0.001 * params.speed;
    for (let i = 0; i < params.count; i++) {
      const angle = (i / params.count) * Math.PI * 2 + t;
      const x = WIDTH / 2 + Math.cos(angle) * params.radius;
      const y = HEIGHT / 2 + Math.sin(angle) * params.radius;
      const h = (params.hue + (i / params.count) * 120) % 360;
      const c = hslToRgb(h / 360, 0.8, 0.6);
      p5.fill(c[0], c[1], c[2]);
      p5.circle(x, y, 30 + 20 * Math.sin(t * 2 + i));
    }

    const texture = p5.endFrame();

    try {
      const swapTexture = win.ctx.getCurrentTexture();
      const encoder = device.createCommandEncoder();
      blit(device, encoder, blitPipeline, texture.createView(), swapTexture.createView());
      device.queue.submit([encoder.finish()]);
      if (hasSyphon(win)) {
        win.syphon.publishFrame();
      }
      win.present();
    } catch (e) {
      console.error("Present error:", e);
      break;
    }

    if (AUTOCHECK && pane.ready) {
      break;
    }

    await new Promise((r) => setTimeout(r, 0));
  }

  if (AUTOCHECK) {
    if (!pane.readyInfo) {
      throw new Error("Automation mode ended before tweakpane reported readiness");
    }
    console.log("[p5gpu_tweakpane_panel] automation success");
  }
} finally {
  panel?.destroy();
  p5?.dispose();
  win?.close();
}

// ─── Util ────────────────────────────────────────────────────────────────

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
