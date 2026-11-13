// Output Channels: shapes revision connected
import type {ChopHost} from '@avtools/native-webgpu/td-chop';
import {subscribeDrawing} from '../shared/subscribe.ts';

export function setup(host: ChopHost) {
  subscribeDrawing(host, 'ws://127.0.0.1:5177/canvas?drawing=main', (document, revision) => {
    host.outputs.set('shapes', document.freehand.nodes.length + document.polygon.nodes.length + document.circle.nodes.length);
    host.outputs.set('revision', revision);
  }, status => host.outputs.set('connected', status === 'connected' ? 1 : 0));
}
