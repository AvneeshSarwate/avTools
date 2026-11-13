import { launch } from '@avtools/core-timing';
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';
import { scale } from './math.ts';

// Set Output Channels to "value ticks" and Output Samples to 1.
// These controls appear on the CHOP's Controls page after the first build.
export const parameters = {
  Gain: { type: 'float', default: 1, min: 0, max: 4 },
  Offset: { type: 'float', default: 0, min: -10, max: 10 },
  Tickinterval: {
    type: 'float',
    label: 'Tick Interval (seconds)',
    default: 0.01,
    min: 0.001,
    max: 1,
    clamp: true,
  },
} as const satisfies ParameterDefinitions;

type Host = ChopHost<typeof parameters>;

export function setup(host: Host) {
  launch(async (ctx) => {
    while (true) {
      host.outputs.set('ticks', host.outputs.get('ticks') + 1);

      // Read the latest controls each iteration; this timer is independent of TD cooks.
      await ctx.waitSec(host.params.Tickinterval);
    }
  });
}

export function onCook(host: Host) {
  const input = host.inputs.get('value');
  const { Gain, Offset } = host.params;

  host.outputs.set('value', scale(input) * Gain + Offset);
}
