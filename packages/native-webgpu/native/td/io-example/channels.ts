import { launch } from '@avtools/core-timing';
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

// Output Channels: value target messages port
// Send /target with a float or int. The value eases toward the latest target.
// Port 0 chooses an available port; read it from the output channel or Info DAT log.
export const parameters = {
  Port: { type: 'int', default: 0, min: 0, max: 65535, clamp: true },
  Speed: { type: 'float', default: 5, min: 0.1, max: 20, clamp: true },
} as const satisfies ParameterDefinitions;

type Host = ChopHost<typeof parameters>;

export async function setup(host: Host) {
  // Relative to this entrypoint, even if the .toe lives in another directory.
  const config = JSON.parse(await host.files.readText('./config.json'));
  let target = Number(config.initialValue);
  let value = target;
  let messages = 0;

  const osc = await host.osc.open({ port: host.params.Port });
  host.outputs.set('port', osc.localAddress.port);
  console.log('OSC listening:', osc.localAddress);

  osc.onError((error) => console.warn('OSC:', error.message));

  osc.onMessage((message, remote) => {
    const first = message.args[0];

    if (message.address === '/target' && first && 'value' in first && typeof first.value === 'number') {
      target = first.value;
      messages++;
      host.outputs.set('target', target);
      host.outputs.set('messages', messages);

      // Reply to the sender; errors are explicit promises, like other async APIs.
      osc.send({ address: '/received', args: [target] }, remote).catch(console.warn);
    }
  });

  launch(async (ctx) => {
    let previous = performance.now();

    while (true) {
      const now = performance.now();
      const seconds = (now - previous) / 1000;
      previous = now;
      value += (target - value) * (1 - Math.exp(-host.params.Speed * seconds));
      host.outputs.set('value', value);

      await ctx.waitSec(1 / 120);
    }
  });

  // Reload/Reset closes this socket automatically. Reset after changing Port.
}
