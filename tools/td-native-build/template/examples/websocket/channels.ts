// Set Output Channels to: value connected
// Run any WebSocket server that sends JSON such as {"value":0.5}.
import type {ChopHost} from '@avtools/native-webgpu/td-chop';

export function setup(host: ChopHost) {
  const socket = host.webSocket.connect('ws://127.0.0.1:8080');

  socket.onOpen(() => {
    host.outputs.set('connected', 1);
    void socket.send(JSON.stringify({type: 'hello', role: 'chop'})).catch(console.warn);
  });

  socket.onMessage(data => {
    if (typeof data !== 'string') return;
    try {
      const message = JSON.parse(data);
      if (typeof message.value === 'number' && Number.isFinite(message.value)) {
        host.outputs.set('value', message.value);
      }
    } catch (error) {
      console.warn('Invalid JSON:', error);
    }
  });

  socket.onError(error => console.warn(error.message));
  socket.onClose(() => host.outputs.set('connected', 0));
  // Reset/reload closes this socket automatically. For reconnect, schedule a
  // new connection from onClose; keep a stopped flag in host.onDispose.
}
