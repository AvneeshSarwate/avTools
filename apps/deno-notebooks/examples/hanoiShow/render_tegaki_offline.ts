/// <reference lib="dom" />

// Headless render of the tegaki scene (the handwritten Thai text that warps
// onto a lissajous/circle path) to a video file, driven by param snapshots
// you curate in the live show.
//
// ── Workflow ──────────────────────────────────────────────────────────
// All commands run from apps/deno-notebooks.
//
// 0. Prereqs
//    - Deno 2.8.3: `deno upgrade --version 2.8.3`. Deno 2.9.x panics when the
//      live show opens its window on Apple Silicon (see "Deno version pin" in
//      the repo README). This render is headless and runs on any version.
//    - Native libs built (./setup.sh at the repo root) and ffmpeg on PATH
//      (`brew install ffmpeg`).
//
// 1. Start the original live scene
//      deno run --unstable-webgpu --unstable-ffi --allow-all \
//        examples/hanoiShow/combined_landscape.ts
//    This opens the monitor window, the main control pane, and a "Perf"
//    pane. To see tegaki alone, untick the other scenes under
//    Global → Scenes in the main pane.
//
// 2. Shape a look
//    - Main pane → "Tegaki" tab has every setting: Path Morph (Morph, Mode,
//      Center, Uniform width), Circle radius, Lissajous (Amp, Freq, Phase,
//      Free-run, Speed), Width x, trigger rate/duration, Pause triggers.
//    - Perf pane → "Tegaki" tab has the big macro sliders: Scene Fade,
//      Width x, Morph, Speed X/Y, Amp X/Y, Pause triggers, Run install. An
//      attached LPD8/Push 2 drives the perf pane's sliders with its knobs.
//    - Turn "Run install" OFF while curating. It randomly moves the sliders,
//      and the render ignores it anyway.
//    - Speed X/Y keep the path moving even while a snapshot is held; with
//      both at 0 the path is still.
//
// 3. Save snapshots
//    Click "Save snapshot" (near the bottom of the main pane's Tegaki tab)
//    for each look. Each click appends every tegaki param as one JSON line to
//      examples/hanoiShow/snapshots/tegaki_<show start time>.jsonl
//    and the terminal prints the path. Each show run gets its own file.
//    Lines can be reordered, deleted, or copied between files by hand.
//
// 4. Render
//      deno run --unstable-webgpu --unstable-ffi --allow-all \
//        examples/hanoiShow/render_tegaki_offline.ts \
//        --snapshots examples/hanoiShow/snapshots/<file>.jsonl \
//        --shuffle --ramp 3-8 --hold 60
//    That is one shuffled pass: each snapshot held 60s, with a random 3–8s
//    ease between them. The schedule is printed at start. Output goes to
//    .output/ as ProRes 4444 with alpha (transparent background, as the
//    scene ships over Syphon in the show).
//    - Alternate videos: change --seed (order and ease times), --hold,
//      --ramp, or --duration (longer renders keep cycling through passes).
//      The same flags and seed give an identical video.
//    - Speed: about 1.2x realtime; ProRes 4444 is about 1 GB per minute.
//    - Without --snapshots, the scene's own "Run install" loop picks random
//      targets instead.
//
// ── How it works ──────────────────────────────────────────────────────
// Time comes from core-timing's OfflineRunner instead of the wall clock: each
// output frame steps logical time by exactly 1/fps, so the animation (glyph
// re-draw triggers, ramps, snapshot eases, free-running path phase) is the
// same however fast frames render. Snapshot eases are smoothstep: numbers
// and #rrggbb colors interpolate, while booleans and strings (e.g. Mode)
// switch at the start of the ease (see tegaki_snapshots.ts). Frames are read
// back from the P5GPU offscreen as RGBA and piped to ffmpeg. No window,
// Syphon, OSC, or camera input is involved.
//
// Flags:
//   --snapshots <path>  .jsonl of param snapshots, one per line
//   --ramp <sec|min-max> snapshot-to-snapshot ease time; a range like 3-8
//                       samples per transition (default 5)
//   --hold <sec|min-max> time each snapshot is held (default 20)
//   --shuffle           seeded random order (reshuffled each pass, no
//                       back-to-back repeats); default is file order
//   --out <path>        output file (default .output/tegaki_<seed>_<dur>s.mov)
//   --duration <sec>    length in seconds (default: one pass through the
//                       snapshots, else 30). Longer renders keep cycling.
//   --fps <n>           frame rate (default 60)
//   --width/--height    canvas size (default 1920x1080; the scene's path
//                       center/amplitudes assume 1920x1080)
//   --seed <s>          RNG seed for the timing context (default "tegaki")
//   --codec <c>         prores (default) | h264 (libx264 crf 16)
//   --opaque            draw the scene's bgColor instead of a transparent
//                       background. Default output is ProRes 4444 with
//                       alpha (as the scene ships over Syphon in the show);
//                       with --opaque, ProRes 422 HQ. h264 is always opaque.
//   --params <json>     merged into the scene's state.params before setup
//                       (snapshots layer on top), e.g. '{"installWaitSec":10}'

