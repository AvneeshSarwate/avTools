/// <reference lib="dom" />

/**
 * Three-window Three.js + Syphon multi-view test (single process).
 * Uses one shared logical coordinator loop via @avtools/core-timing `launch()`.
 *
 * Run with (from apps/deno-notebooks):
 * deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/three_test_syphon_tripple.ts --sync=none
 *
 * Produces three Syphon sources:
 * - ThreeSyphonRed
 * - ThreeSyphonGreen
 * - ThreeSyphonBlue
 *
 * Sync modes:
 * --sync=none (default): publish immediately after render()
 * --sync=wait: await device.queue.onSubmittedWorkDone() before publish()
 *
 * Orientation:
 * --flip-y / --no-flip-y
 * SYPHON_FLIP_Y=1
 *
 * Coordination:
 * - Animation system: realtime `launch()` loop updates only logical animation state
 * - Render system: separate boilerplate loop handles window events + render/publish/present
 * - Exactly one cube spins at a time, and every 1 second a different cube is selected
 */

// Shim globals BEFORE any Three.js import.
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}
if (typeof g.document === "undefined") {
  g.document = {
    createElementNS(_ns: string, tag: string) {
      throw new Error(`Unexpected DOM element creation: ${tag}`);
    },
  };
}

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { createSyphonGpuWindow } from "../syphon/mod.ts";
import { launch } from "@avtools/core-timing";

const WIDTH = 512;
const HEIGHT = 512;
const TARGET_SURFACE_FORMAT: GPUTextureFormat = "rgba16float";
type SyncMode = "none" | "wait";

interface ViewSpec {
  id: string;
  title: string;
  serverName: string;
  color: number;
  rotX: number;
  rotY: number;
}

const VIEW_SPECS: ViewSpec[] = [
  {
    id: "red",
    title: "Three.js Red + Syphon",
    serverName: "ThreeSyphonRed",
    color: 0xff4040,
    rotX: 1.2,
    rotY: 0.9,
  },
  {
    id: "green",
    title: "Three.js Green + Syphon",
    serverName: "ThreeSyphonGreen",
    color: 0x40ff40,
    rotX: 1.0,
    rotY: 1.15,
  },
  {
    id: "blue",
    title: "Three.js Blue + Syphon",
    serverName: "ThreeSyphonBlue",
    color: 0x4080ff,
    rotX: 0.85,
    rotY: 1.3,
  },
];

function getSyncMode(): SyncMode {
  const arg = Deno.args.find((a) => a.startsWith("--sync="));
  const fromArg = arg ? arg.slice("--sync=".length) : "";
  const raw = (fromArg || Deno.env.get("SYPHON_SYNC_MODE") || "none").toLowerCase();
  if (raw === "wait") return "wait";
  return "none";
}

function getFlipY(): boolean {
  let fromArgs: boolean | undefined;
  for (const arg of Deno.args) {
    if (arg === "--flip-y") fromArgs = true;
    if (arg === "--no-flip-y") fromArgs = false;
  }
  if (fromArgs !== undefined) {
    return fromArgs;
  }
  const raw = (Deno.env.get("SYPHON_FLIP_Y") || "").trim().toLowerCase();
  return !!raw && raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

class CanvasShim {
  width: number;
  height: number;
  style: { width: string; height: string };
  #ctx: GPUCanvasContext;

  constructor(w: number, h: number, ctx: GPUCanvasContext) {
    this.width = w;
    this.height = h;
    this.#ctx = ctx;
    this.style = { width: `${w}px`, height: `${h}px` };
  }

  getContext(type: string) {
    if (type === "webgpu") return this.#ctx;
    throw new Error(`Unsupported context: ${type}`);
  }

  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
}

type SyphonGpuWindow = Awaited<ReturnType<typeof createSyphonGpuWindow>>;

interface ViewRuntime {
  spec: ViewSpec;
  win: SyphonGpuWindow;
  canvas: CanvasShim;
  renderer: import("npm:three/webgpu").WebGPURenderer;
  scene: import("npm:three").Scene;
  camera: import("npm:three").PerspectiveCamera;
  cube: import("npm:three").Mesh;
  renderWidth: number;
  renderHeight: number;
  running: boolean;
  frame: number;
  fpsStartMs: number;
  syncWaitTotalMs: number;
  syncWaitSamples: number;
}

const SYNC_MODE = getSyncMode();
const FLIP_Y = getFlipY();

const device = await requestWebGpuDevice();
device.addEventListener("uncapturederror", (event: Event) => {
  // deno-lint-ignore no-explicit-any
  const gpuError = (event as any).error;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  }
});

