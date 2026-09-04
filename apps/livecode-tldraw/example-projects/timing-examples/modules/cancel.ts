import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "/engine/runtime.js";
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 3. Cancellation cascades through the context tree.
 *
 * The parent keeps a heartbeat running and, every few seconds, spawns a
 * "family": one child branch that itself spawns two grandchild orbits. After
 * `lifetimeSec` the parent calls `family.cancel()` on the handle it got from
 * `branch`. That aborts the child and, recursively, every grandchild: their
 * pending waits reject, their loops end, and the counters prove no tick ever
 * lands after the cancel instant. `handleCancel` runs cleanup exactly once on
 * cancellation (preferred over Promise.finally for cancel-only cleanup). The
 * parent's own heartbeat is untouched: cancellation only flows downward.
 */
const WIDTH = 480;
const HEIGHT = 300;

const params = canvasParams(
  "timing/cancel",
  { running: true, lifetimeSec: 2, gapSec: 1 },
  {
    running: { label: "running" },
    lifetimeSec: { label: "family lifetime (s)", min: 0.5, max: 5, step: 0.1 },
    gapSec: { label: "gap before next (s)", min: 0.2, max: 3, step: 0.1 },
  },
);

interface Sprite {
  angle: number;
  radius: number;
  speed: number;
  color: string;
}

interface State {
  heartbeat: number;
  familyIndex: number;
  familyBornAt: number | null;
  familyCancelledAt: number | null;
  sprites: Sprite[];
  childTicks: number;
  grandTicks: number;
  ticksAtCancel: number | null;
  orphanTicks: number;
  cleanups: number;
}

function freshState(): State {
  return {
    heartbeat: 0,
    familyIndex: 0,
    familyBornAt: null,
    familyCancelledAt: null,
    sprites: [],
    childTicks: 0,
    grandTicks: 0,
    ticksAtCancel: null,
    orphanTicks: 0,
    cleanups: 0,
  };
}

export async function runFunc (ctx: TimeContext) {
  const g = canvasSurface("timing/cancel").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    // The parent's heartbeat: a sibling branch that outlives every family.
    c.branch(async (h) => {
      while (true) {
        state.heartbeat += 1;
        await __tcvVisualizedAwait("timing/cancel", "c1275184-bde0-4c13-8e83-a1d828114326", h.waitSec(0.5));
      }
    }, "heartbeat");

    for (let n = 0;; n++) {
      state.familyIndex = n;
      state.familyBornAt = c.time;
      state.familyCancelledAt = null;
      state.ticksAtCancel = null;
      state.childTicks = 0;
      state.grandTicks = 0;
      state.sprites = [
        { angle: 0, radius: 70, speed: 2.2, color: "#78c8ff" },
        { angle: Math.PI, radius: 40, speed: -3.4, color: "#f2d38b" },
      ];

      const family = c.branch(async (child) => {
        for (const sprite of state.sprites) {
          child.branch(async (grand) => {
            while (true) {
              sprite.angle += sprite.speed / 60;
              state.grandTicks += 1;
              if (state.ticksAtCancel !== null) state.orphanTicks += 1;
              await __tcvVisualizedAwait("timing/cancel", "f7bba638-d6e7-4407-848f-13504f48c9a7", grand.waitSec(1 / 60));
            }
          }, "orbit");
        }
        while (true) {
          state.childTicks += 1;
          if (state.ticksAtCancel !== null) state.orphanTicks += 1;
          await __tcvVisualizedAwait("timing/cancel", "681910f8-1e3f-41d2-b72a-2b7ff96347e2", child.waitSec(0.1));
        }
      }, `family-${n}`);
      family.handleCancel(() => {
        state.cleanups += 1;
        state.sprites = [];
      });

      await __tcvVisualizedAwait("timing/cancel", "c8c71c2b-bfcd-48db-8413-3fe279c82998", c.waitSec(params.lifetimeSec));
      state.ticksAtCancel = state.childTicks + state.grandTicks;
      state.familyCancelledAt = c.time;
      family.cancel();

      await __tcvVisualizedAwait("timing/cancel", "30182b04-5daf-4614-9daf-448b24e66ac6", c.waitSec(params.gapSec));
    }
  };

  while (true) {
    await __tcvVisualizedAwait("timing/cancel", "1629f10c-70f1-404c-b8a5-258d1f4b2b31", ctx.waitSec(1 / 60));
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "cancel-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    draw(g, state, ctx.time, params.running);
  }
}

function draw(
  g: CanvasRenderingContext2D,
  state: State,
  now: number,
  running: boolean,
) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";

  // Parent heartbeat: pulses regardless of what happens to the families.
  const pulse = state.heartbeat % 2 === 0 ? 1 : 0.55;
  g.fillStyle = `rgba(79, 208, 138, ${pulse})`;
  g.fillRect(16, 14, 12, 12);
  g.fillStyle = "#dce5df";
  g.fillText(`parent heartbeat ${state.heartbeat}`, 36, 13);

  const cx = 150;
  const cy = 170;
  g.strokeStyle = "#3a4450";
  g.beginPath();
  g.arc(cx, cy, 4, 0, Math.PI * 2);
  g.stroke();
  for (const sprite of state.sprites) {
    g.fillStyle = sprite.color;
    g.beginPath();
    g.arc(
      cx + Math.cos(sprite.angle) * sprite.radius,
      cy + Math.sin(sprite.angle) * sprite.radius,
      8,
      0,
      Math.PI * 2,
    );
    g.fill();
  }

  g.fillStyle = "#9ca8a2";
  const x = 280;
  let y = 60;
  const line = (text: string, color = "#9ca8a2") => {
    g.fillStyle = color;
    g.fillText(text, x, y);
    y += 20;
  };
  if (!running) {
    line("paused (running = false)");
    return;
  }
  line(`family #${state.familyIndex}`, "#dce5df");
  if (state.familyBornAt !== null && state.familyCancelledAt === null) {
    line(`alive ${(now - state.familyBornAt).toFixed(1)} s`, "#78c8ff");
    line(`child ticks ${state.childTicks}`);
    line(`grandchild ticks ${state.grandTicks}`);
  } else if (state.familyCancelledAt !== null) {
    line(`cancelled ${(now - state.familyCancelledAt).toFixed(1)} s ago`, "#ff9a6a");
    line(`ticks at cancel ${state.ticksAtCancel}`);
    line(
      `ticks after cancel ${state.orphanTicks}`,
      state.orphanTicks === 0 ? "#4fd08a" : "#ff6a6a",
    );
  }
  line(`handleCancel ran ${state.cleanups}×`);
}

export default runFunc;
