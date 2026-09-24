# feature-midi-recording

Records notes from a MIDI input into one piano roll, using the isomorphic
`@avtools/midi` input through `midi-helpers`. It has no `engineTarget`, so the
same project runs on the Deno engine (native midir bridge) and the browser
engine (Web MIDI). Open it in both to compare.

## Controls (`midi-recording` params pane)

| Control | Effect |
| --- | --- |
| MIDI input | Ports visible right now. The list refreshes while the module runs, so a hot-plugged device, or browser MIDI permission granted after launch, appears without a restart. |
| recording | On starts a take. Off ends it and writes the take to `midi-recording/take`, replacing its notes. A take with no notes leaves the roll unchanged. |
| trim start silence | On: the first note lands at beat 0. Off: the time between toggling on and the first note is kept. |
| trim end silence | On: the take ends at the last note-off. Off: it ends when recording was toggled off. |
| status / take length | Readouts written by the module. |

Notes still held when recording stops are closed at the stop time. Beats use
the engine's tempo (60 bpm by default, so one beat is one second).

The piano roll stores notes only and has no clip-length field. Trimming the end
therefore changes only the reported **take length**, which is what a looping
player would use. Trimming the start moves the notes.

Only note on/off is recorded. Per-note MPE expression (pitch bend, pressure,
CC74) is received but not written to the roll.

## Timing

Events are placed by the device timestamp, mapped onto the engine's logical
clock, not by when the handler ran. A burst held up behind a slow frame on the
browser engine thread, or the native bridge's 4 ms dispatch tick, keeps its
played spacing.

## Manual check

1. Run **MIDI recorder** and leave it running. On the browser engine, click or
   press a key in the engine tab if the MIDI status line asks for permission.
2. Pick your controller in **MIDI input**. The status reads `listening to …`.
3. Toggle **recording** on, wait a moment, play a phrase, pause, toggle off.
   The roll shows the phrase; the status reads `wrote N notes`.
4. Repeat with each trim toggle off. Start trimming moves the first note;
   end trimming changes the take length.
5. Stop the module mid-take. The unfinished take is discarded and the input is
   closed. Replace and Panic close it too.

The headless part (declaration, toggle edges, empty take, Stop) is covered by
`verify-feature-projects.ts`, which needs no MIDI device.
