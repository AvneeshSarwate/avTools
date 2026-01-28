// demo.ts
import { configureFastSleep, fastSleep } from "../tools/fast_sleep.ts";

configureFastSleep({ nativeAccuracyUs: 200, strategy: "yield" });
// Try: strategy: "spin" if you want tighter jitter at higher CPU.

const iters = 20000;
const targetMs = 1;

const samplesUs: number[] = [];
for (let i = 0; i < iters; i++) {
  const t0 = performance.now();
  await fastSleep(targetMs);
  const dtMs = performance.now() - t0;
  samplesUs.push(dtMs * 1000);
}

samplesUs.sort((a, b) => a - b);

function pct(p: number) {
  const idx = Math.min(samplesUs.length - 1, Math.round((p / 100) * (samplesUs.length - 1)));
  return samplesUs[idx];
}

console.log(`iters=${iters}, target=${targetMs}ms`);
console.log(
  `min=${samplesUs[0].toFixed(3)}us med=${pct(50).toFixed(3)}us p95=${pct(95).toFixed(3)}us p99=${pct(99).toFixed(3)}us max=${samplesUs[samplesUs.length - 1].toFixed(3)}us`,
);
