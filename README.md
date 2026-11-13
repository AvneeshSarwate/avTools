# avTools

avTools is a laboratory for building interactive audiovisual environments. The projects here try out different ways of composing music and graphics together—in the browser, in Deno notebooks, and inside TouchDesigner through C++ plugins. The environments themselves are part of the experiment, along with the pieces made in them.

Much of this work starts from the idea that composing a piece can also mean inventing an interface for it. A piano roll might be a useful starting point, but a new musical or visual form may need its own notation, editor, or way of interacting. The aim is to make those things easy to develop while composing, with code and graphical editing working together. That calls for live or very fast reload throughout the system, so changes to the tools can be tried as readily as changes to the piece. It also shapes the emphasis on coding-agent-friendly source, APIs, documentation, and development workflows: an agent should be able to help build an unfamiliar editor or change the platform that hosts it.

The intended workflow carries through into performance. Material developed during composition should be playable in the same system, with its interface adapted through rehearsal rather than ported into a separate performance environment. That makes rendering speed, predictable timing, and runtime stability part of the platform design from the beginning.

Two shared foundations support this work. **TimeContext**, the timing library, lets musical processes and graphical animation be composed together through a common model of time. **WebGPU** is the focus for rendering portability across browser and native hosts. Other useful tools are extracted as the experiments develop, so a new platform can reuse a scheduler, drawing editor, or shader workflow and concentrate on the ideas it is testing.

## Projects

### Browser sketches and editors

[`apps/browser-projections`](apps/browser-projections/) is a Vue/Vite application containing audiovisual sketches and the editors developed around them: piano rolls, drawing canvases, animation timelines, and parameter controls. Several of these editors are also built as [standalone web components](webcomponents/README.md) for use in notebooks and other applications.

[Music Runners](apps/music-runners/README.md) takes one of those interactions further. It places piano rolls and procedural playback on a tldraw canvas, with editable source notes, previews of generated music, MIDI output, and connections between running instances. It is a small, standalone place to work on how musical algorithms can be edited and played.


### Deno notebooks

[`apps/deno-notebooks`](apps/deno-notebooks/README.md) combines the incremental workflow of a TypeScript notebook with MIDI, WebGPU graphics, and interactive controls. Rust helpers provide native windows, text rendering, Syphon output, media decoding, and hardware access. The same directory contains standalone scripts and performance sketches using those facilities.

The [examples](apps/deno-notebooks/examples/) are a good place to see the parts working together: piano-roll and parameter-panel notebooks, controller experiments, and graphics driven by musical processes. [hanoiShow](apps/deno-notebooks/examples/hanoiShow/README.md) also demonstrates packaging a Deno performance sketch and its native dependencies as a standalone macOS app.

### The livecode environment

The [livecode environment](docs/livecode/README.md) puts code editors and editable views of running program data on the same canvas. A musical process can read a melody while it is being edited in a piano roll; code can also write back into the material shown by the interface. Custom views let a piece acquire its own notation and controls as it develops.

[`apps/livecode-tldraw`](apps/livecode-tldraw/README.md) is the React/tldraw interface. The [Deno server](apps/deno-notebooks/livecode/README.md) handles projects, source analysis, persistence, and editor services, while execution and live state are factored into [`livecode-engine`](packages/livecode-engine/) and [`livecode-protocol`](packages/livecode-protocol/). 

The [example projects](apps/livecode-tldraw/example-projects/README.md) cover timing, drawing, animation, piano rolls, MIDI, synthesis, and custom project UI. Read the [workflow goals](docs/livecode/user-level-project-goals.md) for the composition and performance model, or the [documentation index](docs/livecode/README.md) to work on the platform itself.

### TouchDesigner

The [TouchDesigner integration](packages/native-webgpu/TOUCHDESIGNER.md) brings TypeScript, TimeContext, and WebGPU into TouchDesigner through C++ plugins embedding V8 and Dawn. The **Sketch TOP** runs P5GPU graphics with TOP inputs and CHOP controls. The **[Channels CHOP](packages/native-webgpu/CHOP.md)** runs timed processes and transforms channel or point buffers. Scripts can declare operator parameters, handle MIDI, and communicate through files, OSC/UDP, and WebSockets.

The [native TypeScript workflow](apps/td-projects/native/README.md) watches and compiles source inside TouchDesigner, so editing a sketch or its controls does not require a separate Node or Deno process. The [project guide](apps/td-projects/README.md) also covers the Node-based build workflow.

[TD Canvas](apps/td-canvas/README.md) connects this work back to the browser editors. It wraps the shared drawing component in a customizable Vue app and streams shapes to TOPs and CHOPs over WebSockets. The browser interface and the TouchDesigner process can be developed together around the same drawing.

