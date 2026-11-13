#!/usr/bin/env -S deno run --allow-all
/**
 * Scene Inspector Demo
 *
 * Creates 2 piano rolls and 2 tweakpane panels, opens the Scene Inspector
 * to view and control them all from a single browser window.
 *
 * Each tweakpane has:
 *   - Scale Transpose slider (-7 to +7 scale degrees, applied in real-time per note)
 *   - Playback Speed slider (0.25x to 4x)
 *   - Play button
 *
 * Usage:
 *   deno run --allow-all examples/scene_inspector_demo.ts
 */

import { createPianoRollBridge } from "@/tools/pianoRollAdapter.ts"
import { createTweakpane } from "@/tools/tweakpaneAdapter.ts"
import { openInspector } from "@/tools/inspector.ts"
import { launch } from "@avtools/core-timing"
import {
  AbletonClip,
  quickNote,
  Scale,
  scaleTransposeMPE,
  type AbletonNote,
} from "@avtools/music-types"

// ============================================================================
// Musical Setup
// ============================================================================

const scale = new Scale() // C major, root 60
const BASE_BPM = 120

// Melody A: rising scale run (C4 D E F G A B C5)
const melodyANotes: AbletonNote[] = [0, 1, 2, 3, 4, 5, 6, 7].map((deg, i) =>
  quickNote(scale.getByIndex(deg), 0.5, 100, i * 0.5)
)
const melodyA = new AbletonClip("Melody A", 4, melodyANotes)

// Melody B: arpeggiated pattern (C4 E G C5 . G B D5 .)
const melodyBDegrees = [0, 2, 4, 7, -1, 4, 6, 8]
const melodyBNotes: AbletonNote[] = melodyBDegrees
  .filter(d => d >= 0)
  .map((deg, i) => quickNote(scale.getByIndex(deg), 0.75, 90, i * 1))
const melodyB = new AbletonClip("Melody B", 8, melodyBNotes)

// ============================================================================
// Piano Rolls
// ============================================================================

const piano = createPianoRollBridge()

piano.clips.set("Melody A", melodyA)  // auto-registers with inspector
piano.clips.set("Melody B", melodyB)

// ============================================================================
// Playback Engine
// ============================================================================

// Follows the same pattern as playMPEClip from tools/mpePlayback.ts:
//   - launch() in realtime mode
//   - iterate sorted notes, ctx.wait() between them
//   - apply transposition at note-play time via onNoteStart-style callback
//
// This version logs to console instead of sending MIDI, so no hardware needed.
// To add MIDI: replace the console.log with playMPENote() calls via MPEDevice.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

function playMelody(
  clipName: string,
  params: { transpose: number; speed: number },
) {
  const clip = piano.clips.get(clipName)
  if (!clip) {
    console.log(`No clip found for "${clipName}"`)
    return
  }

  console.log(
    `▶ Playing "${clipName}" ` +
    `(transpose: ${params.transpose >= 0 ? "+" : ""}${params.transpose}, ` +
    `speed: ${params.speed}x)`
  )

  launch(async (ctx) => {
    ctx.setBpm(BASE_BPM * params.speed)

    const notes = clip.notes
      .filter(n => n.isEnabled)
      .slice()
      .sort((a, b) => a.position - b.position)

    for (let i = 0; i < notes.length; i++) {
      let note = notes[i]

      // Wait until note start position
      const currentBeats = ctx.progBeats
      if (note.position > currentBeats) {
        await ctx.wait(note.position - currentBeats)
      }

      // Real-time transposition: read current tweakpane value at note-play time
      if (params.transpose !== 0) {
        note = scaleTransposeMPE(note, params.transpose, scale)
      }

      console.log(
        `  [${clipName}] ${noteName(note.pitch)} ` +
        `(${note.pitch}) vel:${note.velocity} dur:${note.duration.toFixed(2)}`
      )

      // Fire-and-forget note duration (like playMPENote's noteOff scheduling)
      ctx.branch(async (offCtx) => {
        await offCtx.wait(note.duration * 0.95)
        // noteOff would go here
      }, `note-off-${i}`)
    }

    // Wait for clip to finish
    const remaining = clip.duration - ctx.progBeats
    if (remaining > 0) await ctx.wait(remaining)

    console.log(`■ Finished "${clipName}"`)
  })
}

// ============================================================================
// Tweakpane Controls
// ============================================================================

const paramsA = { transpose: 0, speed: 1 }
const paneA = createTweakpane({ title: "Melody A Controls" })
paneA.addBinding(paramsA, "transpose", { min: -7, max: 7, step: 1, label: "Scale Transpose" })
paneA.addBinding(paramsA, "speed", { min: 0.25, max: 4, step: 0.25, label: "Playback Speed" })
paneA.addButton({ title: "Play Melody A" }).on("click", () => {
  playMelody("Melody A", paramsA)
})
const paramsB = { transpose: 0, speed: 1 }
const paneB = createTweakpane({ title: "Melody B Controls" })
paneB.addBinding(paramsB, "transpose", { min: -7, max: 7, step: 1, label: "Scale Transpose" })
paneB.addBinding(paramsB, "speed", { min: 0.25, max: 4, step: 0.25, label: "Playback Speed" })
paneB.addButton({ title: "Play Melody B" }).on("click", () => {
  playMelody("Melody B", paramsB)
})

// ============================================================================
// Open Scene Inspector
// ============================================================================

const url = await openInspector()
console.log(`\nScene Inspector: ${url}`)
console.log("4 components registered: 2 piano rolls + 2 tweakpane panels")
console.log("Adjust sliders and click Play to hear melodies (console output).")
console.log("Edit notes in piano rolls — edits are picked up on next Play.\n")

// Keep the process alive (servers need to stay running)
await new Promise(() => {})
