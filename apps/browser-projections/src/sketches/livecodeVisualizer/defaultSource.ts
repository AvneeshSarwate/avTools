export const DEFAULT_LIVECODE_SOURCE =
  `import type { TimeContext } from "@avtools/core-timing";
import { midiDevices } from "midi-helpers";

const deviceName = "IAC Driver Bus 1";
const channel = 0;
const velocity = 60;
const noteDurationSec = 0.18;
const stepSec = 0.2;
const pitches = [60, 62, 64, 65];

function noteOn(ctx: TimeContext, pitch: number) {
  ctx.branch(async (noteCtx) => {
    const device = midiDevices[deviceName];
    device.noteOn(channel, pitch, velocity);
    try {
      await noteCtx.waitSec(noteDurationSec);
    } finally {
      device.noteOff(channel, pitch);
    }
  });
}

export default async function(ctx: TimeContext) {
  for (let i = 0; i < pitches.length; i++) {
    noteOn(ctx, pitches[i]);
    await ctx.waitSec(stepSec);
  }
}
`;