import { OfflineRunner } from "@avtools/core-timing";
import { P5GPU } from "../../tools/p5gpu.ts";
import { requestWebGpuDevice } from "../../window/mod.ts";
import { draw, setup, state } from "./p5gpu_tegaki_handwriting.ts";
import {
  buildSchedule,
  type Params,
  paramsAt,
  readSnapshots,
  scheduleDuration,
  type Span,
} from "./tegaki_snapshots.ts";

// ── Args ────────────────────────────────────────────────────────────

function parseFlags(argv: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      i++;
    }
  }
  return flags;
}

const flags = parseFlags(Deno.args);
const str = (key: string, fallback: string) => {
  const v = flags.get(key);
  return typeof v === "string" ? v : fallback;
};
const num = (key: string, fallback: number) => {
  const v = flags.get(key);
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number`);
  return n;
};

const paramOverrides = flags.has("params")
  ? JSON.parse(str("params", "{}")) as Record<string, unknown>
  : {};
for (const key of Object.keys(paramOverrides)) {
  if (!(key in state.params)) throw new Error(`Unknown scene param: ${key}`);
}
state.params.runInstall = true;
Object.assign(state.params, paramOverrides);

/** "5" -> 5, "3-8" -> [3, 8]. */
function span(key: string, fallback: Span): Span {
  const v = flags.get(key);
  if (typeof v !== "string") return fallback;
  const parts = v.split("-").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 2) {
    throw new Error(`--${key} must be seconds or a min-max range, got ${v}`);
  }
  return parts.length === 2 ? [parts[0]!, parts[1]!] : parts[0]!;
}

const SEED = str("seed", "tegaki");
const SNAPSHOT_PATH = flags.has("snapshots") ? str("snapshots", "") : null;
const RAMP = span("ramp", 5);
const HOLD = span("hold", 20);
const SHUFFLE = flags.get("shuffle") === true;
const baseParams = { ...state.params } as Params;
const snapshots = SNAPSHOT_PATH
  ? await readSnapshots(SNAPSHOT_PATH, baseParams)
  : null;
const schedule = snapshots
  ? buildSchedule({
    count: snapshots.length,
    ramp: RAMP,
    hold: HOLD,
    shuffle: SHUFFLE,
    seed: `${SEED}:snapshots`,
    duration: flags.has("duration") ? num("duration", 0) : undefined,
  })
  : null;

/** Applies the snapshot timeline at render time `t` (no-op without snapshots). */
function applySnapshotsAt(t: number): void {
  if (!snapshots || !schedule) return;
  Object.assign(state.params, paramsAt(snapshots, schedule, baseParams, t));
  state.params.runInstall = false;
}

const WIDTH = num("width", 1920);
const HEIGHT = num("height", 1080);
const FPS = num("fps", 60);
const DURATION = num("duration", schedule ? scheduleDuration(schedule) : 30);
const CODEC = str("codec", "prores");
const ALPHA = CODEC === "prores" && flags.get("opaque") !== true;
const OUT = str(
  "out",
  `.output/tegaki_${SEED}_${DURATION}s.${CODEC === "h264" ? "mp4" : "mov"}`,
);
const TOTAL_FRAMES = Math.round(DURATION * FPS);

if (CODEC !== "prores" && CODEC !== "h264") {
  throw new Error(`--codec must be prores or h264, got ${CODEC}`);
}
// ── ffmpeg ──────────────────────────────────────────────────────────

const encodeArgs = CODEC === "h264"
  ? ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p"]
  : ALPHA
  ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]
  : ["-c:v", "prores_ks", "-profile:v", "hq", "-pix_fmt", "yuv422p10le"];

await Deno.mkdir(OUT.split("/").slice(0, -1).join("/") || ".", {
  recursive: true,
});

const ffmpeg = new Deno.Command("ffmpeg", {
  args: [
    "-hide_banner",
    "-loglevel", "warning",
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${WIDTH}x${HEIGHT}`,
    "-r", String(FPS),
    "-i", "-",
    // P5GPU blends to premultiplied alpha; ProRes 4444 stores straight alpha.
    ...(ALPHA ? ["-vf", "unpremultiply=inplace=1"] : []),
    ...encodeArgs,
    OUT,
  ],
  stdin: "piped",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
