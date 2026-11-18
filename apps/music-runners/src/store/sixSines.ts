import type { MidiOutput } from "@avtools/midi/browser";
import { computed, isEqual, react, WeakCache, type Editor, type TLShapeId } from "tldraw";
import { SixSinesNode } from "../../../../packages/six-sines/six-sines-node.js";
import { SixSinesOutput } from "./sixSinesOutput";
import type { SixSinesShape } from "../shapes/SixSinesShape";

export const SIX_SINES_TYPE = "six-sines";
const OUTPUT_PREFIX = "six-sines:";
export const isSixSinesOutput = (name: string | undefined) => name?.startsWith(OUTPUT_PREFIX) ?? false;
export const sixSinesOutputName = (id: TLShapeId) => OUTPUT_PREFIX + id;
export const sixSinesAssets = () => new URL("./six-sines-ui/", document.baseURI);

function createSynthDirectory(editor: Editor) {
  const shapes = editor.store.query.records("shape", () => ({ type: { eq: SIX_SINES_TYPE } }));
  const options = computed("Six Sines outputs", () => shapes.get().map((record, index) => {
    const shape = record as SixSinesShape;
    return { value: sixSinesOutputName(shape.id), label: shape.props.name, divider: index === 0 };
  }), { isEqual });
  return { shapes, options };
}

const directories = new WeakCache<Editor, ReturnType<typeof createSynthDirectory>>();

export function sixSinesOutputOptions(editor: Editor) {
  return directories.get(editor, createSynthDirectory).options;
}

export function listSixSines(editor: Editor) {
  return directories.get(editor, createSynthDirectory).shapes.get() as SixSinesShape[];
}

const engines = new Map<string, SynthOutput>();
let context: AudioContext | undefined;

function reportError(error: unknown) {
  console.error("[Six Sines]", error);
}

class SynthOutput {
  private node?: SixSinesNode;
  private opening?: Promise<MidiOutput | null>;
  private configuration = Promise.resolve();
  readonly output: SixSinesOutput;

  constructor(private props: SixSinesShape["props"], name: string) {
    this.output = new SixSinesOutput({ id: name, name: props.name, manufacturer: null }, {
      send: (bytes) => {
        void this.configuration.then(() => {
          if (!this.output.closed) return this.node?.midi1(bytes);
        }).catch(reportError);
      },
    }, (events) => {
      void this.configuration.then(() => {
        if (!this.output.closed) return this.node?.send(events);
      }).catch(reportError);
    });
  }

  update(props: SixSinesShape["props"]) {
    if (props === this.props) return;
    const previous = this.props;
    this.props = props;
    const node = this.node;
    if (node) this.configure(node, previous, props);
  }

  private configure(node: SixSinesNode, previous: SixSinesShape["props"] | undefined, next: SixSinesShape["props"]) {
    const reload = previous?.preset !== next.preset ||
      Object.keys(previous?.parameters ?? {}).some((id) => !(id in next.parameters));
    const changes = Object.entries(next.parameters).filter(([id, value]) => reload || previous?.parameters[id] !== value);
    if (!reload && changes.length === 0) return;

    this.configuration = this.configuration.catch(() => {}).then(async () => {
      if (this.output.closed) return;
      if (reload && (previous || next.preset)) {
        const preset = next.preset ? new TextEncoder().encode(next.preset)
          : await fetch(new URL("init.sxsnp", sixSinesAssets())).then((response) => {
            if (!response.ok) throw new Error("Could not load the Six Sines init preset");
            return response.arrayBuffer();
          });
        if (this.output.closed) return;
        await node.loadPreset(preset);
      }
      for (const [id, value] of changes) {
        if (this.output.closed) return;
        await node.paramValue({ paramId: Number(id), value });
      }
    });
    void this.configuration.catch(reportError);
  }

  open(): Promise<MidiOutput | null> {
    if (this.output.closed) return Promise.resolve(null);
    return this.opening ??= this.initialize().catch((error) => {
      reportError(error);
      this.opening = undefined;
      return null;
    });
  }

  private async initialize() {
    const audio = context ??= new AudioContext();
    const resumed = audio.resume();
    const assets = sixSinesAssets();
    // Handle resume rejection immediately while the worklet loads.
    void resumed.catch(reportError);
    const node = await SixSinesNode.create(audio, {
      workletUrl: new URL("six-sines-worklet.js", assets),
      wasmUrl: new URL("six-sines.wasm", assets),
      presetUrl: new URL("init.sxsnp", assets),
    });
    try {
      await resumed;
      if (this.output.closed) {
        await node.dispose();
        return null;
      }
      this.configuration = Promise.resolve();
      this.node = node;
      node.connect(audio.destination);
      this.configure(node, undefined, this.props);
      await this.configuration;
      return this.readyOutput();
    } catch (error) {
      if (this.node === node) this.node = undefined;
      node.disconnect();
      void node.dispose().catch(reportError);
      throw error;
    }
  }

  readyOutput() {
    return this.node && !this.output.closed ? this.output : null;
  }

  dispose() {
    this.output.close();
    if (this.node) {
      this.node.disconnect();
      void this.node.dispose().catch(reportError);
      this.node = undefined;
    }
  }
}

export function installSixSines(editor: Editor) {
  const sync = () => {
    const remaining = new Set(engines.keys());
    for (const shape of listSixSines(editor)) {
      const name = sixSinesOutputName(shape.id);
      remaining.delete(name);
      const engine = engines.get(name);
      if (engine) engine.update(shape.props);
      else engines.set(name, new SynthOutput(shape.props, name));
    }
    for (const name of remaining) remove(name);
  };
  const remove = (name: string) => {
    engines.get(name)?.dispose();
    engines.delete(name);
  };
  const unsubscribe = react("sync Six Sines engines", sync);
  return () => {
    unsubscribe();
    for (const name of engines.keys()) remove(name);
    const audio = context;
    context = undefined;
    if (audio) void audio.close().catch(reportError);
  };
}

export function openSixSinesOutput(name: string) {
  return engines.get(name)?.open() ?? Promise.resolve(null);
}

export function getSixSinesOutput(name: string) {
  return engines.get(name)?.readyOutput() ?? null;
}

export function panicSixSines() {
  for (const engine of engines.values()) {
    engine.readyOutput()?.panic();
  }
}
