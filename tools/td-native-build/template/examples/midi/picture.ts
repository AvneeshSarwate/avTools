import type { Setup, Draw } from '@avtools/native-webgpu/td-sketch';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Controller: { type: 'midiInput', label: 'MIDI Controller', page: 'MIDI' },
} as const satisfies ParameterDefinitions;

let position = 0.5;
let brightness = 0.5;

export const setup: Setup<typeof parameters> = (_p, host) => {
  const input = host.midi.bindInput('Controller', { rawCC: false });

  input.on('cc', ({ value }) => {
    position = value / 127;
  });

  input.on('noteOn', ({ velocity }) => {
    brightness = velocity / 127;
  });
};

export const draw: Draw<typeof parameters> = (p, frame) => {
  p.background(15);
  p.noStroke();
  p.fill(80, 120 + brightness * 135, 220);
  p.circle(position * frame.width, frame.height / 2, 120);
};
