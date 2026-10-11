import { P5GPU } from '../../../apps/deno-notebooks/tools/p5gpu.ts';
import { scenes, renderScene, persistence } from './scenes.ts';
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No Deno hardware WebGPU adapter');
const device = await adapter.requestDevice();
const errors: string[] = [];
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
const out = new URL('../artifacts/deno/', import.meta.url);
await Deno.mkdir(out, { recursive: true });
try {
  for (const sketch of scenes) {
    const p = new P5GPU(device, { width: sketch.width, height: sketch.height });
    try {
      if (sketch.name.startsWith('text')) {
        p.push();
        p.textFont('Inter'); p.textSize(24);
        if (p.textWidth('Dawn text') <= 0) throw new Error('Deno reference text engine unavailable');
        p.pop();
      }
      await Deno.writeFile(new URL(`${sketch.name}.rgba`, out), await renderScene(p, sketch));
    } finally { p.dispose(); }
  }
  const p = new P5GPU(device, { width: 64, height: 64 });
  try { await Deno.writeTextFile(new URL('persistence.json', out), JSON.stringify(await persistence(p))); }
  finally { p.dispose(); }
  await device.queue.onSubmittedWorkDone();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Deno rendered ${scenes.length} reference scenes and the persistence fixture`);
} finally { device.destroy(); }
