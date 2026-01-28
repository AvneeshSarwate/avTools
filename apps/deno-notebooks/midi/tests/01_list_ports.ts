import { openMidi } from "./_helpers.ts";

const { midi } = openMidi(Deno.args[0]);
const inputs = midi.listInputs();
const outputs = midi.listOutputs();

console.log("Inputs:");
for (const input of inputs) {
  console.log(`- ${input.name} (${input.id})`);
}

console.log("Outputs:");
for (const output of outputs) {
  console.log(`- ${output.name} (${output.id})`);
}

midi.close();
Deno.exit(0);
