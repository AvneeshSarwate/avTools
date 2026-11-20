// One AudioContext, one analyser tap, three interchangeable instruments.
import { SixSinesNode } from "../../../../packages/six-sines/six-sines-node.js";
import type { Patch } from "./patch";
import { patchToSixSines } from "./sixSinesMap";

export interface Instrument {
  noteOn(key: number, velocity: number): void;
  noteOff(key: number): void;
  panic(): void;
}

let context: AudioContext | undefined;
let master: GainNode | undefined;
let analyser: AnalyserNode | undefined;

export function audio() {
  if (!context) {
    context = new AudioContext({ latencyHint: "interactive" });
    master = context.createGain();
    master.gain.value = 0.5;
    analyser = context.createAnalyser();
    analyser.fftSize = 16384;
    analyser.smoothingTimeConstant = 0.6;
    master.connect(analyser);
    analyser.connect(context.destination);
  }
  return { context, master: master!, analyser: analyser! };
}

/** RMS of the current output, for the test script. */
export function outputLevel() {
  const data = new Float32Array(2048);
  audio().analyser.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
}

export function resume() {
  void audio().context.resume();
}

export const keyToHz = (key: number) => 440 * Math.pow(2, (key - 69) / 12);

// ---------------------------------------------------------------------------
// 1. Native Web Audio: two OscillatorNodes and a GainNode per voice.

export interface NativeFmParams {
  /** Modulator frequency as a multiple of the note, unless `modHz` is set. */
  ratio: number;
  /** Fixed modulator frequency in Hz (lesson 0 sweeps this through LFO range). */
  modHz?: number;
  /** Modulation index. Deviation in Hz is index x modulator frequency. */
  index: number;
  /** When set, the deviation is this many Hz at every pitch (uncompensated FM). */
  deviationHz?: number;
  /** Seconds for the index to fall to `indexSustain` of its peak; 0 holds it. */
  indexDecay: number;
  indexSustain: number;
  attack: number;
  release: number;
}

let cosine: PeriodicWave | undefined;

interface NativeVoice {
  carrier: OscillatorNode;
  modulator: OscillatorNode;
  deviation: GainNode;
  amp: GainNode;
  f0: number;
}

export class NativeFm implements Instrument {
  private voices = new Map<number, NativeVoice>();
  constructor(private params: NativeFmParams) {}

  private modHz(f0: number) {
    return this.params.modHz ?? f0 * this.params.ratio;
  }

  private peakDeviation(f0: number) {
    return this.params.deviationHz ?? this.params.index * this.modHz(f0);
  }

  noteOn(key: number, velocity: number) {
    this.noteOff(key);
    const { context, master } = audio();
    const now = context.currentTime;
    const f0 = keyToHz(key);
    const p = this.params;

    const carrier = new OscillatorNode(context, { frequency: f0 });
    // A cosine modulator: integrating it gives a sine-shaped phase swing, so
    // the result is exactly sin(ct + I sin(mt)), the textbook form.
    cosine ??= context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
    const modulator = new OscillatorNode(context, { frequency: this.modHz(f0), periodicWave: cosine, type: "custom" });
    const deviation = new GainNode(context, { gain: this.peakDeviation(f0) });
    const amp = new GainNode(context, { gain: 0 });

    // The whole instrument: the modulator's output, scaled to hertz, is added
    // to the carrier's frequency.
    modulator.connect(deviation).connect(carrier.frequency);
    carrier.connect(amp).connect(master);

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.35 * (0.6 + 0.4 * velocity), now + Math.max(p.attack, 0.003));
    if (p.indexDecay > 0) {
      deviation.gain.setTargetAtTime(this.peakDeviation(f0) * p.indexSustain, now, p.indexDecay / 5);
    }
    carrier.start(now);
    modulator.start(now);
    this.voices.set(key, { carrier, modulator, deviation, amp, f0 });
  }

  noteOff(key: number) {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.voices.delete(key);
    const { context } = audio();
    const now = context.currentTime;
    const release = Math.max(this.params.release, 0.01);
    voice.amp.gain.cancelScheduledValues(now);
    voice.amp.gain.setTargetAtTime(0, now, release / 5);
    voice.carrier.stop(now + release * 1.5);
    voice.modulator.stop(now + release * 1.5);
  }

  /** Slider moves reach the sounding voices straight away. */
  update(params: NativeFmParams) {
    this.params = params;
    const now = audio().context.currentTime;
    for (const voice of this.voices.values()) {
      voice.modulator.frequency.setTargetAtTime(this.modHz(voice.f0), now, 0.01);
      if (params.indexDecay <= 0) voice.deviation.gain.setTargetAtTime(this.peakDeviation(voice.f0), now, 0.01);
    }
  }

  panic() {
    for (const key of [...this.voices.keys()]) this.noteOff(key);
  }
}

// ---------------------------------------------------------------------------
// 2. The operator worklet (public/operators.worklet.js).

let operatorsLoaded: Promise<void> | undefined;

export class Operators implements Instrument {
  private node?: AudioWorkletNode;
  private pending: unknown[] = [];

