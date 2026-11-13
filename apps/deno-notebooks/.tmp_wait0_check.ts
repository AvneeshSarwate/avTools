import { launch } from "@avtools/core-timing";

// Does a wait(0) hot loop in branch A starve branch B's normal waits?
let aIterations = 0;
const bStamps: number[] = [];
let stopA = false;

const handle = launch(async (ctx) => {
  ctx.branch(async (a) => {
    while (!stopA) {
      await a.wait(0);
      aIterations++;
    }
  });
  await ctx.branchWait(async (b) => {
    for (let i = 0; i < 8; i++) {
      await b.waitSec(0.05);
      bStamps.push(performance.now());
    }
  });
  stopA = true;
});

const started = performance.now();
await handle;
const total = performance.now() - started;

const gaps = bStamps.slice(1).map((t, i) => Math.round(t - bStamps[i]));
console.log(JSON.stringify({
  aIterations,
  bFired: bStamps.length,
  bGapsMs: gaps,
  totalMs: Math.round(total),
}));
Deno.exit(0);
