# feature-lifecycle-basics

Focused exercise of module lifecycle: natural completion, Replace, and the
graceful-stop hook.

**Covers:** a finite module that ends naturally (running → stopped with no
Stop click), an infinite module for Replace-while-running (with observable
state continuity across the swap), a module whose exported `stop()` hook has
a pane-visible effect, launch refusal without explicit replacement consent,
and persisted param-pane views.

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

1. **Open.** Three code shapes and two param panes (both waiting — the
   entities appear at first run).
2. **Natural completion.** Run `finite (ends naturally)`: the wait highlight
   steps through four half-second beats (console logs `beat n/4`), then the
   status returns to stopped on its own after ~2 s. No Stop click. Its header
   reads `runs: 1`; run it again and verify `runs: 2` — every run is a fresh
   pass.
3. **Run `steady (Replace me)`.** The `lifecycle/steady` pane appears:
   `heartbeat` counts up four times a second and `lastLaunch` shows this
   run's timestamp.
4. **Replace while running.** Note the current heartbeat. Edit the running
   source — change `waitSec(0.25)` to `waitSec(0.1)` — and watch the Run
   button read **Replace**. Click it. Verify:
   - the heartbeat **speeds up** (new code is running),
   - it **continues from where it was** rather than resetting (the entity
     reattaches; values survive replacement),
   - `lastLaunch` re-stamps (the new run announced itself),
   - the module's `runs` count increments for the replacement,
   - Stop was never pressed, and the other modules were untouched.
5. **No-surprise launch (agent surface).** While steady runs, a raw launch
   without consent is refused:

   ```sh
   curl -s localhost:7777/runtime/status
   ```

   shows it active, and a second launch of the same module id over HTTP
   without `replaceRunning: true` returns 409 (the checked-in
   `verify-feature-projects.ts` runner asserts exactly this).
6. **Observable stop hook.** Run `cleanup (stop hook)`: `ticks` counts in the
   `lifecycle/cleanup` pane. Press **Stop**. `stops` increments to 1 and
   `lastStop` gets a timestamp — the exported `stop()` ran during the
   graceful stop and its write outlived the run. The server console shows
   `cleanup stop() ran`.
7. **Panic skips hooks (optional).** Run `cleanup` again, then:

   ```sh
   curl -s -X POST localhost:7777/runtime/panic -d '{}'
   ```

   The module stops but `stops` does **not** increment: panic deliberately
   skips stop hooks. (This also panics MIDI and stops every other module.)
8. **Stop `steady`.** Both panes keep their final values — entities outlive
   the runs that fed them.

## Expected-state notes

- This project intentionally has no `data/` tree: heartbeat/ticks survive
  relaunches within one server process but reset with the server. Durable
  save/restore is `feature-studio-combined`'s job.
- Replace is the only client gesture that sets `replaceRunning`; Run on an
  idle module never replaces anything.
- Layout changes write back to the manifest after a one-second debounce;
  `git checkout` this directory to discard them.
