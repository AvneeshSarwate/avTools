import {createMIDI} from './td-midi.ts';
import {createIO} from './td-io.ts';
import {parameterSnapshot} from './td-parameters.ts';
import {SketchLifetime} from './td-timing.ts';
import type {ChopHost as PublicChopHost, ChopFrame} from '../td-chop.d.ts';
// Source-side timing classes carry private members; the SDK uses emitted declarations.
// Keep implementation checking against the original classes, not a second nominal copy.
type ChopHost = Omit<PublicChopHost, 'timing'> & { readonly timing: typeof import('../../core-timing/mod.ts') };
const g = globalThis as any;
type Program = {setup?: (host: ChopHost) => unknown; onCook?: (host: ChopHost, frame: ChopFrame) => unknown; onPulse?: (name: string, host: ChopHost) => unknown};
type Generation = {signature: string; life: SketchLifetime; host: ChopHost; program: Program; values: Map<string, Float32Array>};
let active: Generation | undefined;
let inputs: Map<string, Float32Array>[] = [];
let frame: ChopFrame;
let params = parameterSnapshot({});
let names: string[] = [], pulses: string[] = [], reset = false;
let sampleCount = 1;
const message = (error: any) => String(error?.stack ?? error);
const synchronous = (value: any, name: string) => {
  if (value && typeof value.then === 'function') { Promise.resolve(value).catch(() => {}); throw Error(`${name} must be synchronous; use TimeContext for independent tasks`); }
};
g.__avChopDirty = false;
g.__avDone = true; g.__avError = ''; g.__avHasFrame = false;
g.__avChopAccept = () => {
  const incoming = JSON.parse(g.__avFrameJSON);
  const data = new Float32Array(g.__avData.buffer, g.__avData.byteOffset, g.__avData.byteLength / 4);
  const next = Array.from({length: 4}, () => new Map<string, Float32Array>());
  for (const c of incoming.channels) next[c.input].set(c.name, data.subarray(c.offset, c.offset + c.count));
  inputs = next; names = incoming.names; pulses = incoming.pulses; reset = !!incoming.reset; sampleCount = incoming.outputSamples;
  params = parameterSnapshot(incoming.params);
  frame = Object.freeze({frame: incoming.frame, absFrame: incoming.absFrame, rate: incoming.rate, deltaSeconds: incoming.deltaSeconds, time: (incoming.frame - 1) / incoming.rate});
  g.__avData = null;
};
function createGeneration(): Generation {
  const life = new SketchLifetime();
  const count = sampleCount;
  const values = new Map(names.map(name => [name, new Float32Array(count)]));
  const outputChannel = (name: string) => {
    const data = values.get(name);
    if (!data) throw Error(`Unknown output channel '${name}'; add it to Output Channels`);
    return data;
  };
  const finite = (name: string, value: number) => {
    if (typeof value !== 'number' || !Number.isFinite(Math.fround(value))) throw Error(`Output '${name}' must be a finite float32 number`);
    return Math.fround(value);
  };
  const host: ChopHost = Object.freeze({
    ...createIO(life), midi: createMIDI(life),
    get params() { return params; },
    timing: life.timing,
    inputs: Object.freeze({
      get: (name: string, input = 0, sample?: number) => life.run(() => { const data = inputs[input]?.get(name); return data?.[sample ?? data.length - 1] ?? 0; }),
      samples: (name: string, input = 0) => life.run(() => inputs[input]?.get(name)?.slice() ?? new Float32Array()),
      names: (input = 0) => life.run(() => [...(inputs[input]?.keys() ?? [])]),
    }),
    outputs: Object.freeze({
      sampleCount: count,
      set: (name: string, value: number, sample = 0) => life.run(() => {
        const data = outputChannel(name);
        if (!Number.isInteger(sample) || sample < 0 || sample >= count) throw Error('Output sample index out of range');
        const next = finite(name, value);
        if (data[sample] !== next) { data[sample] = next; g.__avChopDirty = true; }
      }),
      get: (name: string, sample = 0) => life.run(() => values.get(name)?.[sample] ?? 0),
      samples: (name: string) => life.run(() => values.get(name)?.slice() ?? new Float32Array()),
      setSamples: (name: string, source: ArrayLike<number>) => life.run(() => {
        const data = outputChannel(name);
        if (!source || source.length !== count) throw Error(`Output '${name}' needs exactly ${count} samples`);
        // Stage validation before modifying persistent state. The caller retains
        // its own buffer and can safely reuse it after this call.
        const next = new Float32Array(count);
        for (let i = 0; i < count; i++) next[i] = finite(name, source[i]);
        data.set(next); g.__avChopDirty = true;
      }),
      names: () => life.run(() => [...values.keys()]),
    }),
    onDispose: (fn: () => void) => life.onDispose(fn),
  });
  return {signature: JSON.stringify([names, sampleCount]), life, host, values, program: {}};
}
g.__avChopCook = async () => {
  g.__avDone = false; g.__avError = ''; g.__avHasFrame = false;
  try {
    const signature = JSON.stringify([names, sampleCount]);
    if (!active) {
      active = createGeneration();
      active.program = active.life.run(() => new Function(`${g.__avSource}\n;return {setup:typeof setup==='function'?setup:undefined,onCook:typeof onCook==='function'?onCook:undefined,onPulse:typeof onPulse==='function'?onPulse:undefined};`)());
      if (!active.program.setup && !active.program.onCook) throw Error('CHOP script must define setup(host) or onCook(host, frame)');
      await active.life.run(() => active!.program.setup?.(active!.host));
      if (active.life.error) throw Error(active.life.error);
    }
    const current = active;
    if (current.life.error) throw Error(current.life.error);
    if (g.__avBackgroundError) throw Error(g.__avBackgroundError);
    // Existing waitFrame tasks resume against the input snapshot accepted above.
    await g.__hostFrame();
    if (current.life.error) throw Error(current.life.error);
    try {
      for (const name of pulses) synchronous(current.life.run(() => current.program.onPulse?.(name, current.host)), 'onPulse');
      synchronous(current.life.run(() => current.program.onCook?.(current.host, frame)), 'onCook');
      snapshot(current);
    } catch (error) { current.life.fail(error); throw error; }
  } catch (error) { active?.life.fail(error); g.__avError = message(error); }
  finally { g.__avDone = true; }
};
function snapshot(current: Generation) {
  const output = new Float32Array(names.length * sampleCount);
  names.forEach((name, index) => {
    const data = current.values.get(name);
    if (data) output.set(data.subarray(0, sampleCount), index * sampleCount);
  });
  g.__avBytes = new Uint8Array(output.buffer); g.__avHasFrame = true; g.__avChopDirty = false;
}
// Native worker calls this only between bounded event-loop turns, never inside
// a synchronous callback or while an async setup/reload is incomplete.
g.__avChopFlush = () => {
  g.__avHasFrame = false;
  if (!active || !g.__avDone || active.signature !== JSON.stringify([names, sampleCount])) return;
  if (active.life.error || g.__avBackgroundError) { g.__avError = active.life.error || g.__avBackgroundError; return; }
  if (g.__avChopDirty) snapshot(active);
};
g.__avDispose = () => { g.__avDone = false; try { active?.life.dispose(); active = undefined; } finally { g.__avDone = true; } };