const THREE = await import("npm:three");
const { WebGPURenderer } = await import("npm:three/webgpu");

function configureSurface(
  win: SyphonGpuWindow,
): { format: GPUTextureFormat; alphaMode: string } {
  const alphaCandidates = [
    { raw: "postmultiplied", typed: "postmultiplied" as unknown as GPUCanvasAlphaMode },
    { raw: "opaque", typed: "opaque" as GPUCanvasAlphaMode },
  ];
  const formatCandidates: GPUTextureFormat[] = TARGET_SURFACE_FORMAT === win.format
    ? [win.format]
    : [TARGET_SURFACE_FORMAT, win.format];

  let lastErr: unknown = null;
  for (const format of formatCandidates) {
    for (const alpha of alphaCandidates) {
      try {
        win.ctx.configure({
          device,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          alphaMode: alpha.typed,
        });
        return { format, alphaMode: alpha.raw };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  throw lastErr ?? new Error("Failed to configure surface");
}

async function createView(spec: ViewSpec): Promise<ViewRuntime> {
  const win = await createSyphonGpuWindow(device, {
    width: WIDTH,
    height: HEIGHT,
    title: spec.title,
    syphon: {
      serverName: spec.serverName,
      flipY: FLIP_Y,
    },
  });
  const configured = configureSurface(win);

  let renderWidth = win.width;
  let renderHeight = win.height;
  const canvas = new CanvasShim(renderWidth, renderHeight, win.ctx);

  // deno-lint-ignore no-explicit-any
  const renderer = new WebGPURenderer({ canvas: canvas as any, device, antialias: false, alpha: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(renderWidth, renderHeight, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(70, renderWidth / renderHeight, 0.1, 100);
  camera.position.z = 3;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: spec.color });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(2, 3, 4);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  const now = performance.now();
  console.log(
    `[${spec.id}] windowFormat=${win.format} configuredFormat=${configured.format} alphaMode=${configured.alphaMode} syphon=${win.syphon.name}`,
  );

  return {
    spec,
    win,
    canvas,
    renderer,
    scene,
    camera,
    cube,
    renderWidth,
    renderHeight,
    running: true,
    frame: 0,
    fpsStartMs: now,
    syncWaitTotalMs: 0,
    syncWaitSamples: 0,
  };
}

async function maybeSyncWait(view: ViewRuntime) {
  if (SYNC_MODE !== "wait") return;
  const t0 = performance.now();
  await device.queue.onSubmittedWorkDone();
  view.syncWaitTotalMs += performance.now() - t0;
  view.syncWaitSamples += 1;
}

function getRunningIndices(views: ViewRuntime[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < views.length; i++) {
    if (views[i].running && !views[i].win.closed) {
      out.push(i);
    }
  }
  return out;
}

function pickDifferentIndex(
  current: number,
  candidates: number[],
  random01: number,
): number {
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  const pool = candidates.filter((idx) => idx !== current);
  const source = pool.length > 0 ? pool : candidates;
  const r = Math.max(0, Math.min(0.999999, random01));
  const nextPos = Math.floor(r * source.length);
  return source[nextPos];
}

interface AnimationState {
  spinnerIndex: number;
  rotationX: number[];
  rotationY: number[];
}

function createAnimationState(viewCount: number): AnimationState {
  return {
    spinnerIndex: -1,
    rotationX: new Array(viewCount).fill(0),
    rotationY: new Array(viewCount).fill(0),
  };
}

function runAnimationSystem(
  views: ViewRuntime[],
  state: AnimationState,
) {
  return launch(async (ctx) => {
    const frameStepSec = 1 / 60;
    let spinnerIndex = pickDifferentIndex(-1, getRunningIndices(views), ctx.random());
    state.spinnerIndex = spinnerIndex;
    if (spinnerIndex >= 0) {
      console.log(`[animation] initial spinner=${views[spinnerIndex].spec.id}`);
    }
    console.log("[animation] launch mode=realtime rate=1");

    const selectorTask = ctx.branchWait(async (selectorCtx) => {
      while (true) {
        await selectorCtx.waitSec(1);
        const running = getRunningIndices(views);
        if (running.length === 0) {
          break;
        }
        const nextIndex = pickDifferentIndex(spinnerIndex, running, selectorCtx.random());
        if (nextIndex !== spinnerIndex) {
          spinnerIndex = nextIndex;
          state.spinnerIndex = spinnerIndex;
          console.log(
            `[animation] t=${selectorCtx.time.toFixed(2)}s spinner=${views[spinnerIndex].spec.id}`,
          );
        }
      }
    }, "spinner-selector");

    try {
      let prevLogicalTime = ctx.time;
      while (true) {
        const runningNow = getRunningIndices(views);
        if (runningNow.length === 0) {
          break;
        }

        if (!runningNow.includes(spinnerIndex)) {
          spinnerIndex = pickDifferentIndex(spinnerIndex, runningNow, ctx.random());
          state.spinnerIndex = spinnerIndex;
          if (spinnerIndex >= 0) {
            console.log(
              `[animation] t=${ctx.time.toFixed(2)}s spinner=${views[spinnerIndex].spec.id} (reassigned)`,
            );
          }
        }

        const logicalNow = ctx.time;
        const dt = Math.max(0, logicalNow - prevLogicalTime);
        prevLogicalTime = logicalNow;

        if (spinnerIndex >= 0) {
          state.rotationX[spinnerIndex] += dt * views[spinnerIndex].spec.rotX;
          state.rotationY[spinnerIndex] += dt * views[spinnerIndex].spec.rotY;
        }

        await ctx.waitSec(frameStepSec);
      }
    } finally {
      selectorTask.cancel();
    }
  }, {
    rate: 1,
    debugName: "three_syphon_tripple_animation",
  });
}

async function runRenderSystem(
  views: ViewRuntime[],
  state: AnimationState,
) {
  while (true) {
    let active = 0;
    for (let i = 0; i < views.length; i++) {
      const view = views[i];
      if (!view.running) continue;
      active += 1;

      const events = view.win.pollEvents();
      for (const ev of events) {
        if (ev.type === "close") {
          view.running = false;
        } else if (ev.type === "resize") {
          view.renderWidth = ev.width;
          view.renderHeight = ev.height;
          view.canvas.width = view.renderWidth;
          view.canvas.height = view.renderHeight;
          view.canvas.style.width = `${view.renderWidth}px`;
          view.canvas.style.height = `${view.renderHeight}px`;
          view.renderer.setSize(view.renderWidth, view.renderHeight, false);
          view.camera.aspect = view.renderWidth / view.renderHeight;
          view.camera.updateProjectionMatrix();
        }
      }

      if (!view.running || view.win.closed) {
        view.running = false;
        continue;
      }

      // Apply logical animation state from the separate launch() animation system.
      view.cube.rotation.x = state.rotationX[i];
      view.cube.rotation.y = state.rotationY[i];

      view.renderer.render(view.scene, view.camera);
      await maybeSyncWait(view);
      view.win.syphon.publishFrame();

      try {
        view.win.present();
      } catch (err) {
        console.error(`[${view.spec.id}] present error:`, err);
        view.running = false;
      }

      if (view.frame % 120 === 0) {
        console.log(
          `[${view.spec.id}] frame=${view.frame} spinning=${i === state.spinnerIndex} hasClients=${view.win.syphon.hasClients} intercepts=${view.win.syphon.interceptCount.toString()}`,
        );
      }

      view.frame += 1;
      if (view.frame % 60 === 0) {
        const elapsedSec = (performance.now() - view.fpsStartMs) / 1000;
        const avgFps = elapsedSec > 0 ? view.frame / elapsedSec : 0;
        const syncWaitAvgMs = view.syncWaitSamples > 0
          ? view.syncWaitTotalMs / view.syncWaitSamples
          : 0;
        const syncWaitText = SYNC_MODE === "wait" ? syncWaitAvgMs.toFixed(3) : "n/a";
        console.log(
          `[${view.spec.id}] fps_avg=${avgFps.toFixed(1)} sync=${SYNC_MODE} wait_avg_ms=${syncWaitText}`,
        );
      }
    }

    if (active === 0) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const views: ViewRuntime[] = [];
try {
  for (const spec of VIEW_SPECS) {
    views.push(await createView(spec));
  }
  console.log(`Created ${views.length} windows. sync=${SYNC_MODE} flipY=${FLIP_Y}`);
  const animationState = createAnimationState(views.length);
  const animationTask = runAnimationSystem(views, animationState);
  try {
    await runRenderSystem(views, animationState);
  } finally {
    animationTask.cancel();
    await animationTask.catch(() => undefined);
  }
} finally {
  for (const view of views) {
    try {
      view.renderer.dispose();
    } catch {
      // best-effort cleanup
    }
    try {
      view.win.close();
    } catch {
      // best-effort cleanup
    }
  }
  device.destroy();
}

console.log("All windows closed.");
