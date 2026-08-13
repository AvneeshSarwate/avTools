# feature-params-basics

Focused exercise of the `canvasParams` slice.

**Covers:** nested param groups (tweakpane folders), field meta (labels,
min/max/step bounds), a `graph: true` monitored field, a module that writes
params at ~30 Hz (code-driven automation), a module that reads params at loop
rate and publishes a derived ephemeral signal, the `/params/set` HTTP write
path, shared-declaration modules, and persisted param-pane + scope canvas
views.

## Opening it

Start the server (from `apps/deno-notebooks`):

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug
```

Start the client (from `apps/livecode-tldraw`): `npm run dev`, then open

```text
http://localhost:5173/?projectPath=<absolute path to this directory>
```

## Manual verification checklist

1. **Open.** Expect three code shapes (panel declaration, automation writer,
   loop-rate reader), one param pane, one scope. The pane shows a
   "waiting for `params-basics/panel`" placeholder and the scope waits too:
   this project deliberately ships no saved entity data, so the entity does
   not exist until a declaration runs (pre-launch panes are
   `feature-studio-combined`'s job).
2. **Run `automation writer`.** The pane populates: `osc` / `mix` / `monitor`
   folders, labeled sliders with the declared bounds (freq 0.1–8, amp 0–1,
   gain 0–1), and a readonly graph row under `monitor.level` drawing a sine.
   The `waitSec` line in the module shows the active-wait highlight.
3. **Run `loop-rate reader`.** The scope starts drawing
   `params-basics/derived` (level × gain).
4. **Edit params from the pane.** Drag `osc.freq` up: the graphed sine gets
   faster within a tick. Drag `osc.amp` and `mix.gain`: amplitude changes in
   the graph row and the scope respectively. The pane never fights you: only
   `monitor.level` is code-written.
5. **Toggle `mix.muted`.** The graph row freezes at its last value (the
   writer stops writing) and the scope trace pins to exactly 0 (the reader
   reads the flag at loop rate).
6. **Gutter widget.** In the `panel declaration` shape, click the
   `🎛 open params-basics/panel` widget: it selects/zooms the existing pane
   (or creates one if you deleted it).
7. **Stop both modules.** The derived signal ends: the scope dims its title
   and freezes the trace (a history view). The pane keeps showing the last
   values — the entity outlives the runs.
8. **Run `automation writer` again.** Values you tweaked are still there:
   declaration reattaches instead of resetting.
9. **HTTP write (agent surface).**

   ```sh
   curl -s localhost:7777/params/list | head -c 400
   curl -s -X POST localhost:7777/params/set -H 'content-type: application/json' \
     -d '{"name":"params-basics/panel","values":{"mix":{"gain":0.9}}}'
   ```

   The pane's gain slider follows the write.

## Expected-state notes

- Tweaked values survive module relaunches within one server process, but
  nothing here is saved to disk: a server restart resets the entity. Explicit
  save/restore is exercised in `feature-studio-combined`.
- Moving or resizing shapes in project mode writes layout back into
  `project.avtools-livecode.json` after a one-second debounce. That is the
  feature working; `git checkout` this directory if you did not mean to keep
  the new layout.
- `panel.orig.ts` is also runnable: its no-op root completes immediately
  (running → stopped with no Stop click), which is the documented data-module
  contract.
