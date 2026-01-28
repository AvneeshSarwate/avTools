// Example: Parse an Ableton .als with MPE pitch curves, edit rooted handles in the notebook piano roll,
// scale-transpose the annotated MPE clip, then play it back with playMPEClip.
// Notebook-friendly: run this file top-to-bottom, or split into cells.

import { MidiAccess } from "@/midi/mod.ts";
import { MPEDevice } from "@/midi/mpe_device.ts";
import { launch } from "@agentcombine/core-timing";
import { AbletonWatcher } from "@/tools/abletonWatcher.ts";
import { playMPEClip } from "@/tools/mpePlayback.ts";
import { createPianoRollBridge } from "@/tools/pianoRollAdapter.ts";
import { AbletonClip, scaleTransposeMPE, Scale } from "@agentcombine/music-types";

// ======================================================================
// 1) Configure paths + MIDI output selection
// ======================================================================

const ALS_PATH = "./MPE Sketches Project/MPE Sketches.als";
const CLIP_NAME = "melody";
const OUTPUT_NAME = "IAC Driver Bus 2"; // substring match (fall back to first output)

// ======================================================================
// 2) Parse clip + show in piano roll (editable)
// ======================================================================

const clipSet = await AbletonWatcher.read(ALS_PATH);
const original = clipSet.clip(CLIP_NAME) ?? clipSet.clip(1, 1);
if (!original) {
  throw new Error(`Clip not found: ${CLIP_NAME} (or track 1 / slot 1)`);
}

const piano = createPianoRollBridge();
piano.clips.set("mpe_edit", original);
const handle = piano.showBound("mpe_edit");

console.log("Edit the clip in the piano roll:");
console.log("1) Toggle MPE mode");
console.log("2) Add pitch points, select them, and mark 'rooted'");
console.log("3) Return here and run the transpose/playback section below");

// ======================================================================
// 3) Transpose down 1 scale degree in C major + playback
// ======================================================================

const edited = handle.latestClip;
if (!edited) {
  throw new Error("No clip loaded from the piano roll.");
}

const cMajor = new Scale(); // default root=60 with diatonic degrees
const transposed = new AbletonClip(
  `${edited.name}_scaleDown1`,
  edited.duration,
  edited.notes.map((note) => scaleTransposeMPE(note, -1, cMajor))
);

const midi = MidiAccess.open();
const outputs = midi.listOutputs();
if (outputs.length === 0) {
  throw new Error("No MIDI outputs available. Check your MIDI bridge setup.");
}

const outputInfo = outputs.find((port) => port.name.includes(OUTPUT_NAME)) ?? outputs[0];
console.log("Using MIDI output:", outputInfo.name);
const output = midi.openOutput(outputInfo.id);

const mpeDevice = new MPEDevice(output, { zone: "lower" });

try {
  await launch(async (ctx) => {
    ctx.setBpm(120);
    await playMPEClip(transposed, ctx, mpeDevice, {
      pitchBendRange: 96, // 96 for Bitwig, 48 for Ableton (Ableton often needs max to bounce MIDI)
      curveStepMs: 10,
      noteGap: 0.975,
    }).promise;
  });
} finally {
  output.close();
  midi.close();
}

// Optional cleanup when done:
// handle.disconnect();
