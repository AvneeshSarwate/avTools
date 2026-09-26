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
"Project libraries are normal code" in `docs/livecode/principles.md`).
It is built on the raw shader-fx `ShaderEffect` DAG but hand-writes complete
WGSL programs rather than `passN` fragment functions, because the raster pass
reads storage buffers and writes four targets and each cascade level writes
radiance plus per-channel transmittance at its own size; see the comparison in
`lib/radiance-cascades/mod.ts`.

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

1. **WGSL alone**: `deno run -A --no-lock tools/gen_shaders.ts` expands the
   `#include`s in `lib/radiance-cascades/shaders/*.wgsl`, validates every
   program with `naga` (milliseconds, no GPU), and rewrites
   `lib/radiance-cascades/wgsl.generated.ts`. `--check` fails on stale output.
2. **Headless render** (Deno WebGPU, seconds):
   ```sh
   cd apps/deno-notebooks
   deno run --unstable-webgpu -A --no-lock --config deno.json \
     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/render_check.ts
   ```
   Renders the checked-in drawing under every merge mode, times each, compares
   each to the brute-force reference (RMS of tone-mapped luminance), checks
   that bounce brightens a wall's shadow side and settles, and writes PNGs of
   every view (irradiance per mode, reference, bounce, each cascade's merged and
   raw tiles, the coarse 2 px configuration) to `.output/`. At 1000x500 on an
   Apple GPU: vanilla 30 ms and 0.007 RMS, bilinear fix 63 ms and 0.005,
   parallax fix 31 ms and 0.0125, reference at 256 rays/px 134 ms. Per-ray
   storage at 1 px spacing is memory-hungry (about 380 MB of cascade textures
   at this size); pre-averaging halves it, render scale 0.5 quarters it.
3. **In the app** (browser-engine target): open the project with the engine
   in a separate tab from `projects.html`, or by hand with
   `/engine/` in one tab and
   `/index.html?serverBaseUrl=http://localhost:7777&projectPath=<absolute path>`
   in another, then Run the module and watch the engine tab, where a line
   under the canvas reports render size, frame rate, and the cascade plan.
   Drag the sun:
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
