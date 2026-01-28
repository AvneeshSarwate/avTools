// Example: Watching an Ableton Live Set (.als) and playing back MPE MIDI
// Requires AbletonWatcher + playMPEClip from denoMPEPlayback.md.
// This is notebook-friendly; split into separate cells if you want.

import { MidiAccess } from "../midi/mod.ts";
import { MPEDevice } from "../midi/mpe_device.ts";
import { launch } from "@agentcombine/core-timing";
import { AbletonWatcher } from "../tools/abletonWatcher.ts";
import { playMPEClip } from "../tools/mpePlayback.ts";

// ======================================================================
// Example 0: Configure paths + MIDI output selection
// ======================================================================

const ALS_PATH = "./MPE Sketches Project/MPE Sketches.als";
const CLIP_NAME = "melody";
const OUTPUT_NAME = "IAC Driver Bus 2"; // substring match (fall back to first output)

const midi = MidiAccess.open();
const outputs = midi.listOutputs();
console.log(outputs);

if (outputs.length === 0) {
  throw new Error("No MIDI outputs available. Check your MIDI bridge setup.");
}

const outputInfo = outputs.find((port) => port.name.includes(OUTPUT_NAME)) ?? outputs[0];
console.log("Using MIDI output:", outputInfo.name);
const output = midi.openOutput(outputInfo.id);

const mpeDevice = new MPEDevice(output, { zone: "lower" });

// ======================================================================
// Example 1: Static read (script-friendly)
// ======================================================================

const clipSet = await AbletonWatcher.read(ALS_PATH);
console.log("Available clips:", clipSet.listClips());

// Get a clip by name (or use clipSet.clip(track, slot) for index-based access)
const clip = clipSet.clip(CLIP_NAME) ?? clipSet.clip(1, 1);
if (!clip) {
  throw new Error(`Clip not found: ${CLIP_NAME} (or track 1 / slot 1)`);
}

// ======================================================================
// Example 2: Play a clip once with MPE curves
// ======================================================================

try {
  await launch(async (ctx) => {
    ctx.setBpm(120);
    await playMPEClip(clip, ctx, mpeDevice, {
      pitchBendRange: 96, //96 for bitwig, 48 for ableton (but ableton is buggy and needs max to bounce midi)
      curveStepMs: 10,
      noteGap: 0.975,
    }).promise;
  });
} finally {
  output.close();
  midi.close();
}

// ======================================================================
// Notebook-friendly live reload (interactive)
// ======================================================================
// const watcher = new AbletonWatcher(ALS_PATH);
// watcher.onUpdate(() => {
//   const updated = watcher.clip(CLIP_NAME) ?? watcher.clip(1, 1);
//   if (!updated) return;
//   launch(async (ctx) => {
//     await playMPEClip(updated, ctx, mpeDevice).promise;
//   });
// });
// // When done:
// // watcher.dispose();
