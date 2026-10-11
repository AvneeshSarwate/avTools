import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createLivecodeEngine } from './build/engine.js';
import { createGPU, P5GPU, GPUWindow } from '@avtools/native-webgpu';

/** A local JavaScript sketch host using the existing engine's launch/stop lifecycle. */
export async function createNodeHost({ width = 640, height = 480, preview = false,
  log = entry => console.log(JSON.stringify(entry)), onSyncTick = () => {}, onFrame = () => {} } = {}) {
  const gpu = createGPU();
  const adapter = await gpu.requestAdapter();
  if (!adapter || adapter.info.isFallbackAdapter) throw new Error('A hardware Metal adapter is required');
  const device = await adapter.requestDevice();
  let closing = false;
  device.addEventListener('uncapturederror', event => log({ type: 'gpuError', message: event.error.message }));
  device.lost.then(info => { if (!closing) log({ type: 'deviceLost', reason: info.reason, message: info.message }); });
  const resources = new Set();
  const engine = createLivecodeEngine({ log, onSyncTick, seedDemoRoll: false,
    async importModule(url) {
      const sketch = await import(url);
      const run = sketch.runFunc ?? sketch.default;
      if (typeof run !== 'function') throw new Error('Sketch must export default or runFunc(ctx, host)');
      return { stop: sketch.stop, async runFunc(ctx) {
        const p = new P5GPU(device, { width, height });
        let window;
        let disposed = false;
        const resource = { dispose() {
          if (disposed) return;
          disposed = true; window?.dispose(); p.dispose(); resources.delete(resource);
        } };
        resources.add(resource);
        try {
          if (preview) window = new GPUWindow(device, { width, height, title: 'avTools Node' });
          const host = { p, device, window, present() {
            if (disposed) throw new Error('Sketch resources have been disposed');
            onFrame(p.outputTexture, p);
            return window?.show(p.outputTexture) ?? false;
          } };
          await run(ctx, host);
        } finally { resource.dispose(); }
      } };
    },
  });
  let closePromise;
  return { device, engine,
    launch(path, { moduleId = 'sketch', replaceRunning = true } = {}) {
      const transformedModuleUri = pathToFileURL(resolve(path)).href;
      return engine.launchModule({ moduleId, transformedModuleUri, generatedRunId: randomUUID(), replaceRunning });
    },
    close() {
      return closePromise ??= (async () => {
        closing = true;
        try { await engine.close(); await device.queue.onSubmittedWorkDone(); }
        finally { for (const resource of resources) resource.dispose(); device.destroy(); }
      })();
    },
  };
}
