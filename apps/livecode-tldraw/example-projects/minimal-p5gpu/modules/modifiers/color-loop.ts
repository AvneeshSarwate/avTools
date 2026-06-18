import { visualizedAwait as __tcvVisualizedAwait } from "file:///Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/livecode/visualizer/runtime.ts";
import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

const palette = [
  [235, 90, 140],
  [80, 230, 170],
  [250, 210, 90],
  [105, 170, 255],
] as const;

export async function runFunc (ctx: TimeContext) {
  let index = 0;
  while (true) {
    state.color = [...palette[index % palette.length]];
    state.speed = 0.8 + ctx.random() * 3.2;
    index += 1;
    await __tcvVisualizedAwait("modules/modifiers/color-loop.ts", "ba3f8851-e869-43b4-9995-7e47ddea4613", ctx.waitSec(1));
  }
}

export default runFunc;
