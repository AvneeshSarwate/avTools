# FM Synthesis: a playable manual

An interactive FM sound-design course. Each page pairs a short explanation with
a bench: an operator diagram, a scope, a spectrum, sliders for the parameters
that matter on that page, and the music-runners piano roll with a looping clip.

```
npm install
npm run dev      # http://localhost:5191
```

## What is in it

| Part | Pages | Engine |
| --- | --- | --- |
| A · Foundations | vibrato, sidebands, ratio, FM vs PM, index envelopes, feedback | raw Web Audio nodes, then the operator worklet |
| B · Topologies | series, parallel modulators, parallel carriers, pairs, choosing | operator worklet, switchable to Six Sines |
| C · Beyond plain PM | ring modulation, waveforms, detune, unison | both |
| D · Recipes | brass, woodwinds, strings, bass, plucked, e-piano, bells and drums, noise, voice | both |
| E · Presets taken apart | twelve Six Sines factory presets | Six Sines |

## How it is put together

- `public/operators.worklet.js` is the raw engine: a six-operator
  phase-modulation bank in one AudioWorkletProcessor. Patches use physical
  units (index in radians, times in seconds).
- `src/audio/sixSinesMap.ts` translates such a patch into Six Sines parameter
  values, so most benches can switch between the raw engine and
  `packages/six-sines` playing the same patch. It also decodes `.sxsnp`
  presets for the diagrams and stage switches in Part E.
- `src/audio/engine.ts` holds the three instruments (native nodes, worklet,
  Six Sines) behind one `noteOn` / `noteOff` interface.
- `src/lessons/` is the content. A lesson is data: prose, a patch or preset,
  the controls to expose, a clip, and optionally a prediction question and a
  function giving the theoretical partials to overlay on the spectrum.
- The piano roll is imported as source from `apps/music-runners/src/pianoRoll`.
  `vite.config.ts` dedupes `react`, `konva` and `valtio` so its imports resolve
  from this app's `node_modules`.

Six Sines assets are served by the shared `sixSinesUiAssets` Vite plugin from
`apps/livecode-tldraw`.
