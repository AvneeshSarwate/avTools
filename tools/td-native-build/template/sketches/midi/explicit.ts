import type { ChopHost } from '@avtools/native-webgpu/td-chop';

// Output Channels: value. Fill in IDs from the logged device list before enabling.
// Leave output disabled until you deliberately select a destination.
const inputId = '';
const outputId = '';

export async function setup(host: ChopHost) {
  console.log('MIDI inputs', host.midi.listInputs());
  console.log('MIDI outputs', host.midi.listOutputs());

  if (inputId) {
    const input = await host.midi.openInput(inputId, { rawCC: true });

    input.on('cc', ({ value }) => {
      host.outputs.set('value', value);
    });
  }

  if (outputId) {
    const output = await host.midi.openOutput(outputId);
    output.cc(0, 74, 64); // Channel 1 in controller UI numbering.
  }
}
