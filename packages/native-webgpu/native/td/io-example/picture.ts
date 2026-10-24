import type { Setup, Draw } from '@avtools/native-webgpu/td-sketch';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Port: { type: 'int', default: 0, min: 0, max: 65535, clamp: true },
} as const satisfies ParameterDefinitions;

let x = 0.5;
let background = 24;

export const setup: Setup<typeof parameters> = async (_p, host) => {
  const config = JSON.parse(await host.files.readText('./config.json'));
  background = Number(config.background);

  const osc = await host.osc.open({ port: host.params.Port });
  console.log('Send /x to this port:', osc.localAddress.port);

  osc.onError((error) => console.warn('OSC:', error.message));

  osc.onMessage((message) => {
    const first = message.args[0];

    if (message.address === '/x' && first && 'value' in first && typeof first.value === 'number') {
      x = Math.max(0, Math.min(1, first.value));
    }
  });

  // Receiving updates state immediately. TD displays it on the next render.
};

export const draw: Draw<typeof parameters> = (p, frame) => {
  p.background(background);
  p.noStroke();
  p.fill(80, 180, 255);
  p.circle(x * frame.width, frame.height / 2, 70);
};
