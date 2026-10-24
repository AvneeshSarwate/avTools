import {launch} from '@avtools/core-timing';
import type {Setup, Draw} from '@avtools/native-webgpu/td-sketch';
import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Speed: {type: 'float', default: 1, min: 0, max: 4},
} as const satisfies ParameterDefinitions;
let phase = 0;
export const setup: Setup<typeof parameters> = (_p, host) => {
  let running = true;
  host.onDispose(() => { running = false; });
  launch(async ctx => {
    let previous = performance.now();
    while (running) {
      await ctx.waitSec(1 / 120); // Independent wall-clock timer, not a TD frame wait.
      if (!running) return;
      const now = performance.now();
      phase += (now - previous) / 1000 * host.params.Speed;
      previous = now;
      // Read host.params here each time: don't retain an old snapshot over await.
      // With TD playback paused, time advances but TD only presents on a cook.
    }
  });
};
export const draw: Draw<typeof parameters> = (p, frame) => {
  p.background(24); p.noStroke(); p.fill(80, 180, 255);
  p.circle(frame.width * (0.5 + 0.35 * Math.sin(phase)), frame.height / 2, 70);
};
