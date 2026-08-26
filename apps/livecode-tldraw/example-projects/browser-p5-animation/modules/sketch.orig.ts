import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { circle } from "./state.ts";

/**
 * p5 in instance mode, drawing into the engine tab's `#livecode-stage`
 * container. p5 owns the frame loop (its own requestAnimationFrame); this
 * module only stays alive so Stop/Replace can dispose the sketch. Look at
 * the ENGINE tab for the canvas — the tldraw canvas only holds the code.
 */
const WIDTH = 480;
const HEIGHT = 360;

let instance: p5 | null = null;

export function stop() {
  instance?.remove();
  instance = null;
}

export default async function (ctx: TimeContext) {
  stop();
  const stage = document.getElementById("livecode-stage");
  if (!stage) {
    throw new Error(
      "#livecode-stage not found — open this project with the engine in a browser tab",
    );
  }
  instance = new p5((sketch: p5) => {
    sketch.setup = () => {
      sketch.createCanvas(WIDTH, HEIGHT);
    };
    sketch.draw = () => {
      sketch.background(18, 22, 34);
      sketch.noStroke();
      sketch.fill(120, 200, 255);
      sketch.circle(circle.x * WIDTH, circle.y * HEIGHT, 48);
    };
  }, stage);
  try {
    // Idle cancellably forever; the p5 instance does the per-frame work.
    while (true) await ctx.waitSec(3600);
  } finally {
    stop();
  }
}
