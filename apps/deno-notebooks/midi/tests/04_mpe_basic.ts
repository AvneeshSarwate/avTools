import { openMidi, pickLoopback, sleep } from "./_helpers.ts";

const { midi } = openMidi(Deno.args[0]);
const inputs = midi.listInputs();
const outputs = midi.listOutputs();
const pair = pickLoopback(inputs, outputs);

console.log(`Using input: ${pair.input.name}`);
console.log(`Using output: ${pair.output.name}`);

const input = midi.openInput(pair.input.id, { rateHz: 100, keepAlive: false });
const output = midi.openOutput(pair.output.id);

const mpe = input.asMPE({ zone: "lower", timbreCC: 74 });

let starts = 0;
let updates = 0;
let ends = 0;

mpe.onNoteStart((evt) => {
  starts++;
  console.log("MPE start", evt);
});

mpe.onNoteUpdate((evt) => {
  updates++;
  console.log("MPE update", evt);
});

mpe.onNoteEnd((evt) => {
  ends++;
  console.log("MPE end", evt);
});

// Pre-note expression
output.pitchBend(1, 1024);
output.channelPressure(1, 40);
output.cc(1, 74, 64);

await sleep(20);

output.noteOn(1, 60, 100);
await sleep(20);

// Update expression while note is active
output.channelPressure(1, 80);
output.cc(1, 74, 90);
await sleep(20);

output.noteOff(1, 60, 64);

await sleep(200);

console.log(`Starts: ${starts}, Updates: ${updates}, Ends: ${ends}`);

mpe.close();
input.close();
output.close();
midi.close();
Deno.exit(0);
