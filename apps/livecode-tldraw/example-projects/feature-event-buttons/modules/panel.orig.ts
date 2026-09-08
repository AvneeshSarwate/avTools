import type { TimeContext } from "@avtools/core-timing";
import { button, canvasParams } from "canvas-params";
import * as events from "canvas-events";

const params = canvasParams("event-buttons", {
  gain: 0.5,
  presses: 0,
  releases: 0,
  held: false,
  play: button({ type: "trigger", body: { melody: "dscale5" } }),
  alternate: {
    play: button({ type: "trigger", body: { melody: "dscale7" } }),
  },
}, { gain: { min: 0, max: 1 } });

export default async function run(ctx: TimeContext) {
  // The analyzer supplies the owning ctx. Outside livecode, pass ctx explicitly.
  events.onEvent(event => {
    if (event.type !== "trigger") return;
    if (event.body.state === "down") {
      params.presses++;
      params.held = true;
    } else if (event.body.state === "up") {
      params.releases++;
      params.held = false;
    }
  });
  while (true) await ctx.waitSec(0.02);
}
