/**
 * Piano Roll Bridge - Usage Examples
 *
 * This file contains example code for using the piano roll integration
 * in Deno Jupyter notebooks.
 */

import {
  createPianoRollBridge,
  AbletonClip,
  quickNote,
  type PianoRollHandle
} from "../tools/pianoRollAdapter.ts"

// ============================================================================
// Example 0: Create the Piano Roll Bridge
// ============================================================================

// Create the bridge - this auto-initializes the HTTP server
const piano = createPianoRollBridge()

// ============================================================================
// Example 1: Display a read-only piano roll
// ============================================================================

// Create a simple melody
const simpleClip = new AbletonClip("Simple Melody", 4, [
  quickNote(60, 0.5, 100, 0),    // C
  quickNote(62, 0.5, 100, 0.5),  // D
  quickNote(64, 0.5, 100, 1),    // E
  quickNote(65, 0.5, 100, 1.5),  // F
  quickNote(67, 1, 100, 2),      // G
])

// Display as read-only (user cannot edit)
piano.show(simpleClip)

// ============================================================================
// Example 2: Display an editable piano roll with binding
// ============================================================================

// Create a clip and add it to the clips map
const editableClip = new AbletonClip("Editable Melody", 8, [
  quickNote(64, 1, 100, 0),     // E
  quickNote(62, 1, 100, 1),     // D
  quickNote(60, 1, 100, 2),     // C
  quickNote(62, 1, 100, 3),     // D
  quickNote(64, 1, 100, 4),     // E
  quickNote(64, 1, 100, 5),     // E
  quickNote(64, 2, 100, 6),     // E (longer)
])

piano.clips.set("myMelody", editableClip)

// Display editable piano roll
const handle = piano.showBound("myMelody")

// ============================================================================
// Example 3: Working with the handle to access edited clips
// ============================================================================

// Later in your code, access the edited clip
const currentClip = handle.latestClip
console.log("Current notes:", currentClip?.notes)

// Update the clip programmatically (will sync to piano roll)
if (currentClip) {
  // Transpose up by 2 semitones
  const transposed = currentClip.transpose(2)
  piano.clips.set("myMelody", transposed)
}

// Clean up when done
handle.disconnect()

// ============================================================================
// Example 4: Multiple piano rolls bound to the same clip
// ============================================================================

// Both piano rolls will stay in sync
piano.clips.set("sharedMelody", new AbletonClip("Shared", 4, [
  quickNote(60, 1, 100, 0),
  quickNote(64, 1, 100, 1),
  quickNote(67, 1, 100, 2),
  quickNote(72, 1, 100, 3),
]))

const handle1 = piano.showBound("sharedMelody")
const handle2 = piano.showBound("sharedMelody")

// Editing in either piano roll will update both displays
// and update piano.clips.get("sharedMelody")

// ============================================================================
// Example 5: Live playhead visualization
// ============================================================================

// Set up a clip
piano.clips.set("playingMelody", new AbletonClip("Playing", 8, [
  quickNote(60, 0.5, 100, 0),
  quickNote(62, 0.5, 100, 1),
  quickNote(64, 0.5, 100, 2),
  quickNote(65, 0.5, 100, 3),
]))

const playHandle = piano.showBound("playingMelody")

// Simulate playback by updating playhead position
let position = 0
const playbackInterval = setInterval(() => {
  playHandle.setLivePlayhead(position)
  position += 0.1
  if (position > 8) position = 0
}, 100)

// Stop playback later
// clearInterval(playbackInterval)

// ============================================================================
// Example 6: Reactive updates
// ============================================================================

piano.clips.set("reactive", new AbletonClip("Reactive", 4, [
  quickNote(60, 1, 100, 0),
]))

const reactiveHandle = piano.showBound("reactive")

// Programmatic updates sync to the UI
const newClip = new AbletonClip("Updated", 4, [
  quickNote(60, 1, 100, 0),
  quickNote(64, 1, 100, 1),
  quickNote(67, 1, 100, 2),
])
piano.clips.set("reactive", newClip)

// ============================================================================
// Example 7: Working with transforms
// ============================================================================

const basePattern = new AbletonClip("Base", 2, [
  quickNote(60, 0.25, 100, 0),
  quickNote(62, 0.25, 100, 0.5),
  quickNote(64, 0.25, 100, 1),
  quickNote(65, 0.25, 100, 1.5),
])

// Apply transformations and show each
piano.clips.set("original", basePattern)
piano.showBound("original")

piano.clips.set("transposed", basePattern.transpose(5))
piano.showBound("transposed")

piano.clips.set("scaled", basePattern.scale(2))
piano.showBound("scaled")

// ============================================================================
// Example 8: Creating clips from scratch in the UI
// ============================================================================

// Create an empty clip for the user to draw notes
const emptyClip = new AbletonClip("Empty", 8, [])
piano.clips.set("userCreated", emptyClip)
const drawHandle = piano.showBound("userCreated")

// Later, get what the user drew
console.log("User created:", drawHandle.latestClip?.notes)

// ============================================================================
// Example 9: Cleanup
// ============================================================================

// Disconnect individual handles
handle1.disconnect()
handle2.disconnect()

// Or shutdown the entire bridge (closes server)
// piano.shutdown()

// ============================================================================
// Example 10: Pattern generation with live feedback
// ============================================================================

function generatePattern(startPitch: number, length: number): AbletonClip {
  const notes = []
  for (let i = 0; i < length; i++) {
    notes.push(quickNote(startPitch + (i * 2), 0.5, 100, i * 0.5))
  }
  return new AbletonClip("Generated", length / 2, notes)
}

piano.clips.set("generated", generatePattern(60, 8))
const genHandle = piano.showBound("generated")

// Regenerate with different parameters
piano.clips.set("generated", generatePattern(72, 12))
