import { launch } from '@avtools/core-timing';
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Controller: { type: 'midiInput', label: 'MIDI Controller', page: 'MIDI' },
  Duration: { type: 'float', default: 0.25, min: 0.01, max: 2, clamp: true },
} as const satisfies ParameterDefinitions;

// Output Channels: value note velocity. Select your device on the MIDI page.
export function setup(host: ChopHost<typeof parameters>) {
  const input = host.midi.bindInput('Controller', { rawCC: false });
  let target = 0;
  let value = 0;

  input.on('cc', (event) => {
    target = event.value / 127;
  });

  input.on('noteOn', ({ note, velocity }) => {
    host.outputs.set('note', note);
    host.outputs.set('velocity', velocity / 127);
  });

  input.on('noteOff', () => {
    host.outputs.set('velocity', 0);
  });

  // One persistent animation reads the latest controller state. It is cancelled
  // automatically on reload. No cook callback or manual listener cleanup needed.
  launch(async (ctx) => {
    let previous = performance.now();

    while (true) {
      await ctx.waitSec(1 / 120);
      const now = performance.now();
      const seconds = (now - previous) / 1000;
      previous = now;
      value += (target - value) * (1 - Math.exp(-seconds / host.params.Duration));
      host.outputs.set('value', value);
    }
  });
}