const ffmpegIn = ffmpeg.stdin.getWriter();

// ── GPU ─────────────────────────────────────────────────────────────

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

// rgba8unorm rows padded to WebGPU's 256-byte copy alignment.
const unpaddedBytesPerRow = WIDTH * 4;
const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
const frameBytes = new Uint8Array(unpaddedBytesPerRow * HEIGHT);

// Readback is pipelined over a ring of staging buffers: frame N's copy is
// queued and mapped while later frames render, and we only wait on the map
// READBACK_DEPTH - 1 frames later. Waiting on each frame's map directly is
// ~15 ms/frame of GPU round-trip latency.
const READBACK_DEPTH = 4;
const readSlots = Array.from({ length: READBACK_DEPTH }, () => ({
  buffer: device.createBuffer({
    size: bytesPerRow * HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  }),
  mapped: null as Promise<void> | null,
}));

function queueReadback(texture: GPUTexture, frame: number): void {
  const slot = readSlots[frame % READBACK_DEPTH]!;
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: slot.buffer, bytesPerRow, rowsPerImage: HEIGHT },
    { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  slot.mapped = slot.buffer.mapAsync(GPUMapMode.READ);
}

async function collectReadback(frame: number): Promise<Uint8Array> {
  const slot = readSlots[frame % READBACK_DEPTH]!;
  await slot.mapped;
  slot.mapped = null;
  const mapped = new Uint8Array(slot.buffer.getMappedRange());
  if (bytesPerRow === unpaddedBytesPerRow) {
    frameBytes.set(mapped);
  } else {
    for (let y = 0; y < HEIGHT; y++) {
      frameBytes.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + unpaddedBytesPerRow),
        y * unpaddedBytesPerRow,
      );
    }
  }
  slot.buffer.unmap();
  return frameBytes;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Render ──────────────────────────────────────────────────────────

let runner: OfflineRunner<void> | null = null;
applySnapshotsAt(0);
await setup({ width: WIDTH, height: HEIGHT }, {
  launch: (block) => {
    runner = new OfflineRunner(block, { fps: FPS, seed: SEED });
    return runner.promise;
  },
});
const offline = runner as OfflineRunner<void> | null;
if (!offline) throw new Error("setup() did not launch the timing context");