Start with the [plugin walkthrough](packages/native-webgpu/prebuilt/macos-arm64/README.md) or the [Sketch example](packages/native-webgpu/native/td/example/README.md). [Prebuilt plugins](packages/native-webgpu/prebuilt/README.md) are published as [GitHub release downloads](https://github.com/AvneeshSarwate/avTools/releases/tag/td-plugins). Separate guides cover [timing](packages/native-webgpu/TIMING.md), [parameters](packages/native-webgpu/PARAMETERS.md), [reload and reset](packages/native-webgpu/RELOAD.md), [execution modes](packages/native-webgpu/EXECUTION_MODES.md), [MIDI](packages/native-webgpu/MIDI.md), and [I/O](packages/native-webgpu/IO.md).

### Node and native rendering

[`packages/native-webgpu`](packages/native-webgpu/README.md) provides P5GPU rendering through Node/Dawn, with native preview windows, text rendering, and Syphon output. It shares rendering code with the Deno implementation and provides the native foundation for the TouchDesigner plugins.

[`apps/node-livecode`](apps/node-livecode/README.md) is a minimal Node host for the shared livecode engine, supporting offscreen rendering and optional previews. The full editor and coordination server still run in Deno. These native integrations currently target macOS Apple Silicon; the Node path is validated on Node 22.20.0. See the [validation notes](packages/native-webgpu/VALIDATION.md) for details.

## Shared tools

The most central library is [`core-timing`](packages/core-timing/README.md). Its TimeContext scheduler supports musical waits, tempo changes, concurrent branches, cancellation, frame-aware browser execution, and offline execution. A sequence of notes and an animation can use the same timing relationships, making it possible to compose how they develop together. The scheduler is reused across hosts, including inside the TouchDesigner plugins.

Rendering work centers on WebGPU and WGSL, with libraries for geometry, shader effects, and typed shader generation. Some browser experiments also use WebGL, Three.js, and Babylon.js. Portability is handled through shared logic and adapters for each host's graphics, device access, and lifecycle.

The main extractions are:

| Area | Packages |
| --- | --- |
| Music | [`midi`](packages/midi/README.md) provides a common browser and Deno/native MIDI API. [`music-types`](packages/music-types/) contains scales, clip data, and interpolation helpers. [`six-sines`](packages/six-sines/README.md) contains the browser synth and editor distribution from the separate Six Sines port. |
| Geometry and rendering | [`power2d`](packages/power2d/) contains 2D geometry and stroke rendering; [`shader-fx`](packages/shader-fx/) supplies shader effects; [`creative-algs`](packages/creative-algs/) contains shape, transform, and geometry helpers. |
| Shader generation | [`power2d-codegen`](packages/power2d-codegen/), [`shader-fx-codegen`](packages/shader-fx-codegen/), and [`compute-shader-codegen`](packages/compute-shader-codegen/) generate typed wrappers using [`codegen-common`](packages/codegen-common/). Generated compute wrappers live in [`compute-shader`](packages/compute-shader/). |
| Interfaces | [`webcomponents`](webcomponents/README.md) contains embeddable editors and controls. [`ui-bridge`](packages/ui-bridge/) connects them to notebooks and running processes. |
| Editable data | [`drawing-document`](packages/drawing-document/) represents drawings independently of the canvas editor and converts them into renderable geometry. [`tracked-state`](packages/tracked-state/README.md) provides mutable JSON state with snapshots, reconciliation, and change patches. |

Build tools live under [`tools`](tools/): shader generation is connected to Vite and Deno watchers, and the [native](tools/td-native-build/README.md) and [Node-based](tools/td-sketch-build/README.md) TouchDesigner builders handle sketch compilation and templates.

For video preparation, [`encoder-gui`](encoder-gui/README.md) is a Rust/egui application that encodes HAP/HAP-Q video and packages it as `.happack` media. It can be distributed as a standalone macOS app. The local [`hysnappy2`](packages/hysnappy2/README.md) fork adds decode-into-buffer support for media playback.

## Getting started

Pick a project above and follow its guide; the browser, notebook, and native workflows have different requirements. For the main Deno/notebook and browser development environment, run from the repository root:

```sh
./setup.sh
```

This can install missing Rust, Deno, uv, and Node toolchains. It builds notebook native helpers, caches Deno dependencies, creates the Jupyter environment and custom Deno kernel, installs dependencies for `browser-projections` and `livecode-tldraw`, and builds the piano-roll bundle. The script pins Deno 2.9.7; rebuild the native window helper with the checkout when using windowed sketches.

Open [`avtools.code-workspace`](avtools.code-workspace) in VS Code for the Deno, notebook, and browser TypeScript configuration. The [notebook guide](apps/deno-notebooks/README.md) covers kernel setup. Browser sketches run with `npm install` and `npm run dev` from `apps/browser-projections`; the livecode environment has its own [startup instructions](docs/livecode/current/testing-and-operations.md).

TouchDesigner users can start with the [prebuilt plugin walkthrough](packages/native-webgpu/prebuilt/macos-arm64/README.md) and [download the latest plugins](packages/native-webgpu/prebuilt/README.md). To build the Node/Dawn package, follow its [native build guide](packages/native-webgpu/README.md). The root setup script does not build either of those integrations.

Most application work lives in `apps/`, extracted libraries in `packages/`, and reusable UI bundles in `webcomponents/`. The root [`deno.json`](deno.json) defines the Deno workspace and import map; shared TypeScript packages generally use `@avtools/*` imports and explicit `.ts` extensions for local imports. Browser and native projects have their own build configurations.

The projects are at different stages of development. Their local guides, examples, and tests are the best references for what currently works.
