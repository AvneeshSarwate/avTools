import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

const palette = [
  [235, 90, 140],
  [80, 230, 170],
  [250, 210, 90],
  [105, 170, 255],
] as const;

export default async function (ctx: TimeContext) {
  let index = 0;
  while (true) {
    state.color = [...palette[index % palette.length]];
    state.speed = 0.8 + ctx.random() * 3.2;
    index += 1;
    await ctx.waitSec(1);
  }
}
