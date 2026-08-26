# browser-p5-animation

Graphics in the browser engine: a p5.js sketch (instance mode) draws into the
engine tab's `#livecode-stage`, animated from an animation-timeline entity you
edit on the canvas. Exercises the engine-tab import map (`p5` from a module),
the stage container, cross-module shared state, and timeline sampling with a
playhead signal.

## Opening it

This project is browser-engine only (`engineTarget: "browser"`): the sketch
needs the engine tab's DOM. From the projects index page, open it with
**engine in browser** — or start the server with `--engine remote`, open
`/engine/`, then the UI with this directory as `projectPath`.

## Flow

1. **Run `shared state`** (optional — the other modules import it either way).
2. **Run `p5 sketch`.** A 480x360 canvas appears in the ENGINE tab (not the
   tldraw canvas) with a circle sitting at center.
3. **Run `animation player`.** The circle traces the x/y curves on a 4-second
   loop, and the animation editor's playhead sweeps in sync.
4. **Edit the curves** in the animation editor while the player runs: the
   motion changes at the next sample (~1/60 s).
5. **Replace/Stop.** Replacing the sketch disposes and recreates the canvas
   (its `stop()` hook removes the p5 instance); stopping the player freezes
   the circle where it is.

Running it engine-on-server fails at import (`document` does not exist) —
that is the expected compatibility behavior, not a bug.
