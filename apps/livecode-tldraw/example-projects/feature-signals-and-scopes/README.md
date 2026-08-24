# feature-signals-and-scopes

Focused exercise of the ephemeral-signal tier and its monitors.

**Covers:** a playhead signal anchored to a piano roll, TWO modules
publishing playheads against ONE melody (multi-marker, using both accepted
marker value shapes: a bare number and `{ position }`), a plain numeric
signal for a scope, persisted scope views in the project canvas, sticky
`ended` semantics, and a checked-in piano-roll data file restored on open
(with a percent-encoded filename: `signals/groove` →
`data/pianoRoll/signals%2Fgroove.json`).

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

1. **Open.** The `signals/groove` roll view shows six notes **immediately**,
   before any module has run — restored from the checked-in data file listed
   in the manifest's `data` entries. Both scopes show waiting placeholders
   (signals are ephemeral; nothing is publishing yet).
2. **Run `playhead walker`.** One labeled marker sweeps forward across the
   groove view, looping every ~2 s. The `signals/walker` scope draws a
   rising sawtooth.
3. **Run `reverse strider`.** A second labeled marker walks **backward** at
   half speed on the same roll. Two distinguishable markers on one melody,
   one publishing a bare number, the other `{ position: n }`.
4. **Stop `playhead walker`.** Its marker **disappears** (an ended playhead
   renders nothing rather than freezing in place); the strider's marker keeps
   moving. The walker's scope, in contrast, **freezes its trace and dims its
   title** — a scope is a history view, so the last trace stays worth
   looking at.
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
  scopes waiting until modules publish again. Only the groove roll is in
  `data/`.
- Marker positions are quarter notes in the component's own coordinate
  system; the platform never knows why a position moves.
- Editing groove notes changes only server memory. An explicit
  **Save project** would write them back to the data file — but note a save
  captures every durable entity in the process, so do save-flow testing on a
  fresh server (see `feature-studio-combined`).
- Layout/binding changes to views write back to the manifest after a
  one-second debounce; `git checkout` this directory to discard them.
