# feature-studio-combined

The richer combined project: everything working together against durable,
checked-in state.

**Covers:** durable persistence (checked-in `data/` files + manifest `data`
entries, so opening restores a roll and a pre-launch param pane with meta),
the full edit → save → mutate → re-open → verify-restored loop, an anchored
playhead signal, code-driven params reads at loop rate, a `graph: true`
monitor field written by code, a finite variation writer, an observable
`stop()` hook, and canvas layout persistence for its module shapes, piano-roll
views, param pane, and both scope source types: an ephemeral signal and a
durable params leaf.

Entity names deliberately contain a slash (`studio/theme`, `studio/mix`) so
the percent-encoded data filenames (`studio%2Ftheme.json`) exercise the
documented name encoding. The saved params values deliberately differ from
the declaration defaults in `performer.orig.ts` (0.3 s/beat vs 0.25, velocity
88 vs 96, gate 0.8 vs 0.9): if you see 0.3 in the pane, restoration — not the
declaration — is what filled it.

## Opening it

Server (from `apps/deno-notebooks`):

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug
```

Client (from `apps/livecode-tldraw`): `npm run dev`, then open

```text
http://localhost:5173/?projectPath=<absolute path to this directory>
```

## Manual verification checklist

### A. Restored state on open (before running anything)

1. The `studio/mix` pane is **populated before any module has run**: folders
   `tempo` / `dynamics` / `monitor`, labeled sliders with bounds, and the
   readonly graph row under `monitor.level` — all from the saved `meta`.
2. Its values are the **saved** ones: seconds per beat 0.3, velocity 88,
   gate 0.8 (not the declaration defaults).
3. The `studio/theme` view shows the nine-note melody from
   `data/pianoRoll/studio%2Ftheme.json`. `studio/theme-var` and both scopes
   are waiting.

### B. Live behavior

4. **Run `performer`.** A labeled playhead marker sweeps the theme view; the
   `monitor.level` graph row ramps 0 → 1 each pass; the playhead scope draws
   a sawtooth and the `monitor.level` params-leaf scope draws the same ramp.
   With MIDI available you hear the theme at 0.3 s/beat.
5. **Tweak the pane while it plays.** Tempo changes land at the next pass;
   velocity and gate are audible. The declaration reattached without
   resetting your saved values.
6. **Edit theme notes while it plays.** The next pass plays the edit — the
   GUI-authored and code-authored halves acting on each other.
7. **Run `sparkle variation`.** It ends naturally and `studio/theme-var`
   fills with a double-time, octave-up variation.
8. **Stop `performer`.** The marker disappears (ended signal), the playhead
   scope freezes and dims, and `monitor.level` parks at exactly 0 — the
   `stop()` hook's visible effect.

### C. Durable persistence: edit → save → mutate → re-open → verify

> A save captures **every** durable entity in server memory, not just this
> project's (the stores are process-global). Do this flow on a freshly
> started server so leftovers from other projects don't get added to this
> manifest. If strays land anyway, `git checkout` this directory and delete
> unexpected `data/` files.

9. **Edit.** Move a few theme notes and set tempo to 0.5. The topbar's
   unsaved pill counts the changed entities within ~2 s.
10. **Save.** Click **Save project**. Expect a `saved N` result line and the
    pill clearing. `git diff` shows the two `data/` files rewritten (new
    values plus `savedAt`) and the manifest's `data` list intact.
11. **Mutate without saving.** Delete a couple of theme notes and drag tempo
    to 0.15.
12. **Re-open.** Reload the page (same URL). Open adopts disk truth: the
    step-9 state is back (moved notes, tempo 0.5) and the step-11 mutations
    are gone.
13. **Live-object load semantics (optional).** Repeat step 11 while
    `performer` is running, then reload the page: the running module keeps
    playing and its next pass uses the **restored** notes/tempo — a load
    mutates the live objects in place.
14. **Restore the checked-in state** when done:
    `git checkout -- <this directory>`.

### D. Entity gestures and layout

15. **Duplicate as variation.** Select the theme view, click **Duplicate
    entity** (prefilled `studio/theme-copy`): a view of the copy appears with
    the same notes. Delete the copy entity afterwards (two-step confirm);
    its view stays as a placeholder until you delete the shape too.
16. **Layout persistence.** Move a module shape, a roll view, the pane, and a
    scope; wait a second; reload the page. Everything comes back where you put
    it (module records and all three canvas view arrays in the manifest).
    `git checkout` to discard.

## Expected-state notes

- Only an explicit save writes `data/`; code writes at any rate never touch
  disk, nothing auto-saves, and undo history is never serialized.
- Deleting an entity then saving drops its manifest `data` entry but leaves
  the old file on disk (manifest-only remove precedent).
- The playhead scope always restarts empty on reopen: signals are ephemeral
  by construction and are never part of `data/`.
