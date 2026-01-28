import { openMidi, pickLoopback, sleep } from "./_helpers.ts";

const { midi } = openMidi(Deno.args[0]);
const inputs = midi.listInputs();
const outputs = midi.listOutputs();
const pair = pickLoopback(inputs, outputs);

console.log(`Using input: ${pair.input.name}`);
console.log(`Using output: ${pair.output.name}`);

const input = midi.openInput(pair.input.id, { rateHz: 200, keepAlive: false });
const output = midi.openOutput(pair.output.id);

const received: string[] = [];
let resolveDone: () => void;
let rejectDone: (err: Error) => void;
const done = new Promise<void>((resolve, reject) => {
  resolveDone = resolve;
  rejectDone = reject;
});

const timeout = setTimeout(() => {
  rejectDone(new Error("Timed out waiting for note events"));
}, 2000);

input.onNote((evt) => {
  const label = evt.on ? "on" : "off";
  received.push(`${label}:${evt.noteNum}`);
  console.log("Note event", evt);
  if (!evt.on) {
    clearTimeout(timeout);
    resolveDone();
  }
});

output.noteOn(0, 60, 100);
await sleep(50);
output.noteOff(0, 60, 64);

await done;

console.log("Received:", received.join(", "));

input.close();
output.close();
midi.close();
Deno.exit(0);
