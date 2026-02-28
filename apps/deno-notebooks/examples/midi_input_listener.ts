import { MidiAccess } from "@/midi/mod.ts";

const midi = MidiAccess.open();

const inputs = midi.listInputs();
console.log("Available MIDI inputs:");
for (const port of inputs) {
  console.log(`  - "${port.name}" (id: ${port.id})`);
}

if (inputs.length === 0) {
  console.error("No MIDI inputs found.");
  midi.close();
  Deno.exit(1);
}

// Use first available input, or change this to match your device
const port = inputs[0];
console.log(`\nListening on: "${port.name}"\n`);

const input = midi.openInput(port.id, { rateHz: 200 });

input.onNoteOn((evt) => {
  console.log(`NoteOn   ch=${evt.channel} note=${evt.noteNum} vel=${evt.velocity}`);
});

input.onNoteOff((evt) => {
  console.log(`NoteOff  ch=${evt.channel} note=${evt.noteNum} vel=${evt.velocity}`);
});

input.onCC((evt) => {
  console.log(`CC       ch=${evt.channel} cc=${evt.ctrlNum} val=${evt.ctrlVal}`);
});

input.onPitchBend((evt) => {
  console.log(`PB       ch=${evt.channel} bend=${evt.bend}`);
});

console.log("Press Ctrl+C to stop.\n");

// Keep alive until interrupted
Deno.addSignalListener("SIGINT", () => {
  console.log("\nClosing...");
  input.close();
  midi.close();
  Deno.exit(0);
});

// Block forever
await new Promise(() => {});
