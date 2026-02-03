import { MidiAccess } from "@/midi/mod.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const OUTPUT_NAME = Deno.args[0] ?? "IAC Driver Bus 2";
type MPEZone = 'upper' | 'lower'
const ZONE: MPEZone = 'lower' //(Deno.args[1] ?? "lower").toLowerCase() as "lower" | "upper";

const midi = MidiAccess.open();
const outputs = midi.listOutputs();
if (outputs.length === 0) {
  throw new Error("No MIDI outputs available.");
}

const outputInfo = outputs.find((port) => port.name.includes(OUTPUT_NAME)) ?? outputs[0];
console.log("Using output:", outputInfo.name);
const output = midi.openOutput(outputInfo.id);

const lowerNoteChans = [1, 2]; // channels 2-3 (0-based 1-2)
const upperNoteChans = [13, 14]; // channels 14-15 (0-based 13-14)
//@ts-ignore - overly strict type checking for literals
const noteChans = ZONE === "upper" ? upperNoteChans : lowerNoteChans;

console.log("Zone:", ZONE);
console.log("Note channels:", noteChans.map((c) => c + 1).join(", "));

// Test 1: Plain channel 1 (non-MPE) note
console.log("Test 1: CH1 note (non-MPE)");
output.noteOn(0, 60, 100);
await sleep(300);
output.noteOff(0, 60, 64);
await sleep(400);

// Test 2: MPE-style notes on member channels
console.log("Test 2: MPE member channel notes");
for (const chan of noteChans) {
  output.noteOn(chan, 64 + chan, 100);
  await sleep(100);
}
await sleep(300);
for (const chan of noteChans) {
  output.noteOff(chan, 64 + chan, 64);
  await sleep(50);
}
await sleep(400);

// Test 3: Pitch bend on member channels (center, up, down)
console.log("Test 3: Pitch bend sweep on member channels");
for (const chan of noteChans) {
  output.noteOn(chan, 67 + chan, 100);
}
await sleep(100);

for (const chan of noteChans) {
  output.pitchBend(chan, 0); // center
}
await sleep(200);

for (const chan of noteChans) {
  output.pitchBend(chan, 4096); // up
}
await sleep(200);

for (const chan of noteChans) {
  output.pitchBend(chan, -4096); // down
}
await sleep(200);

for (const chan of noteChans) {
  output.pitchBend(chan, 0);
}
await sleep(100);

for (const chan of noteChans) {
  output.noteOff(chan, 67 + chan, 64);
}
await sleep(400);

// Test 4: Pressure + timbre (CC74) on member channels
console.log("Test 4: Pressure + timbre on member channels");
for (const chan of noteChans) {
  output.noteOn(chan, 72 + chan, 100);
}
await sleep(100);
for (const chan of noteChans) {
  output.channelPressure(chan, 80);
  output.cc(chan, 74, 90);
}
await sleep(200);
for (const chan of noteChans) {
  output.channelPressure(chan, 10);
  output.cc(chan, 74, 20);
}
await sleep(200);
for (const chan of noteChans) {
  output.noteOff(chan, 72 + chan, 64);
}

// Test 5: Channel sweep (1-16) to see what the track actually hears
console.log("Test 5: Channel sweep (1-16)");
for (let chan = 0; chan < 16; chan++) {
  const note = 60 + (chan % 12);
  console.log(`  CH${chan + 1} note ${note}`);
  output.noteOn(chan, note, 100);
  await sleep(120);
  output.noteOff(chan, note, 64);
  await sleep(80);
}

output.close();
midi.close();
console.log("Done.");
