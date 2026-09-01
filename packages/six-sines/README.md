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
