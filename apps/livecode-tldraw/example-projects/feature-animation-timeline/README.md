# feature-animation-timeline

A long-lived fixture for the durable animation timeline and its tldraw view.
The checked-in data contains number, enum, and function tracks. The sampler
module reads the number track at 30 Hz and publishes `animation-fixture/gain`
to the saved scope view.

The Playwright E2E copies this directory into its temporary session, verifies
the restored entity and editor, then uses the copy for edit, save, mutate, and
reopen coverage. This directory therefore remains usable for manual testing.

## Open it

Start the server from `apps/deno-notebooks`:

```sh
deno task livecode:server
```

Start the client from `apps/livecode-tldraw`:

```sh
nvm use 22
npm run dev
```

Open:

```text
http://localhost:5173/?projectPath=<absolute path to this directory>
```

## Manual verification

1. Before running the module, the animation editor shows `gain`, `scene`, and
   `cue` in that order. `gain` has four keyframes; the other tracks contain
   enum changes and function cues.
2. Run **timeline sampler**. The gain scope starts moving through the saved
   curve.
3. Edit a gain keyframe. The scope follows the edited curve on the next pass,
   and the topbar reports the timeline as unsaved.
4. Click **Save project**, make another edit without saving, then reload the
   same URL. The saved edit returns and the later edit disappears.
5. Add or reorder a track, save, and reload to check stable track/element IDs
   and `trackOrder` persistence.

Manual saves intentionally modify the checked-in data file and its `savedAt`.
Restore the fixture directory with Git when finished.
