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
    await __tcvVisualizedAwait("modules/modifiers/color-loop.ts", "939bc639-5a0a-478d-9b46-521d174b67b8", ctx.waitSec(1));
  }
}

export default runFunc;