console.log(
  `Rendering ${TOTAL_FRAMES} frames (${DURATION}s @ ${FPS}fps, ` +
    `${WIDTH}x${HEIGHT}, ${CODEC}${ALPHA ? " 4444 alpha" : ""}, seed "${SEED}") -> ${OUT}`,
);
if (snapshots && schedule) {
  const fmt = (x: Span) => typeof x === "number" ? `${x}s` : `${x[0]}-${x[1]}s`;
  console.log(
    `  ${snapshots.length} snapshots from ${SNAPSHOT_PATH} ` +
      `(${SHUFFLE ? "shuffled" : "file order"}, ramp ${fmt(RAMP)}, hold ${fmt(HOLD)})`,
  );
  let t = 0;
  for (const seg of schedule) {
    if (t >= DURATION) break;
    console.log(
      `    ${t.toFixed(1).padStart(6)}s  -> snapshot ${seg.snapshot}` +
        `  ramp ${seg.ramp.toFixed(1)}s  hold ${seg.hold.toFixed(1)}s`,
    );
    t += seg.ramp + seg.hold;
  }
}

const wallStart = performance.now();
let lastLog = wallStart;
// Wall ms spent per stage, for the progress log.
const stageMs = { draw: 0, readback: 0, encode: 0, step: 0 };
for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
  const renderTimeMs = (frame / FPS) * 1000;

  let t0 = performance.now();
  applySnapshotsAt(renderTimeMs / 1000);
  p5.beginFrame();
  if (ALPHA) {
    p5.clear();
  } else {
    const [r, g, b] = hexToRgb(state.params.bgColor);
    p5.background(r, g, b);
  }
  draw(p5, false, renderTimeMs);
  const texture = p5.endFrame();
  let t1 = performance.now();
  stageMs.draw += t1 - t0;

  queueReadback(texture, frame);
  const readyFrame = frame - (READBACK_DEPTH - 1);
  if (readyFrame >= 0) {
    const pixels = await collectReadback(readyFrame);
    t0 = performance.now();
    stageMs.readback += t0 - t1;

    // Blocks when ffmpeg's pipe is full, so this is effectively encode time.
    await ffmpegIn.write(pixels);
    t1 = performance.now();
    stageMs.encode += t1 - t0;
  }

  // Advance logical time to the next frame: runs every wait due in
  // (t, t + 1/fps] — trigger loop, ramps, install loop — then frame waiters.
  await offline.stepFrame();
  const now = performance.now();
  stageMs.step += now - t1;

  if (now - lastLog > 2000 || frame === TOTAL_FRAMES - 1) {
    lastLog = now;
    const done = frame + 1;
    const speed = (done / FPS) / ((now - wallStart) / 1000);
    const perFrame = (ms: number) => (ms / done).toFixed(1);
    console.log(
      `  ${done}/${TOTAL_FRAMES} frames · ${speed.toFixed(2)}x realtime · ` +
        `ms/frame draw ${perFrame(stageMs.draw)} readback ${perFrame(stageMs.readback)} ` +
        `encode ${perFrame(stageMs.encode)} step ${perFrame(stageMs.step)}`,
    );
  }
}

// Drain frames still in flight in the readback ring.
for (
  let frame = Math.max(0, TOTAL_FRAMES - (READBACK_DEPTH - 1));
  frame < TOTAL_FRAMES;
  frame++
) {
  await ffmpegIn.write(await collectReadback(frame));
}
await ffmpegIn.close();
const { code } = await ffmpeg.status;
for (const slot of readSlots) slot.buffer.destroy();
p5.dispose();

const wallSec = (performance.now() - wallStart) / 1000;
if (code !== 0) {
  console.error(`ffmpeg exited with code ${code}`);
  Deno.exit(code);
}
console.log(
  `Done: ${OUT} (${DURATION}s of video in ${wallSec.toFixed(1)}s, ` +
    `${(DURATION / wallSec).toFixed(2)}x realtime)`,
);
Deno.exit(0);
