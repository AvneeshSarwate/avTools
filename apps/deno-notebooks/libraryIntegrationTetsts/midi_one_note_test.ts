import { MidiAccess } from "../midi/mod.ts";

const midi = MidiAccess.open();

// List available outputs
const outputs = midi.listOutputs();
console.log("Available MIDI outputs:");
for (const port of outputs) {
  console.log(`  - "${port.name}" (id: ${port.id})`);
}

const iac = outputs.find((p) => p.name === "IAC Driver Bus 1");
if (!iac) {
  console.error("Could not find 'IAC Driver Bus 1'. Available ports listed above.");
  midi.close();
  Deno.exit(1);
}

console.log(`\nOpening output: "${iac.name}"`);
const out = midi.openOutput(iac.id);

// Send a middle-C note on, wait 500ms, then note off
const channel = 0;
const note = 60;
const velocity = 100;

console.log(`Sending note on:  ch=${channel} note=${note} vel=${velocity}`);
out.noteOn(channel, note, velocity);

await new Promise((r) => setTimeout(r, 500));

console.log(`Sending note off: ch=${channel} note=${note}`);
out.noteOff(channel, note, 0);

await new Promise((r) => setTimeout(r, 100));

out.close();
midi.close();
console.log("Done.");
