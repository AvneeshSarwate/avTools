import {launch} from '@avtools/core-timing';
import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';
import type {ChopHost} from '@avtools/native-webgpu/td-chop';

export const parameters = {
  Gain: {type: 'float', default: 1, min: 0, max: 4},
  Duration: {type: 'float', default: 1, min: 0.01, max: 5, clamp: true},
  Trigger: {type: 'pulse', label: 'Animate'},
} as const satisfies ParameterDefinitions;

type Host = ChopHost<typeof parameters>;
let animation = 0;
// Set Output Channels to "value". Press Animate to ramp a persistent value.
// The input and gain are read afresh after each timing wait.
export function onPulse(name: string, host: Host) {
  if (name !== 'Trigger') return;
  const generation = ++animation;
  launch(async ctx => {
    const duration = host.params.Duration;
    const start = performance.now();
    while (generation === animation) {
      const progress = Math.min(1, (performance.now() - start) / (duration * 1000));
      host.outputs.set('value', progress * host.params.Gain * (host.inputs.get('value') || 1));
      if (progress === 1) break;
      await ctx.waitSec(1 / 60);
    }
  });
}
export function setup(host: Host) { host.outputs.set('value', 0); }
