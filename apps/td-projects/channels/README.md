# Channels: TypeScript + TimeContext in TouchDesigner

Use this directory as the IDE root. Node 22.20.x is needed for editing/building;
the checked-in macOS Apple Silicon plugin runs inside TD without Node.

```sh
npm run setup
npm run dev
```

Open [project.toe](project.toe) in TouchDesigner. The two animation CHOPs load
`dist/animation.js`; the four chained pass-through CHOPs load `dist/passthrough.js`.
Change Value, Target, and Duration on their parent component, then pulse Trigger.
Each animation instance runs its own TimeContext ramp and persistent channel state.
A successful save rebuilds the affected file and restarts its instances. A failed
build leaves the last good bundle in place.

`npm run build` builds once. `npm run check` builds and tests the bundles with the
real embedded runtime (requires Apple Command Line Tools for the small harness).
After setup, VS Code IntelliSense uses the generated paths and local TypeScript;
the project settings disable Deno for this directory.

- `sketches/animation/main.ts`: independent timing task, interruptible eased ramp,
  pulse handler, and same-cook input multiplication.
- `sketches/passthrough/main.ts`: minimal current-input/current-output transform.
- `sketches/points/main.ts`: 10,000 animated XY points using bulk channel writes.
  The included `points1` CHOP uses Output Channels `x y`, Output Samples `10000`,
  and Source File `dist/points.js`.

Copy this folder to a sibling for a new TD piece. Add CHOP entries to
`td-sketches.config.ts` with `target: 'chop'`, output names, and optional `samples`.
Those values configure the native checker; set the matching Output Channels and
Output Samples parameters on the TD operator. String entries remain TOP sketches,
so one project can contain both. All operators loading the same bundle still
have independent state.

The [CHOP guide](../../../packages/native-webgpu/CHOP.md) documents the state API,
input freshness, bulk buffers, timing, and errors. For an example that opens
without running setup, use [Channels.toe](../../../packages/native-webgpu/native/td/chop-example/Channels.toe),
which embeds its JavaScript in DATs.

For distribution outside the repository, include `project.toe`, built `dist/`,
and the complete current CHOP plugin at `Plugins/AvToolsChannels.plugin`.
Startup locates that bundle first, then the repository's `current-chop.txt`.
To import `project.tox` instead, set the component's Plugin Path and adjust Source
File paths for your project directory.
