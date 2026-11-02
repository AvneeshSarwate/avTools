// A JSON message {"x":0.5,"y":0.5} positions the circle (normalized 0..1).
import type {Setup, Draw} from '@avtools/native-webgpu/td-sketch';

let x = 0.5;
let y = 0.5;

export const setup: Setup = (_p, host) => {
  const socket = host.webSocket.connect('ws://127.0.0.1:8080');

  socket.onMessage(data => {
    if (typeof data !== 'string') return;
    try {
      const message = JSON.parse(data);
      if (Number.isFinite(message.x)) x = Math.max(0, Math.min(1, message.x));
      if (Number.isFinite(message.y)) y = Math.max(0, Math.min(1, message.y));
    } catch (error) {
      console.warn('Invalid JSON:', error);
    }
  });

  socket.onError(error => console.warn(error.message));
  socket.onClose(event => console.log('WebSocket closed:', event.code, event.reason));
};

export const draw: Draw = (p, frame) => {
  p.background(20, 28, 35);
  p.noStroke();
  p.fill(96, 215, 215);
  p.circle(x * frame.width, y * frame.height, 100);
};
