# feature-drawing-radiance-cascades

Lights the outlines of a drawing with 2D radiance cascades on WebGPU. A
canvas view of a checked-in drawing and a params pane in the UI; the render
lives in the engine tab's stage and follows every revision of the drawing,
the ~30 a second streamed while a shape is dragged included. Meant for the
engine in its own tab (**Open · engine in separate tab**), so the manifest
has no canvas-surface view; one can be added for the same-tab form. Only the outlines (strokes) of the
shapes exist to the light: each is an emitter, an occluder, a tinted glass, or
a bouncing wall according to its `metadata`.

The renderer is a **project library** (`lib/radiance-cascades/`): ordinary
TypeScript the module imports by relative path, not a package (see
"Project libraries are normal code" in `docs/livecode/principles.md`). It
comes in two backends behind one contract (`backend.ts`,
`createRadianceRenderer(device, w, h, config, { backend })`), switchable
from the params pane:

- **fragment** (`renderer.ts`, `effects.ts`, the default): fullscreen
  fragment passes on the raw shader-fx `ShaderEffect` DAG, hand-written
  complete WGSL programs rather than `passN` fragment functions because the
  raster pass reads storage buffers and writes four targets and each cascade
  level writes radiance plus per-channel transmittance at its own size.
- **compute** (`compute/`, raw WebGPU, no shader-fx): the same algorithm as
  compute passes in one command encoder per frame; see below.

## The compute backend

`compute/renderer.ts` and the `shaders/compute_*.wgsl` programs do what
fragment shaders cannot:

- **Scene rasterizer in two passes with tile bins.** `compute_scene_bins`
  runs a workgroup per 16 px tile whose lanes stride over the segments and
  claim bin slots with a workgroup atomic; `compute_scene_raster` stages the
  tile's bin in workgroup memory and tests each pixel against those segments
  only. Where a pixel's nearest outline is farther than the bin radius the
  distance written is a lower bound (the tile-centre distance minus half a
  diagonal, tracked with an atomic min), which sphere tracing accepts; a tile
  whose bin overflows falls back to all segments, so nothing is approximated
  near an outline.
