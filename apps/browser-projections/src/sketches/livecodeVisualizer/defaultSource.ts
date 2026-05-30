export const DEFAULT_LIVECODE_SOURCE =
  `import type { TimeContext } from "@avtools/core-timing";
import { midiDevices } from "midi-helpers";

const deviceName = "IAC Driver Bus 1";
const channel = 0;
const velocity = 60;
const noteDurationSec = 0.18;
const stepSec = 0.2;
const pitches1 = [60, 62, 64, 65];
const pitches2 = [69, 67, 64, 65];
const device = midiDevices[deviceName];

function noteOn(ctx: TimeContext, pitch: number) {
  ctx.branch(async (noteCtx) => {
    device.noteOn(channel, pitch, velocity);
    try {
      await noteCtx.waitSec(noteDurationSec);
    } finally {
      device.noteOff(channel, pitch);
    }
  });
}

export default async function(ctx: TimeContext) {
  for(let n = 0; n < 5; n++) {
    const p = Math.random() < 0.5
    if(p) {
      for (let i = 0; i < pitches1.length; i++) {
        noteOn(ctx, pitches1[i]);
        await ctx.waitSec(stepSec + 0.1 + Math.random()*0.2);
      }
    } else {
      for (let i = 0; i < pitches2.length; i++) {
        noteOn(ctx, pitches2[i]);
        await ctx.waitSec(stepSec + 0.1 + Math.random()*0.2);
      }
    }
  }
}

`;
