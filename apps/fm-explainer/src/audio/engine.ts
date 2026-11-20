// One AudioContext, one analyser tap, three interchangeable instruments.
import { SixSinesEventType, SixSinesNode } from "../../../../packages/six-sines/six-sines-node.js";
import type { Patch } from "./patch";

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
// 2. The operator worklet (public/operators.worklet.js). One node for the
//    whole page; lessons hand it a patch.

class OperatorsEngine implements Instrument {
  private node?: AudioWorkletNode;
  private starting?: Promise<void>;
  private pending: unknown[] = [];

  /** Load the worklet and build the node. Safe to call early and often. */
  warm() {
    const { context, master } = audio();
    this.starting ??= context.audioWorklet
      .addModule(new URL("operators.worklet.js", document.baseURI))
      .then(() => {
        this.node = new AudioWorkletNode(context, "operators", { numberOfInputs: 0, outputChannelCount: [2] });
        this.node.connect(master);
        for (const message of this.pending) this.node.port.postMessage(message);
        this.pending = [];
      });
    return this.starting;
  }

  private post(message: unknown) {
    if (this.node) this.node.port.postMessage(message);
    else {
      this.pending.push(message);
      void this.warm();
    }
  }

  update(patch: Patch) {
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
}

export const operators = new OperatorsEngine();

// ---------------------------------------------------------------------------
// 3. Six Sines. One engine for the whole page. It remembers which preset it
//    was last given and every parameter sent since, so showing a patch only
//    sends what differs from what the engine already holds.

const assets = () => new URL("./six-sines-ui/", document.baseURI);
export const sixSinesAssetBase = () => assets().href;

const textCache = new Map<string, Promise<string>>();

/** Preset files are fetched once per page. */
export function fetchPresetText(path: string) {
  let text = textCache.get(path);
  if (!text) {
    text = fetch(new URL(path, assets())).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${path}`);
      return response.text();
    });
    text.catch(() => textCache.delete(path));
    textCache.set(path, text);
  }
  return text;
}

const INIT_PATH = "init.sxsnp";
const TRANSLATED_MAKEUP = 8;
const PRESET_MAKEUP = 2.2;
/** The worklet takes up to 256 events per render quantum. */
const EVENTS_PER_SEND = 200;

function presetValues(text: string) {
  const values = new Map<number, number>();
  for (const m of text.matchAll(/<p id="(\d+)" v="([-\d.e]+)"/g)) values.set(Number(m[1]), Number(m[2]));
  return values;
}

export interface SixSinesShow {
  /** Identifies the lesson step. Tweaks made in the editor last until this changes. */
  key: string;
  /** Preset file under the asset base; the init preset when omitted. */
  presetPath?: string;
  /** Parameters to hold on top of that preset. */
  params: Map<number, number>;
}

export type SixSinesListener = (
  event: { kind: "preset"; text: string } | { kind: "params"; changes: { id: number; value: number }[] },
) => void;

class SixSinesEngine implements Instrument {
  private node?: Promise<SixSinesNode>;
  private gain?: GainNode;
  private queue: Promise<unknown> = Promise.resolve();
  /** What the engine holds: the preset last loaded into it, and every parameter sent since. */
  private baseText: string | null = null;
  private baseValues = new Map<number, number>();
  private sent = new Map<number, number>();
  /** What the current step asked for, and what the editor changed on top. */
  private key = "";
  private wanted = new Map<number, number>();
  private manual = new Map<number, number>();
  /** A preset the user picked in the editor, standing in for the step's own until the step changes. */
  private userPreset: string | null = null;
  private noteIds = new Map<number, number>();
  private nextId = 1;
  private listeners = new Set<SixSinesListener>();
  /** True once the node exists; the first show() waits for it, later ones do not. */
  ready = false;

  /** Fetch the wasm, build the node and read the init preset. Safe to call early and often. */
  warm() {
    if (!this.node) {
      const { context, master } = audio();
      void fetchPresetText(INIT_PATH);
      this.node = SixSinesNode.create(context, {
        workletUrl: new URL("six-sines-worklet.js", assets()),
        wasmUrl: new URL("six-sines.wasm", assets()),
        presetUrl: new URL(INIT_PATH, assets()),
      }).then(async (node) => {
        this.gain = context.createGain();
        node.connect(this.gain);
        this.gain.connect(master);
        // The node starts on the init preset.
        this.baseText = await fetchPresetText(INIT_PATH);
        this.baseValues = presetValues(this.baseText);
        this.ready = true;
        return node;
      });
      this.node.catch((error) => {
        console.error("[Six Sines]", error);
        this.node = undefined;
      });
    }
    return this.node;
  }

  private run(task: (node: SixSinesNode) => Promise<unknown> | unknown) {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => task(await this.warm()))
      .catch((error) => console.error("[Six Sines]", error));
    return this.queue;
  }

  subscribe(listener: SixSinesListener) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(event: Parameters<SixSinesListener>[0]) {
    for (const listener of this.listeners) listener(event);
  }

  /** The preset text and parameter values the engine holds now, for an editor that has just opened. */
  snapshot() {
    return { text: this.baseText, params: [...this.sent].map(([id, value]) => ({ id, value })) };
  }

  /**
   * Make the engine hold a preset plus a set of parameters. Resolves when it
   * does. Only differences from what it already holds are sent, so calling
   * this with what is already there costs nothing.
   */
  show({ key, presetPath, params }: SixSinesShow) {
    if (key !== this.key) {
      this.key = key;
      this.manual.clear();
      this.userPreset = null;
      this.wanted = new Map();
    }
    // A parameter the step itself has just changed overrides an editor tweak to it.
    for (const [id, value] of params) if (this.wanted.get(id) !== value) this.manual.delete(id);
    this.wanted = new Map(params);
    return this.run(async (node) => {
      const text = this.userPreset ?? (await fetchPresetText(presetPath ?? INIT_PATH));
      await this.reconcile(node, text, presetPath ? PRESET_MAKEUP : TRANSLATED_MAKEUP);
    });
  }

  private async reconcile(node: SixSinesNode, text: string, makeup: number) {
    const target = new Map([...this.wanted, ...this.manual]);
    // Parameters sent earlier that are no longer wanted go back to the preset's
    // value. If the preset file does not list one, reload the preset instead.
    const stale = [...this.sent.keys()].filter((id) => !target.has(id));
    const reload = text !== this.baseText || stale.some((id) => !this.baseValues.has(id));
    if (reload) {
      await node.allNotesOff();
      this.noteIds.clear();
      await node.loadPreset(new TextEncoder().encode(text));
      this.baseText = text;
      this.baseValues = presetValues(text);
      this.sent.clear();
      this.emit({ kind: "preset", text });
    }
    const changes: { id: number; value: number }[] = [];
    for (const id of this.sent.keys()) {
      if (!target.has(id)) {
        changes.push({ id, value: this.baseValues.get(id)! });
        this.sent.delete(id);
      }
    }
    for (const [id, value] of target) {
      if ((this.sent.get(id) ?? this.baseValues.get(id)) !== value) {
        changes.push({ id, value });
        this.sent.set(id, value);
      }
    }
    if (this.gain) this.gain.gain.value = makeup;
    await this.sendParams(node, changes);
    if (changes.length) this.emit({ kind: "params", changes });
  }

  private async sendParams(node: SixSinesNode, changes: { id: number; value: number }[]) {
    for (let i = 0; i < changes.length; i += EVENTS_PER_SEND) {
      await node.send(
        changes
          .slice(i, i + EVENTS_PER_SEND)
          .map(({ id, value }) => ({ type: SixSinesEventType.paramValue, paramId: id, value })),
      );
    }
  }

  /** Parameter changes made in the editor: sent on, and kept until the step changes. */
  editorChanged(changes: { id: number; value: number }[]) {
    for (const { id, value } of changes) this.manual.set(id, value);
    void this.run(async (node) => {
      for (const { id, value } of changes) this.sent.set(id, value);
      await this.sendParams(node, changes);
    });
  }

  /** A preset chosen in the editor replaces the step's own until the step changes. */
  editorLoadedPreset(text: string) {
    this.userPreset = text;
    this.manual.clear();
    this.wanted = new Map();
    void this.run(async (node) => {
      await node.allNotesOff();
      this.noteIds.clear();
      await node.loadPreset(new TextEncoder().encode(text));
      this.baseText = text;
      this.baseValues = presetValues(text);
      this.sent.clear();
      if (this.gain) this.gain.gain.value = PRESET_MAKEUP;
    });
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
    if (!this.node) return;
    this.noteIds.clear();
    void this.run((node) => node.allNotesOff());
  }
}

export const sixSines = new SixSinesEngine();

/** Start loading both worklets and the wasm as soon as the page opens. */
export function warmEngines() {
  void operators.warm().catch((error) => console.error("[operators]", error));
  void sixSines.warm();
}