- **Cascade levels in storage buffers**, direction-major, three packed
  f16 pairs per (probe, direction): 93 MB for the default plan at 1000x500
  against 261 MB of textures, and no `maxTextureDimension2D` clamp (levels
  are dropped only when a store exceeds the storage-buffer limit, which
  `radianceDeviceDescriptor` raises to the adapter's maximum).
- **Cascade 0 fused with the gather.** A lane is one probe and loops over
  all its directions, so a SIMD group of neighbouring probes marches one
  direction at a time (what the fragment tiling gives), the direction mean
  stays in registers and goes straight to the irradiance texture (an
  upsample pass only when the probe spacing is above a pixel), and cascade 0
  is never stored: half of all cascade texels and 192 MB of writes a frame in
  the default plan, with no workgroup memory or barrier. For the bounce,
  probes within a few pixels of an outline append their directional radiance
  to a compact band buffer through an atomic slot counter; `compute_bounce`
  looks them up through a probe-to-slot map, falling back to the probe's
  irradiance (as the fragment pass does without a normal) for a probe
  outside the band. The band grows itself when a frame overflows it
  (`bandStats`). `fuseCascade0: false` stores cascade 0 like the other levels
  instead and gathers in a pass of its own (`compute_gather`), with the bounce
  reading the store.
- **Workgroup-memory stagings**, both off by default after measurement (see
  below) and planned per level by `compute/plan.ts` when enabled: the upper
  level's probe footprint and child directions a tile merges with loaded once
  per workgroup (`stageUpper`), and the patch of the distance, emission and
  transmittance textures a tile's rays can reach loaded once and marched in
  workgroup memory (`scenePatch`, `"auto"` enables it where the tile's
  marches outnumber the patch texels).
- **Exact dispatches** (no dead tiles where the direction count is not a
  square), **one submit a frame**, and **per-pass GPU timings** through
  `timestamp-query` when the device has it (`timings`, on both backends; the
  HUD, `render_check` and `bench` print them).
- Debug views (`cascade N merged/raw`) are produced only while requested
  (`setDebugViews`): the level stores plus cascade 0's are then unpacked
  into the fragment backend's direction-tiled textures for the same display
  pass. The fragment backend does the same for its raw (own-interval)
  target: off, each cascade pass renders two targets through the `fsMerged`
  entry point and the raw textures do not exist (a third of its cascade
  memory, 130 MB of writes a frame in the default plan); the module turns it
  on only for the two cascade views.

Both backends share `march.wgsl` (the marcher reads the scene through
`sceneDistance`/`sceneMedium`), `planCascades`, the reference and display
passes, and agree to 0.002 RMS or better on every check (the compute
backend's distance lower bound moves where sphere tracing lands within half a
pixel of a surface, and the stores are f16 as the textures were).

### Measured (Apple M1 Max, 1000x500, `tools/bench.ts` and the browser bench)

Pipelined wall-clock per frame, with the exclusive GPU time of each pass
(ms; the bilinear fix, then vanilla):

| bilinear fix | frame | c4 | c3 | c2 | c1 | c0 (+ gather) |
| --- | --- | --- | --- | --- | --- | --- |
| fragment, Deno | 31.4 | 8.0 | 8.4 | 4.4 | 3.8 | 5.5 + 0.5 |
| compute, Deno | 25.8 | 5.2 | 7.0 | 5.0 | 3.9 | 5.9 |
| fragment, Chrome 153 | 29.0 | 8.0 | 8.3 | 4.0 | 3.3 | 4.7 + 0.4 |
| compute, Chrome 153 | 22.6 | 4.5 | 5.7 | 3.9 | 3.3 | 4.7 |

| vanilla | frame | c4 | c3 | c2 | c1 | c0 (+ gather) |
| --- | --- | --- | --- | --- | --- | --- |
| fragment, Deno | 9.6 | 1.9 | 2.0 | 1.8 | 2.6 | 4.8 + 0.8 |
| compute, Deno | 8.7 | 1.4 | 1.8 | 1.9 | 2.7 | 4.9 |
| fragment, Chrome 153 | 7.5 | 1.1 | 1.2 | 0.9 | 1.3 | 2.4 + 0.4 |
| compute, Chrome 153 | 6.2 | 0.7 | 0.9 | 0.9 | 1.2 | 2.1 |

So the compute backend is 18 to 22% faster with the bilinear fix and 10 to
17% faster vanilla, at about a third of the cascade memory, and the two agree
to 0.002 RMS. Chrome (Dawn/Tint) compiles every program and runs faster than
Deno (wgpu/naga) on the same GPU, most visibly at cascade 0. (The fragment
rows are with its raw debug target off, see below, which took about 1.5 ms
off its bilinear-fix frame.)

What the sweep in `bench.ts` decided (all within the run-to-run noise of
about 5% unless noted):

- 64-lane workgroups with square 8x8 probe tiles for the upper levels; 32 to
  128 lanes are equal, 256 is 15% slower, 512 much slower, and Metal runs
  nothing for a 1024-lane workgroup of this kernel (`workgroupLanes`,
  `reduceLanes`, `tileWidth`).
- The stagings lose on this GPU: the upper footprint adds about 2.7 ms to
  cascade 0 and the scene patch 7 to 10 ms, since the texture cache already
  serves the re-reads and the load phase plus barrier lowers occupancy.
- The first fused cascade 0 (a probe tile times all 16 directions as lanes,
  reduced in workgroup memory) cost 7.4 ms against 5.3 + 0.7 ms for storing
  it and gathering; one lane per probe looping over its directions brought
  it to parity at 6.0 ms with nothing stored.
- The bounce band's global atomic counter costs nothing measurable.
- Not used: subgroup operations. Chrome's WebGPU has the `subgroups`
  feature (the browser bench confirms it compiles) but Deno's naga does not,
  so nothing here depends on it; a subgroup reduction is the obvious next
  experiment for cascade 0 in the browser.

The two backends are compared in the browser with
`tools/browser_bench.sh`, which bundles `tools/browser_bench.ts` with
`deno bundle`, serves it with the drawing, and drives the installed Chrome
through Playwright (`--headed` shows the window; a query such as
`merge=vanilla&frames=30&scale=1` sets the run).

## Shape metadata

Set on any polygon, circle, or freehand stroke through the canvas's metadata
editor (all optional; `lib/radiance-cascades/materials.ts` holds the defaults):

| key | meaning | default |
| --- | --- | --- |
| `strokeWidth` | outline width in stage px | 4 |
| `emission` | `[r, g, b]` radiance, HDR, unbounded | `[0, 0, 0]` |
| `transmittance` | `[r, g, b]` or one number, 0..1 per channel; 0 opaque, 1 clear, between is tinted glass | `[0, 0, 0]` |
| `albedo` | `[r, g, b]` 0..1, fraction of incoming light bounced back | `[0.5, 0.5, 0.5]` |

Transmittance and emission apply per pixel of ray travel inside the outline.
Where outlines overlap, the nearest surface wins.

The checked-in drawing has a warm sun ring, a white opaque wall, a rose-tinted
glass loop, a blue lamp, a mossy opaque boulder, and an ember freehand stroke.

## Radiance cascade parameters (params pane)

- **cascades**: cascade-0 probe spacing, cascade-0 ray count, angular
  branching factor (rays multiply by it per level; spacing always doubles),
  cascade-0 interval length and the interval scale factor, cascade count
  (0 = automatic from the render size), merge mode (vanilla, bilinear fix,
  parallax fix), direction pre-averaging, interval overlap. The defaults
  (1 px spacing, 16 rays doubling per level, 2 px base interval quadrupling,
  bilinear fix) follow the penumbra condition, angular spacing at an
  interval's end matching the probe spacing; 2 px spacing with 4 rays
  quadrupling is 3x cheaper and visibly blockier (the check renders both).
- **march**: distance-field sphere tracing between outlines (off marches
  fixed steps everywhere) and the in-outline step size.
- **light**: sky radiance for rays that leave the top cascade, and bounce
  strength (last frame's irradiance at the outline, cosine-weighted over the
  outward hemisphere, times albedo, fed back as emission).
- **render**: render scale, exposure, tone map (ACES, or a soft curve), and
  the view: final irradiance, the brute-force reference, any cascade's merged or raw radiance (direction
  tiles), or the scene's emission, emission + bounce, transmittance, albedo,
  or distance field.

