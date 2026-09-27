import type { TimeContext } from "@avtools/core-timing";
import { button, canvasParams } from "canvas-params";
import * as events from "canvas-events";
import * as ui from "ui-events";

// Two target panes to move between, and a panel whose buttons ask the engine
// to move the camera. The round trip is deliberate: the button is UI input
// (`canvas-events`), and the camera move is the engine telling the UI to do
// something (`ui-events`). In a real piece the send would come from a MIDI
// handler or a musical process instead of a button.
canvasParams("ui-events/left", { level: 0.25 });
canvasParams("ui-events/right", { level: 0.75 });

const panel = canvasParams("ui-events", {
  focusLeft: button({
    type: "ui-events/focus",
    body: { target: "ui-events/left" },
  }),
  focusRight: button({
    type: "ui-events/focus",
    body: { target: "ui-events/right" },
  }),
  keepZoom: true,
  sent: 0,
}, {
  focusLeft: { label: "focus left" },
  focusRight: { label: "focus right" },
  keepZoom: { label: "keep zoom" },
  sent: { label: "events sent" },
});

export default async function run(ctx: TimeContext) {
  events.onEvent((event) => {
    if (event.type !== "ui-events/focus" || event.body.state !== "down") return;
    // Fire and forget: the module neither knows nor cares whether a UI moved.
    ui.send({
      type: "tldraw.focusEntity",
      body: {
        type: "params",
        name: event.body.target,
        zoom: panel.keepZoom ? "keep" : "fit",
      },
    });
    panel.sent++;
  });
  while (true) await ctx.waitSec(0.05);
}
