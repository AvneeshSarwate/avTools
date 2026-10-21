import type {ChopHost} from '@avtools/native-webgpu/td-chop';
import {scale} from '../channels/math.ts';
export {setup} from '../channels/main.ts';
export function onCook(host: ChopHost) { host.outputs.set('value', scale(host.inputs.get('value')) + 100); }