The output is per-pixel irradiance, including in empty space, as an
`rgba16float` texture (`renderer.irradiance`, a shader-fx effect that chains
into the generated-raw post effects).

## Compared with the Shadertoy "2D Volumetric Radiance Cascades"

That shader (wfyyDz) merges the same way (bilinear fix, per-direction
storage) but spends its cascades differently: one ray per 1 px probe at
cascade 0, rays and intervals both quadrupling, and a 0.2 px base interval,
so every level ends with about 5 px between rays at any distance. Against
the brute-force reference on this drawing that configuration (cascade-0
rays 1, branching 4, base interval 0.8 here, since intervals are summed) is
softer but less faithful: 0.0063 RMS and 54 ms against the default's
0.0037 and 45 ms. Shorter base intervals alone (1 px, 0.5 px) lose
fidelity the same way. It is one pane change away if the softer look is
wanted; its ACES tone map is the default here.

## Verification, cheapest first

1. **WGSL alone**: `deno run --unstable-webgpu -A --no-lock tools/gen_shaders.ts`
   expands the `#include`s in `lib/radiance-cascades/shaders/*.wgsl`,
   validates every program with `naga` (milliseconds, no GPU) or, without a
   `naga` binary, by compiling it on Deno's WebGPU device, and rewrites
   `lib/radiance-cascades/wgsl.generated.ts`. `--check` fails on stale output.
2. **Headless render** (Deno WebGPU, seconds on a GPU, a few minutes on
   lavapipe at `--scale 0.25`):
   ```sh
   cd apps/deno-notebooks
   deno run --unstable-webgpu -A --no-lock --config deno.json \
     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/render_check.ts \
     [--scale 0.5] [--backend fragment|compute|both]
   ```
   For each backend (both by default) renders the checked-in drawing under
   every merge mode, times each (wall clock, plus per-pass GPU times on a
   device with timestamp queries), compares each to the brute-force reference
   (RMS of tone-mapped luminance), checks that bounce brightens a wall's
   shadow side and settles (and that the compute backend's band filled), and
   writes PNGs of every view (irradiance per mode, reference, bounce, each
   cascade's merged and raw tiles, the coarse 2 px configuration) to
   `.output/`, prefixed by backend. With both backends it then checks that
   they agree with each other (0.01 RMS). At 1000x500 on an Apple GPU with
   the fragment backend: vanilla 24 ms and 0.007 RMS, bilinear fix 45 ms and
   0.005, parallax fix 28 ms and 0.0125, reference at 256 rays/px 119 ms
   (single frames, GPU idle before each; `tools/bench.ts` measures pipelined
   frames, the number the frame rate follows). Per-ray storage at 1 px
   spacing is memory-hungry (about 380 MB of cascade textures at this size;
   the compute backend needs about a quarter of that); pre-averaging halves
   it, render scale 0.5 quarters it. The parallax fix drifts from the
   reference below `--scale 0.5` in both backends (its intervals get shorter
   than its probe spacing), which the check reports.
3. **Benchmark** (Deno WebGPU): `tools/bench.ts` with the same invocation as
   the render check (`--merge`, `--frames`, `--scale`, `--variants`) times
   both backends and the compute backend's option variants, pipelined, with
   the exclusive GPU time per pass.
4. **In the app** (browser-engine target): open the project with the engine
   in a separate tab from `projects.html`, or by hand with
   `/engine/` in one tab and
   `/index.html?serverBaseUrl=http://localhost:7777&projectPath=<absolute path>`
   in another, then Run the module and watch the engine tab, where a line
   under the canvas reports the backend, render size, frame rate, the
   cascade plan and, on a device with timestamp queries, GPU milliseconds
   per pass. Switch **backend** in the render group and the picture should
   not change. Drag the sun:
   the render follows mid-gesture. Switch
   the merge mode: vanilla leaks light into the boulder and rings the sun,
   the bilinear fix does neither. Set a shape's `transmittance` to
   `[1, 0.3, 0.3]` in the metadata editor and it becomes red glass. Raise
   bounce and the wall's shadow side fills in over a few frames. Compare the
   reference view with the final.

Editing the library needs a page reload to take effect (relative imports are
not cache-busted); editing the module does not.

If the drawing view shows **write rejected** with "Drawing document version
must be 1, got 2" on load, the client's bundled `handwriting-canvas` is older
than the checked-in document (it has curved polygons): run
`npm run setupLivecode` in `apps/livecode-tldraw` and restart the client.