  constructor(private patch: Patch) {
    const { context, master } = audio();
    operatorsLoaded ??= context.audioWorklet.addModule(new URL("operators.worklet.js", document.baseURI));
    void operatorsLoaded.then(() => {
      this.node = new AudioWorkletNode(context, "operators", { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(master);
      this.post({ type: "patch", patch: this.patch });
      for (const message of this.pending) this.node.port.postMessage(message);
      this.pending = [];
    });
  }

  private post(message: unknown) {
    if (this.node) this.node.port.postMessage(message);
    else this.pending.push(message);
  }

  update(patch: Patch) {
    this.patch = patch;
    this.post({ type: "patch", patch });
  }

  noteOn(key: number, velocity: number) {
    this.post({ type: "noteOn", key, velocity });
  }

  noteOff(key: number) {
    this.post({ type: "noteOff", key });
  }

  panic() {
    this.post({ type: "panic" });
  }

  dispose() {
    this.panic();
    const node = this.node;
    if (node) setTimeout(() => node.disconnect(), 100);
  }
}

// ---------------------------------------------------------------------------
// 3. Six Sines. One shared engine; lessons either translate a patch into its
//    parameters or load a factory preset.

const assets = () => new URL("./six-sines-ui/", document.baseURI);
let sixNode: Promise<SixSinesNode> | undefined;
let initPreset: Promise<ArrayBuffer> | undefined;
let sixGain: GainNode | undefined;
const TRANSLATED_MAKEUP = 8;
const PRESET_MAKEUP = 2.2;

function sixSines() {
  const { context, master } = audio();
  sixNode ??= SixSinesNode.create(context, {
    workletUrl: new URL("six-sines-worklet.js", assets()),
    wasmUrl: new URL("six-sines.wasm", assets()),
    presetUrl: new URL("init.sxsnp", assets()),
  }).then((node) => {
    // Six Sines runs well below the raw engines; this makeup gain keeps the
    // A/B switch level. Set per load: translated patches need more than presets.
    sixGain = context.createGain();
    sixGain.gain.value = 1;
    node.connect(sixGain);
    sixGain.connect(master);
    return node;
  });
  return sixNode;
}

export async function fetchPresetText(path: string) {
  const response = await fetch(new URL(path, assets()));
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.text();
}

export class SixSines implements Instrument {
  private queue: Promise<unknown> = Promise.resolve();
  private current = new Map<number, number>();
  private noteIds = new Map<number, number>();
  private nextId = 1;
  ready = false;
  onReady?: () => void;

  private run(task: (node: SixSinesNode) => Promise<unknown> | unknown) {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => task(await sixSines()))
      .catch((error) => console.error("[Six Sines]", error));
    return this.queue;
  }

  /** Reset to the init preset, then apply a parameter set. */
  loadParams(params: Map<number, number>) {
    this.ready = false;
    void this.run(async (node) => {
      initPreset ??= fetch(new URL("init.sxsnp", assets())).then((r) => r.arrayBuffer());
      await node.allNotesOff();
      await node.loadPreset((await initPreset).slice(0));
      for (const [paramId, value] of params) await node.paramValue({ paramId, value });
      if (sixGain) sixGain.gain.value = TRANSLATED_MAKEUP;
      this.current = new Map(params);
      this.ready = true;
      this.onReady?.();
    });
  }

  loadPatch(patch: Patch) {
    this.loadParams(patchToSixSines(patch));
  }

  /** Load a factory preset from its text, then apply overrides. */
  loadPreset(text: string, overrides = new Map<number, number>()) {
    this.ready = false;
    void this.run(async (node) => {
      await node.allNotesOff();
      await node.loadPreset(new TextEncoder().encode(text));
      for (const [paramId, value] of overrides) await node.paramValue({ paramId, value });
      if (sixGain) sixGain.gain.value = PRESET_MAKEUP;
      this.current = new Map(overrides);
      this.ready = true;
      this.onReady?.();
    });
  }

  /** Send only the parameters that changed since the last call. */
  setParams(params: Map<number, number>) {
    const changed = [...params].filter(([id, value]) => this.current.get(id) !== value);
    if (!changed.length) return;
    for (const [id, value] of changed) this.current.set(id, value);
    void this.run(async (node) => {
      for (const [paramId, value] of changed) await node.paramValue({ paramId, value });
    });
  }

  updatePatch(patch: Patch) {
    this.setParams(patchToSixSines(patch));
  }

  noteOn(key: number, velocity: number) {
    this.noteOff(key);
    const noteId = this.nextId++;
    this.noteIds.set(key, noteId);
    void this.run((node) => node.noteOn({ noteId, key, velocity, channel: 0, port: 0 }));
  }

  noteOff(key: number) {
    const noteId = this.noteIds.get(key);
    if (noteId === undefined) return;
    this.noteIds.delete(key);
    void this.run((node) => node.noteOff({ noteId, key, velocity: 0, channel: 0, port: 0 }));
  }

  panic() {
    this.noteIds.clear();
    void this.run((node) => node.allNotesOff());
  }
}
