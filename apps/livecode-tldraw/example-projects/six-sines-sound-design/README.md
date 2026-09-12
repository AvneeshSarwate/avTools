# Six Sines sound design with a piano roll

Open this browser-target project from the projects page with **engine in browser** (separate engine tab) or **engine in same tab** (quick checks; reloading stops the engine). The saved project opens a Six Sines editor, one editable piano roll, and playback/LFO controls. Click in the engine tab if your browser requires an audio gesture.

1. Run **Play the piano roll**. It creates one AudioContext and one Six Sines AudioWorklet instance. The phrase is reread at each loop boundary.
2. Edit the synth. Knob changes update the named `sound-design/lead` entity and the existing audio instance. Load/import/export native `.sxsnp` presets in the editor; project Save persists the base preset and current parameter values.
3. Optionally run **Optional 60 Hz pan LFOs**, then enable any of the six operator toggles in the controls pane. Their phases derive from logical time. Disable a toggle or stop the LFO module to restore its captured pan center. While enabled, automation owns that pan control.
4. Stop the player to release notes, unsubscribe the parameter bridge, dispose the worklet and close its context. Stop/Panic cancellation also performs cleanup. You may stop the LFO module independently.

The initial sound mixes six harmonic sine partials, so all six pan controls are audible. The LFO loop performs six or fewer ordinary `sound.values[id] = value` assignments at 60 Hz. The framework's normal synchronization tick coalesces these for the UI and audio bridge; the editor may therefore repaint at the sync rate rather than 60 Hz. No full preset is serialized for those parameter updates.

The instrument helper contains audio lifecycle plumbing. `subscribeSixSinesChanges` explicitly shares the collector's already-drained patch batch with the AudioWorklet bridge; it does not take a second drain or scan all parameters every tick. Full preset changes use a serialized bulk load followed by current overrides. The audio instance lives in module runtime state, not the durable entity or the tldraw shape.

The Vue source and native synth source remain in the Six Sines repository. The compiled webcomponent and engine distribution live in `packages/six-sines`. Removing a canvas view does not stop or delete the synth entity; canvas layout and musical state are separate.

## Running after updating avTools

Restart the livecode server to rebuild its browser engine assets, and restart
Vite to load the new asset plugin. Open this directory from the projects page
with either browser-engine option, then run **Play the piano roll**. The helper module
does not need to be run separately. The optional LFO module must be running as
well as its individual toggles being enabled.

## Validation

The final fixture passes browser project diagnostics, module analysis, and
entity/layout save-and-reopen tests. The UI and tldraw builds pass. A real
Chromium session exercised knob keyboard entry, factory preset loading, native
preset import/export, project save/reopen, piano-roll audio, and Stop/Panic.

With all six pan LFOs enabled, 40 sampled outgoing synth updates were sparse
patches, at most 656 bytes per entity change; none contained a full entity.
This session used the same-tab topology; the separate-tab path is wired through
the shared transport but has not had the same end-to-end check.
Audio parameter batches contained at most six events and did not reload the
preset. Stopping automation restored all six pan centers. This is a functional
transport check, not an engine CPU benchmark.

During browser verification, the live LSP showed an “Unable to load a local
module” warning for generated project imports even though browser project
diagnostics and execution succeeded. That diagnostic issue remains unresolved.
