import * as timing from '@avtools/core-timing';
import type {Setup, OnCook, OnPulse} from '@avtools/native-webgpu/td-chop';

// Module state belongs to this operator. Each copy has its own gain and tasks.
let requested = false;
export const setup: Setup = host => {
  host.outputs.set('gain', 1);
  timing.launch(async ctx => {
    while (true) {
      if (requested) {
        requested = false;
        const from = host.outputs.get('gain');
        const target = host.inputs.get('target');
        const duration = Math.max(0.01, host.inputs.get('duration'));
        const start = ctx.time;
        // A retrigger starts a new ramp from its current value. Input controls
        // are sampled at trigger time; other tasks can read them continuously.
        while (!requested && ctx.time - start < duration) {
          const t = Math.min(1, (ctx.time - start) / duration);
          const eased = t * t * (3 - 2 * t);
          host.outputs.set('gain', from + (target - from) * eased);
          await ctx.waitSec(1 / 120);
          host.outputs.set('ticks', host.outputs.get('ticks') + 1);
        }
        if (!requested) host.outputs.set('gain', target);
      }
      host.outputs.set('ticks', host.outputs.get('ticks') + 1);
      await ctx.waitSec(1 / 120);
    }
  });
};
export const onPulse: OnPulse = (name, host) => {
  if (name === 'Trigger') {
    requested = true;
    host.outputs.set('pulses', host.outputs.get('pulses') + 1);
  }
};
// A synchronous evaluator combines the newest TD input with the latest animated
// state. No request/next-frame protocol is needed. Omit onCook for pure state outputs.
export const onCook: OnCook = host => {
  host.outputs.set('value', host.inputs.get('value') * host.outputs.get('gain'));
};
