# Six Sines browser engine

This directory contains the importable browser runtime produced by a WebAssembly/AudioWorklet
port of the original [Six Sines synthesizer](https://github.com/baconpaul/six-sines). It is
distribution output only: the synth source, native CLAP, build scripts, and verification
harnesses remain in the source repositories.

Source:

- Original synthesizer: [baconpaul/six-sines](https://github.com/baconpaul/six-sines)
- Browser-port fork: [AvneeshSarwate/six-sines](https://github.com/AvneeshSarwate/six-sines)
- Port branch: [`browser-audio-worklet`](https://github.com/AvneeshSarwate/six-sines/tree/browser-audio-worklet)
- Packaged commit: [`20bd35bfef0c`](https://github.com/AvneeshSarwate/six-sines/commit/20bd35bfef0c27d08aa398b031e17cb84b77a08b)

`six-sines-node.js` is the public module. Its adjacent `.d.ts` provides TypeScript declarations;
`six-sines-worklet.js`, `six-sines.js`, and `six-sines.wasm` are runtime assets and must remain
served beside it. `six-sines-build.json` records the source identity compiled into the Wasm.

```js
import { SixSinesNode } from "./six-sines-node.js";

const context = new AudioContext({ latencyHint: "interactive" });
const synth = await SixSinesNode.create(context, {
  presetUrl: "./my-preset.sxsnp",
});
synth.connect(context.destination);
await context.resume();

await synth.noteOn({ noteId: 101, key: 60, velocity: 0.8 });
setTimeout(() => synth.paramMod({
  noteId: 101,
  key: 60,
  paramId: 40000,
  amount: 0.7,
}), 50);
setTimeout(() => synth.noteOff({ noteId: 101, key: 60 }), 500);
```

Untimed calls are delivered on the next AudioWorklet render quantum. The advanced `schedule()`
API accepts explicit audio frames/times for deterministic tests. Presets are native `.sxsnp`
files saved by the paired Six Sines CLAP build.

## Vue preset editor webcomponent

`ui/six-sines-editor.js` is the compiled Vue editor; it includes Vue, styles, and
fonts. Its adjacent declaration file describes the typed element API. Serve
`ui/presets/` at the element's `presetBaseUrl` for the factory browser.
The Vue source stays in the Six Sines repository's `browser-ui/` directory;
`npm run build:webcomponent && npm run sync:webcomponent` there refreshes this distribution.

```ts
import { registerSixSinesEditor } from "./ui/six-sines-editor.js";
registerSixSinesEditor();
const editor = document.createElement("six-sines-editor");
editor.presetBaseUrl = new URL("./ui/", import.meta.url).href;
document.body.append(editor);
editor.loadPreset(nativePresetBytes);
editor.setParameters([{ id: 20015, value: 0.5 }]);
editor.addEventListener("parameters-change", (event) => {
  // event.detail.changes: { id: number, value: number }[]
});
editor.addEventListener("preset-change", (event) => {
  // event.detail: { preset: native XML text, values: Record<string, number> }
});
const nativePresetBytesToSave = editor.getPreset();
```

Programmatic hydration is silent. User edits emit DOM events; the host owns
engine communication, persistence, and undo policy outside the editor.
`getPreset()` incorporates current parameter values into native `.sxsnp` XML.

The livecode integration uses `six-sines-store` for a tracked `sixSines` entity
and `SixSinesShape.tsx` for a tldraw view. See
[`six-sines-sound-design`](../../apps/livecode-tldraw/example-projects/six-sines-sound-design/README.md)
for piano-roll playback, preset sharing, and optional 60 Hz pan automation.
