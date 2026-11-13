# feature-signals-and-scopes

Focused exercise of the ephemeral-signal tier and its monitors.

**Covers:** one playhead signal sent to TWO piano-roll anchors, TWO modules
publishing playheads against one melody (multi-marker, using both accepted
marker value shapes: a bare number and `{ position }`), a plain numeric signal
for a scope, persisted scope views, sticky `ended` semantics, and checked-in
piano-roll data restored on open.

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

1. **Open.** The `signals/groove` and `signals/groove-mirror` roll views each
   show six notes **immediately**, before any module has run. Both scopes show
   waiting placeholders because signals are ephemeral.
2. **Run `playhead walker`.** One labeled marker sweeps forward across the
   two roll views in lockstep, demonstrating one signal with two anchors. The
   `signals/walker` scope draws a rising sawtooth.
3. **Run `reverse strider`.** A second labeled marker walks **backward** at
   half speed on the same roll. Two distinguishable markers on one melody,
   one publishing a bare number, the other `{ position: n }`.
4. **Stop `playhead walker`.** Its marker disappears from both rolls; the
   strider's marker keeps moving on `signals/groove`. The walker's scope freezes
   its trace and dims its title.
5. **Run `numeric lfo`.** The lfo scope draws a slow sine (~5 s period). The
   trace is the transport's ~10 Hz conflated view of a 20 Hz publisher —
   that stair-stepping is by design.
6. **Reload the browser tab while modules run.** Markers and traces resume
   from server truth after reconnect; each scope's history restarts from the
   moment it remounted (ring buffers are view-side and never persisted).
7. **Signal widget.** In `playhead walker`, click the `📈` just inside
   `signal(`. It selects the existing `signals/walker` scope; after deleting
   that scope, clicking again recreates it beside the module.
8. **New scope from Add.** Open **Add → New scope**. Its datalist offers every
   live signal and suffixes ended ones with `(ended)`. Bind a new scope to
   `signals/strider` — a non-numeric object value renders the unsupported
   placeholder, which is the honest v1 behavior for non-numeric signals.
9. **Stop everything.** All three signals list as ended
   (`curl -s localhost:7777/signals/list`) until a relaunch redeclares them.

## Expected-state notes

- Signals are never persisted: reopening this project always starts the
  scopes waiting until modules publish again. Both rolls are durable fixtures.
- Marker positions are quarter notes in the component's own coordinate
  system; the platform never knows why a position moves.
- Editing groove notes changes only server memory. An explicit
  **Save project** would write them back to the data file — but note a save
  captures every durable entity in the process, so do save-flow testing on a
  fresh server (see `feature-studio-combined`).
- Layout/binding changes to views write back to the manifest after a
  one-second debounce; `git checkout` this directory to discard them.
