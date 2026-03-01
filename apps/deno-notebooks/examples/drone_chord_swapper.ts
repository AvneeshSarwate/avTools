import { MidiAccess } from "@/midi/mod.ts";
import { createOSCClient } from "@/tools/osc.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Chord definitions (MIDI note numbers) ---
const chords: Record<string, number[]> = {
  Cmaj:  [60, 64, 67],       // C4 E4 G4
  Dmin:  [62, 65, 69],       // D4 F4 A4
  Emin:  [64, 67, 71],       // E4 G4 B4
  Fmaj:  [65, 69, 72],       // F4 A4 C5
  Gmaj:  [67, 71, 74],       // G4 B4 D5
  Amin:  [69, 72, 76],       // A4 C5 E5
  Cmaj7: [60, 64, 67, 71],   // C4 E4 G4 B4
  Dm9:   [62, 65, 69, 72, 76], // D4 F4 A4 C5 E5
};

// --- Input note → chord mapping ---
// Map controller note numbers to chord names.
// Adjust these to match your controller layout.
const noteToChord: Record<number, string> = {
  36: "Cmaj",
  37: "Dmin",
  38: "Emin",
  39: "Fmaj",
  40: "Gmaj",
  41: "Amin",
  42: "Cmaj7",
  43: "Dm9",
};

// --- Config ---
const INPUT_NAME = Deno.args[1] ?? "from Max 1";
const OUTPUT_NAME = Deno.args[0] ?? "IAC Driver Bus 1";
const OUTPUT_CHANNEL = 0;
const VELOCITY = 100;
const STRUM_MS = 250;        // ms between each note of the chord (0 = all at once)
const ATTACK = 0.7;        // 0–1, sent via OSC to /attack

// --- Setup MIDI ---
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

const outputs = midi.listOutputs();
console.log("\nAvailable MIDI outputs:");
for (const port of outputs) {
  console.log(`  - "${port.name}" (id: ${port.id})`);
}

const outputInfo = outputs.find((p) => p.name.includes(OUTPUT_NAME)) ?? outputs[0];
if (!outputInfo) {
  console.error("No MIDI outputs found.");
  midi.close();
  Deno.exit(1);
}

const inputPort = inputs.find((p) => p.name.includes(INPUT_NAME)) ?? inputs[0];
console.log(`\nListening on input: "${inputPort.name}"`);
console.log(`Sending to output:  "${outputInfo.name}"`);
console.log(`Output channel:     ${OUTPUT_CHANNEL + 1}`);
console.log("\nNote → Chord mapping:");
for (const [note, name] of Object.entries(noteToChord)) {
  console.log(`  note ${note} → ${name} ${JSON.stringify(chords[name])}`);
}

const input = midi.openInput(inputPort.id, { rateHz: 200 });
const output = midi.openOutput(outputInfo.id);
const osc = createOSCClient("127.0.0.1", 7099);

// --- State ---
let currentChordNotes: number[] = [];
let currentChordName: string | null = null;
let swapping = false;

// Inversion bounds: base chord notes ± 2 octaves
const OCTAVE_RANGE = 2;
const LOW_BOUND = (notes: number[]) => Math.min(...notes) - 12 * OCTAVE_RANGE;
const HIGH_BOUND = (notes: number[]) => Math.max(...notes) + 12 * OCTAVE_RANGE;

function randomInversion(playing: number[], baseNotes: number[]): number[] {
  const lo = LOW_BOUND(baseNotes);
  const hi = HIGH_BOUND(baseNotes);
  const result = [...playing];

  // Pick a random note to shift
  const idx = Math.floor(Math.random() * result.length);
  const note = result[idx];

  const canGoUp = note + 12 <= hi;
  const canGoDown = note - 12 >= lo;

  if (canGoUp && canGoDown) {
    result[idx] = Math.random() < 0.5 ? note + 12 : note - 12;
  } else if (canGoUp) {
    result[idx] = note + 12;
  } else if (canGoDown) {
    result[idx] = note - 12;
  }
  // else already at both bounds — leave unchanged

  return result;
}

async function sendChord(notes: number[]) {
  // Turn off current chord
  const hadNotes = currentChordNotes.length > 0;
  for (const note of currentChordNotes) {
    output.noteOff(OUTPUT_CHANNEL, note, 0);
  }
  currentChordNotes = [];

  // Brief gap so the synth registers the note-off before the new note-on
  if (hadNotes) {
    await sleep(10);
  }

  // Send attack param via OSC
  osc.send("/attack", ATTACK);

  // Turn on new chord (with optional strum)
  // Update currentChordNotes incrementally so an interrupt mid-strum
  // will correctly turn off only the notes that are actually sounding.
  for (let i = 0; i < notes.length; i++) {
    output.noteOn(OUTPUT_CHANNEL, notes[i], VELOCITY);
    currentChordNotes.push(notes[i]);
    if (STRUM_MS > 0 && i < notes.length - 1) {
      await sleep(STRUM_MS);
    }
  }
}

async function swapChord(newChordName: string) {
  if (swapping) return; // ignore overlapping triggers
  swapping = true;

  const baseNotes = chords[newChordName];
  if (!baseNotes) {
    swapping = false;
    return;
  }

  let newNotes: number[];
  if (currentChordName === newChordName) {
    // Same chord triggered — play a random inversion
    newNotes = randomInversion(currentChordNotes, baseNotes);
    console.log(`Invert  ${newChordName}  ${JSON.stringify(newNotes)}`);
  } else {
    // Different chord — play root position
    newNotes = [...baseNotes];
    console.log(`Chord → ${newChordName}  ${JSON.stringify(newNotes)}`);
  }

  await sendChord(newNotes);
  currentChordName = newChordName;
  swapping = false;
}

// --- Listen for input noteOn to trigger chord swaps ---
input.onNoteOn((evt) => {
  const chordName = noteToChord[evt.noteNum];
  if (chordName) {
    swapChord(chordName);
  } else {
    console.log(`Unmapped note ${evt.noteNum} (vel=${evt.velocity})`);
  }
});

console.log("\nPress Ctrl+C to stop.\n");

// --- Cleanup on exit ---
Deno.addSignalListener("SIGINT", () => {
  console.log("\nStopping — turning off held notes...");
  for (const note of currentChordNotes) {
    output.noteOff(OUTPUT_CHANNEL, note, 0);
  }
  input.close();
  output.close();
  osc.close();
  midi.close();
  Deno.exit(0);
});

// Block forever
await new Promise(() => {});
