# feature-canvas-surface

Named canvases mirrored into tldraw shapes, for single-page demos: each module
draws into its own `canvasSurface(name)` (one with plain Canvas 2D, one with
p5), and a **canvas view** shape next to the code mirrors that canvas every
frame. This only works when the engine runs in the same tab as the UI
(`engine=inprocess`), which is what a bake opens by default.

The two examples are independent modules with no shared imports, and each one
has a `running` toggle in its params pane. That is the pattern for baked
example pages: a bake auto-launches every module once and cannot start, stop,
or relaunch them afterwards, so per-example start/stop has to be a parameter
the module's own loop honors.

## Bake and open (the intended form)

From `apps/livecode-tldraw`, `npm run build` once (the bake copies `dist/`).
Then from `apps/deno-notebooks`:

```sh
deno run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/feature-canvas-surface \
  --out /tmp/canvas-surface-bake
npx --yes serve /tmp/canvas-surface-bake   # any static file server
```

Open the served root URL. One tab boots the engine, launches both modules, and
shows their canvases in the two view shapes.

## Develop it live (optional)

With a server in `--engine remote` mode and `npm run dev`, open
`http://localhost:5173/?serverBaseUrl=http://localhost:7777&projectPath=<abs path>&engine=inprocess`.
Do not open an `/engine/` tab at the same time: this tab is the engine. Run
each module from its shape; the views fill in as the modules draw. Reloading
the page restarts the engine (runs and unsaved entities die), so this form is
for checking a demo, not for live-coding sessions.

## Manual verification

1. Both **canvas:** views show animation within a second of boot: a bouncing
   circle and a pulsing circle. The topbar pill reads **engine: this tab**.
2. Uncheck **running** in the bounce params pane. The bounce view freezes on
   its last frame; the pulse view keeps animating. Re-check it: it resumes.
3. Change **speed** and **radius**; the bounce reacts within a frame.
4. Resize a view shape. The canvas letterboxes; the source resolution does
   not change.
5. Delete a view shape and add it back with **Views → New canvas view**,
   typing the surface name. The mirror resumes; the module never noticed.
6. Open the same bake with `?serverBaseUrl=none&sync=broadcast&actions=broadcast`
   in one tab and `engine/engine.html` in another: the two-tab form still
   works, and the canvas views explain that they mirror only in-process.
