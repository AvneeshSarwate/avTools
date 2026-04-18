# Tegaki × p5gpu — notes for `p5gpu_tegaki_handwriting.ts`

## Using a custom font

The sketch loads a pre-generated `glyphData.json` from the vendored tegaki repo. The current demo uses **Charmonman** (Thai script) — it previously used Caveat. To swap in a different font you need two things: **stroke data** and **font metadata**.

### 1. Generate `glyphData.json` for the font

Two options:

- **Web UI** — [gkurt.com/tegaki/generator/](https://gkurt.com/tegaki/generator/). Pick the font, tweak the pipeline settings, download the bundle (`glyphData.json` + `.ttf` + `bundle.ts`).
- **Local CLI** — from the vendored repo:
  ```
  cd clonedCompanionRepos/tegaki
  bun install
  bun start generate <Family Name> --chars "<glyphs>" --output <dir>
  ```
  Entry point: `packages/generator/src/commands/generate.ts`. Defaults (character set, resolution, tolerances) live in `packages/generator/src/constants.ts`. **Gotcha:** `--output <dir>` is resolved relative to the generator package's cwd (`packages/generator/`), not the repo root. To land output at `packages/renderer/fonts/<family>/`, either pass `packages/renderer/fonts/<family>` and `mv` after, or give an absolute path.

  Example (Thai — what this sketch uses now):
  ```
  THAI='กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮะาำัิีึืฺุู่้๊๋์็เแโใไฯๆ๐๑๒๓๔๕๖๗๘๙'
  LATIN='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?:-'
  bun start generate Charmonman --chars "${THAI}${LATIN}" --output packages/renderer/fonts/charmonman
  ```

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

## Native text_engine extension: `cluster` per glyph

The current sketch uses `NativeTextEngine.layoutText()` (Rust + harfrust + swash, at `apps/deno-notebooks/native/text_engine/`) for shaping + wrap + alignment. For scripts with combining marks or ligatures (Thai especially) the shaper's glyph list doesn't 1:1 with input codepoints — a base consonant + vowel + tone mark can emit 2–3 glyphs but all share one HarfBuzz *cluster* (the UTF-8 byte offset of the cluster's base).

Without cluster info there's no reliable way to map a positioned glyph back to its source char. So we extended the Rust + TS binding:

- **Rust side** (`native/text_engine/src/lib.rs`):
  - `ShapedGlyph` and `LayoutGlyphOut` gained a `cluster: u32` field.
  - The wire format's per-glyph record grew from 16 → **20 bytes** (added a trailing `u32 cluster` after `i32 y`). Header layout unchanged.
  - The engine shapes each whitespace-delimited segment independently, so harfrust emits clusters relative to the segment. We rewrote `split_into_segments` to track each segment's byte offset within its hard line, threaded `base_byte_offset` through `layout_word_wrapped` / `layout_glyph_wrapped`, and shift every returned glyph's cluster by `base_byte_offset + seg_byte_offset` so consumers see **absolute UTF-8 offsets** into the original text.

- **TS side** (`tools/p5gpu_text/ffi.ts`):
  - `TextLayoutGlyph` now has `cluster: number`.
  - `parseBinaryLayout` reads 20-byte per-glyph records and extracts `cluster` from offset +16.

- **Rebuild after any Rust change:**
  ```
  cd apps/deno-notebooks/native/text_engine
  cargo build --release
  ```
  The JS side loads `target/release/libtext_engine.dylib` at startup — no Deno restart needed mid-build but the next `NativeTextEngine` instance picks it up.

- **How to use the `cluster` from JS** (what the sketch does):
  ```ts
  // byte offset → source char index lookup
  function buildByteToCharIdx(text: string): Int32Array { ... }

  // group glyphs by cluster; k-th glyph in a cluster-run → k-th char
  // in [byteToChar[cluster], byteToChar[nextClusterByte]).
  ```
  This works for LTR scripts (Thai, Latin) where per-cluster glyph order matches source char order. Bidi text would need more work.

### Thai-specific caveats

- Thai has no inter-word spaces in natural prose; we insert spaces between phrases so the word-wrap segmenter has break opportunities. Proper Thai line breaking is dictionary-based and is not implemented here.
- A few characters (~1 per ~100 in the current demo text) get collapsed/elided by the shaper and don't produce any glyph at all — they'll render as gaps. Acceptable for a POC.
- Combining marks (U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E) have `w: 0` (zero advance) in the tegaki bundle, as expected. Their visual placement above/below the base comes from the shaper's `y_offset` (baked into `glyph.y`), not from tegaki's stroke data.
