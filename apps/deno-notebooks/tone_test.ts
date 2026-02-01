// Import shims first — sets up window globals, blob URL workaround,
// and Worker patch for markAsUntransferable before Tone.js loads.
import { WAA } from "@/tools/tone_deno_shims.ts";

// Dynamic import so Tone.js sees the polyfilled globals
const Tone = await import("tone");

// Create a node-web-audio-api AudioContext and hand it to Tone
const audioContext = new WAA.AudioContext();
Tone.setContext(audioContext as unknown as AudioContext);

console.log("Tone.js + node-web-audio-api test");
console.log(`Sample rate: ${audioContext.sampleRate}`);

// Create a Synth -> Freeverb -> destination chain
const reverb = new Tone.Freeverb({
  roomSize: 0.8,
  dampening: 3000,
  wet: 0.6,
}).toDestination();

const synth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.01,
    decay: 0.3,
    sustain: 0.2,
    release: 0.8,
  },
}).connect(reverb);

// Wait a moment for the AudioWorklet to initialize before playing
await new Promise((r) => setTimeout(r, 500));

// Play a simple melodic pattern
const notes = ["C4", "E4", "G4", "B4", "C5", "B4", "G4", "E4"];
let index = 0;

const interval = setInterval(() => {
  const note = notes[index % notes.length];
  synth.triggerAttackRelease(note, "8n");
  console.log(`Playing: ${note}`);
  index++;
}, 400);

// Stop after 6 seconds
setTimeout(() => {
  clearInterval(interval);
  setTimeout(async () => {
    synth.dispose();
    reverb.dispose();
    await audioContext.close();
    console.log("Done!");
  }, 2000);
}, 6000);
