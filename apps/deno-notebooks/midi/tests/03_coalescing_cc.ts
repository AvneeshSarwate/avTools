import { openMidi, pickLoopback, sleep } from "./_helpers.ts";

const { midi } = openMidi(Deno.args[0]);
const inputs = midi.listInputs();
const outputs = midi.listOutputs();
const pair = pickLoopback(inputs, outputs);

console.log(`Using input: ${pair.input.name}`);
console.log(`Using output: ${pair.output.name}`);

const input = midi.openInput(pair.input.id, { rateHz: 20, keepAlive: false });
const output = midi.openOutput(pair.output.id);

const targetCc = 74;
const values = [10, 20, 99];

let resolved = false;
let resolveDone: () => void;
let rejectDone: (err: Error) => void;
const done = new Promise<void>((resolve, reject) => {
  resolveDone = resolve;
  rejectDone = reject;
});

const timeout = setTimeout(() => {
  if (!resolved) rejectDone(new Error("Timed out waiting for CC change"));
}, 2000);

input.onTick((tick) => {
  if (tick.ccChanges.length === 0) return;
  const cc = tick.ccChanges.find((c) => c.ctrlNum === targetCc);
  if (!cc) return;
  console.log("Tick CC changes:", tick.ccChanges);
  if (cc.ctrlVal !== values[values.length - 1]) {
    rejectDone(new Error(`Expected ${values[values.length - 1]}, got ${cc.ctrlVal}`));
    return;
  }
  if (!resolved) {
    resolved = true;
    clearTimeout(timeout);
    resolveDone();
  }
});

for (const val of values) {
  output.cc(0, targetCc, val);
}

await done;
console.log("Coalescing OK");

input.close();
output.close();
midi.close();
Deno.exit(0);
