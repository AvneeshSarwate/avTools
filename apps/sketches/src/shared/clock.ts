// One root TimeContext for the page. Every animation is a branch of it. The
// root waits on frames forever so its logical time stays at "now": branches
// start at root.mostRecentDescendentTime, which only advances on waits.
import { type BrowserTimeContext, launchBrowser, type TimeContext } from "@avtools/core-timing";

let root: BrowserTimeContext | null = null;

export function rootContext(): BrowserTimeContext {
  if (root) return root;
  launchBrowser(async (ctx) => {
    root = ctx;
    while (true) await ctx.waitFrame();
  }, { debugName: "sketches-root" });
  if (!root) throw new Error("launchBrowser did not start synchronously");
  return root;
}

/** Branches of a BrowserTimeContext are BrowserTimeContexts (branch keeps the prototype). */
export function asBrowser(ctx: TimeContext): BrowserTimeContext {
  return ctx as BrowserTimeContext;
}
