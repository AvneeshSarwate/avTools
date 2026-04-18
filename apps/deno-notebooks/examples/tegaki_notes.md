# Tegaki × p5gpu — notes for `p5gpu_tegaki_handwriting.ts`

## Using a custom font

The sketch loads Caveat's pre-generated `glyphData.json` from the vendored tegaki repo. To swap in a different font you need two things: **stroke data** and **font metadata**.

### 1. Generate `glyphData.json` for the font

Two options:

- **Web UI** — [gkurt.com/tegaki/generator/](https://gkurt.com/tegaki/generator/). Pick the font, tweak the pipeline settings, download the bundle (`glyphData.json` + `.ttf` + `bundle.ts`).
- **Local CLI** — from the vendored repo:
  ```
  cd clonedCompanionRepos/tegaki
  bun start generate --font "<Family Name>" --chars "<glyphs>" --output <dir>
  ```
  Entry point: `packages/generator/src/commands/generate.ts`. Defaults (character set, resolution, tolerances) live in `packages/generator/src/constants.ts`.

### 2. Update the font metadata in the sketch

The POC hard-codes Caveat's metadata:

```ts
const FONT_META = {
  unitsPerEm: 1000,
  ascender: 960,
  descender: -300,
};
```

These values come from `bundle.ts` that the generator emits next to `glyphData.json`. Copy them from there (or parse them out of the font directly with opentype.js). `unitsPerEm` is used to scale font units → pixels; `ascender` shifts glyph y-coordinates (which are negative above the baseline) into the screen-down em square.

For a minimal try, swapping to one of the other vendored bundles just works — the metadata is close enough across the prebuilt fonts that the Caveat values render them fine as a POC:

```
clonedCompanionRepos/tegaki/packages/renderer/fonts/{italianno,tangerine,parisienne}/glyphData.json
```

## Gotchas

### Tegaki assumes handwriting / script fonts

The pipeline rasterizes → skeletonizes → traces polylines → assigns stroke order. This works well for thin, roughly uniform strokes (the bundled fonts are all script). On heavy display, sans, or serif fonts:

- The medial-axis / Zhang-Suen skeleton produces noisy spurs on thick terminals, which get proportionally pruned — but the pruning threshold scales with bitmap size, so results vary by glyph.
- Stroke order is a top-to-bottom / left-to-right heuristic over connected components. Multi-part glyphs (e.g. `i`, `j`, `%`) and enclosed counters (inside of `O`, `P`) can come out in a visually weird order.
- For fonts with filled bowls (bold/black weights), the skeleton collapses the whole bowl to a stick, losing the shape entirely.

Fixes if needed: try `--skeletonize voronoi-medial-axis` or tweak `--resolution` / pruning options via the generator CLI.

### Only requested characters are in the bundle

`generate` processes the `--chars` set only. Characters not in the bundle just get skipped by the sketch (no fallback). If animated text needs punctuation, numbers, or non-ASCII, include them at generate time.

### Coordinate system quirk

Glyph points are stored in **font units with y-up-from-baseline flipped to y-down-screen** (opentype's `glyph.getPath()` convention). That's why y values in the JSON are negative above the baseline. The sketch maps to pixels via:

```
px = origin_x + x * (fontSize / unitsPerEm)
py = origin_y + (y + ascender) * (fontSize / unitsPerEm)
```

where `origin_y` is the **top of the em square**, not the baseline. If you're copy-pasting the render logic elsewhere, that +ascender shift is easy to miss.

### Bundle format version

`bundle.ts` carries a `version` field (currently `0`). If tegaki ever bumps the schema, a regenerated bundle may not line up with the POC's assumed shape (`{p, d, a}` per stroke, `[x, y, width]` per point). See `packages/renderer/src/types.ts` → `TegakiGlyphData` for the authoritative layout.
