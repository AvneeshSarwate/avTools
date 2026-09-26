# feature-drawing-radiance-cascades

Lights the outlines of a drawing with 2D radiance cascades on WebGPU. A
canvas view of a checked-in drawing, a params pane, and a surface view showing
the render, which follows every revision of the drawing, the ~30 a second
streamed while a shape is dragged included. Only the outlines (strokes) of the
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
  parallax fix), direction pre-averaging, interval overlap.
- **march**: distance-field sphere tracing between outlines (off marches
  fixed steps everywhere) and the in-outline step size.
- **light**: sky radiance for rays that leave the top cascade, and bounce
  strength (last frame's irradiance at the outline, cosine-weighted over the
  outward hemisphere, times albedo, fed back as emission).
- **render**: render scale, exposure, and the view: final irradiance, the
  brute-force reference, any cascade's merged or raw radiance (direction
  tiles), or the scene's emission, emission + bounce, transmittance, albedo,
  or distance field.

The output is per-pixel irradiance, including in empty space, as an
`rgba16float` texture (`renderer.irradiance`, a shader-fx effect that chains
into the generated-raw post effects).

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
   raw tiles) to `.output/`.
3. **In the app** (browser-engine target, canvas views mirror only same-realm):
   `/index.html?serverBaseUrl=http://localhost:7777&projectPath=<absolute path>&engine=inprocess`,
   then Run the module. Drag the sun: the render follows mid-gesture. Switch
   the merge mode: vanilla leaks light into the boulder and rings the sun,
   the bilinear fix does neither. Set a shape's `transmittance` to
   `[1, 0.3, 0.3]` in the metadata editor and it becomes red glass. Raise
   bounce and the wall's shadow side fills in over a few frames. Compare the
   reference view with the final.

Editing the library needs a page reload to take effect (relative imports are
not cache-busted); editing the module does not.
