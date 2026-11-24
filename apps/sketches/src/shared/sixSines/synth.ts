// One Six Sines engine (AudioWorklet) kept in step with a patch: a preset
// (native .sxsnp XML, or undefined for the init patch) plus parameter values
// set on top of it. Adapted from apps/music-runners/src/store/sixSines.ts.
import { SixSinesNode, type SixSinesEvent } from "../../../../../packages/six-sines/six-sines-node.js";

export interface SynthPatch {
  preset?: string;
  parameters: Record<string, number>;
}

export const sixSinesAssets = () => new URL("./six-sines-ui/", document.baseURI);

function reportError(error: unknown) {
  console.error("[Six Sines]", error);
}

export class SixSinesSynth {
  private node: SixSinesNode | null = null;
  private applied: SynthPatch | undefined;
  private wanted: SynthPatch = { parameters: {} };
  private configuration = Promise.resolve();
  private disposed = false;
  readonly ready: Promise<SixSinesNode>;

  /** `onPresetLoaded` runs after a preset load, which silences every voice in the engine. */
  constructor(context: AudioContext, private readonly onPresetLoaded: () => void = () => {}) {
    const assets = sixSinesAssets();
    this.ready = SixSinesNode.create(context, {
      workletUrl: new URL("six-sines-worklet.js", assets),
      wasmUrl: new URL("six-sines.wasm", assets),
      presetUrl: new URL("init.sxsnp", assets),
    }).then((node) => {
      if (this.disposed) {
        void node.dispose();
        throw new Error("disposed");
      }
      node.connect(context.destination);
      this.node = node;
      this.configure(true);
      return node;
    });
    this.ready.catch(reportError);
  }

  get isReady(): boolean {
    return this.node !== null;
  }

  setPatch(patch: SynthPatch) {
    this.wanted = patch;
    if (this.node) this.configure(false);
  }

  /** Untimed events: delivered on the next render quantum. Dropped until the engine is ready. */
  send(events: SixSinesEvent[]) {
    if (!this.node || this.disposed || events.length === 0) return;
    void this.node.send(events).catch(reportError);
  }

  private configure(initial: boolean) {
    const node = this.node!;
    const previous = this.applied;
    const next = this.wanted;
    if (previous === next) return;
    const reload = (!initial || next.preset !== undefined) && (previous?.preset !== next.preset ||
      Object.keys(previous?.parameters ?? {}).some((id) => !(id in next.parameters)));
    const changes = Object.entries(next.parameters).filter(([id, value]) => reload || previous?.parameters[id] !== value);
    this.applied = next;
    if (!reload && changes.length === 0) return;
    this.configuration = this.configuration.catch(() => {}).then(async () => {
      if (this.disposed) return;
      if (reload) {
        const preset = next.preset !== undefined ? new TextEncoder().encode(next.preset)
          : await fetch(new URL("init.sxsnp", sixSinesAssets())).then((response) => {
            if (!response.ok) throw new Error("Could not load the Six Sines init preset");
            return response.arrayBuffer();
          });
        if (this.disposed) return;
        await node.loadPreset(preset);
      }
      for (const [id, value] of changes) {
        if (this.disposed) return;
        await node.paramValue({ paramId: Number(id), value });
      }
      if (reload) this.onPresetLoaded();
    });
    void this.configuration.catch(reportError);
  }

  dispose() {
    this.disposed = true;
    if (this.node) {
      this.node.disconnect();
      void this.node.dispose().catch(reportError);
      this.node = null;
    }
  }
}
