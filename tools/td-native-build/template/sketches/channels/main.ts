import type {ChopHost} from '@avtools/native-webgpu/td-chop';
import {scale} from './math.ts';
export function setup(host: ChopHost) {
  host.timing.launch(async ctx => {
    while (true) { host.outputs.set('ticks', host.outputs.get('ticks') + 1); await ctx.waitSec(0.01); }
  });
}
export function onCook(host: ChopHost) { host.outputs.set('value', scale(host.inputs.get('value'))); }
