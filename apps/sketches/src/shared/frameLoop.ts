// The page's one frame loop: a single core-timing branch that, every frame,
// runs the update callbacks and then the render callbacks, in that order,
// all with the frame's own time (ctx.time after waitFrame: the RAF tick time
// on the scheduler clock). Renderers draw synchronously here, so a frame
// never shows state from before its own update and nothing else (Konva's
// batchDraw, a second loop) schedules drawing on its own.
import { asBrowser, rootContext } from "./clock";

type FrameCallback = (time: number) => void;

const updates = new Set<FrameCallback>();
const renders = new Set<FrameCallback>();
let running = false;

function ensureRunning() {
  if (running) return;
  running = true;
  rootContext().branch(async (ctx) => {
    const frames = asBrowser(ctx);
    while (true) {
      await frames.waitFrame();
      const time = frames.time;
      for (const update of updates) update(time);
      for (const render of renders) render(time);
    }
  }, "frame loop");
}

/** Run every frame, before rendering (state, audio). Returns a remover. */
export function onUpdate(callback: FrameCallback): () => void {
  updates.add(callback);
  ensureRunning();
  return () => updates.delete(callback);
}

/** Run every frame, after the updates (drawing). Returns a remover. */
export function onRender(callback: FrameCallback): () => void {
  renders.add(callback);
  ensureRunning();
  return () => renders.delete(callback);
}
