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
  against 392 MB of textures, and no `maxTextureDimension2D` clamp (levels
  are dropped only when a store exceeds the storage-buffer limit, which
  `radianceDeviceDescriptor` raises to the adapter's maximum).
- **Workgroup-memory stagings**, decided per level by `compute/plan.ts`
  (`describe()` and the engine log show the decisions): the upper level's
  probe footprint and child directions a tile merges with are loaded once
  per workgroup (vanilla and bilinear-fix merges), and where the tile's
  marches outnumber the scene texels its rays can reach, that patch of the
  distance, emission and transmittance textures is loaded once and marched
  in workgroup memory (cascade 0 with the bilinear fix, `scenePatch:
  "auto"`; force it with `true`).
- **Cascade 0 fused with the gather and the bounce.** Its workgroup holds a
  probe tile times all cascade-0 directions, reduces the direction mean in
  workgroup memory and writes the irradiance texture directly (an upsample
  pass only when the probe spacing is above a pixel), so cascade 0 is never
  stored: half of all cascade texels and 192 MB of writes a frame in the
  default plan. For the bounce, probes within a few pixels of an outline
  append their directional radiance to a compact band buffer through an
  atomic slot counter; `compute_bounce` looks them up through a probe-to-slot
  map, falling back to the probe's irradiance (as the fragment pass does
  without a normal) for a probe outside the band. The band grows itself when
  a frame overflows it (`bandStats`).
- **Exact dispatches**: no dead tiles where the direction count is not a
  square, as the fragment tiling has.
- **Per-pass GPU timings** through `timestamp-query` when the device has it
  (`timings`, on both backends; the HUD and `render_check` print them), and
  one submit a frame.
- Debug views (`cascade N merged/raw`) are produced only while requested
  (`setDebugViews`): the level stores plus cascade 0's are then unpacked
  into the fragment backend's direction-tiled textures for the same display
  pass.

Both backends share `march.wgsl` (the marcher reads the scene through
`sceneDistance`/`sceneMedium`, which the compute cascade answers from the
patch when the ray is inside it), `planCascades`, the reference and display
passes. On the software adapter used to verify this the two agree to
0.002 RMS or better on every check (the compute backend's distance lower
bound moves where sphere tracing lands within half a pixel of a surface, and
the stores are f16 as the textures were). Not used: subgroup operations
(`subgroups` is optional and untestable on a software adapter; the
cascade-0 reduction is a workgroup-memory sum).

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
   the fragment backend: vanilla 30 ms and 0.007 RMS, bilinear fix 63 ms and
   0.005, parallax fix 31 ms and 0.0125, reference at 256 rays/px 134 ms.
   Per-ray storage at 1 px spacing is memory-hungry (about 380 MB of cascade
   textures at this size; the compute backend needs about a quarter of that);
   pre-averaging halves it, render scale 0.5 quarters it. The parallax fix
   drifts from the reference below `--scale 0.5` in both backends (its
   intervals get shorter than its probe spacing), which the check reports.
3. **In the app** (browser-engine target): open the project with the engine
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
