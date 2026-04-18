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

## Ligatures

### What a ligature is

A ligature is **one glyph that stands in for two or more characters.** The text on disk still contains two codepoints, but the font substitutes a single combined image when rendering them adjacent.

Two reasons fonts define ligatures:

1. **Typographic quality** — certain letter pairs collide awkwardly with default spacing. Classic case: `fi` — the dot of the `i` crashes into the hook of the `f`, so fonts ship an `fi` glyph where the `f`-hook merges with the `i`-stem and the dot is gone. Also `fl`, `ffi`, `ffl`. These are **standard ligatures**.
2. **Script fidelity** — handwriting / script fonts mimic calligraphy, which joins letters. Charmonman is Zapfino-inspired and has `ll`, `th`, `st`, etc. ligatures so output looks hand-drawn, not letter-stamped. These are **discretionary ligatures**.

### Where in the pipeline

```
"Hello" (5 codepoints, UTF-8 bytes)
   │
   ▼  SHAPING  ← HarfBuzz (harfrust in our Rust engine)
   │           reads OpenType GSUB/GPOS tables,
   │           applies features: liga, clig, kern, mark, ...
   ▼
[glyph_H, glyph_e, glyph_ll, glyph_o]   ← 4 glyphs, not 5
   │
   ▼  RASTERIZATION  ← swash / freetype / browser
   ▼
pixels
```

OpenType feature tags (4 letters each) control which substitutions run:

| tag    | name                     | default                  |
|--------|--------------------------|--------------------------|
| `liga` | standard ligatures       | ON                       |
| `clig` | contextual ligatures     | ON                       |
| `dlig` | discretionary ligatures  | OFF                      |
| `calt` | contextual alternates    | ON                       |
| `rlig` | required ligatures       | always ON (Arabic needs it) |

Passing a feature with value `0` tells HarfBuzz "skip this substitution."

### How this manifested here

Probe output for Charmonman with default features:

```
"Hello World"   chars=11  glyphs=10  clusters=[0,1,2,4,5,6,7,8,9,10]
"ll"            chars=2   glyphs=1   clusters=[0]
"lll"           chars=3   glyphs=2   clusters=[0,2]
```

`"ll"` produces one glyph with cluster 0 — Charmonman has an `ll` → one glyph rule. `"Hello World"` is missing cluster 3 (the second `l`): that byte is consumed by the `ll` ligature centered at cluster 2.

The sketch's cluster-run grouping looks for consecutive glyphs with the same cluster, so `ll`'s single glyph produces a run of length 1, and only `chars[2]` gets a `GlyphState`. `chars[3]` silently drops off — the second `l` vanishes.

### Option 1: disable ligatures at shape time (✅ implemented)

`TextLayoutRequest` has a `disableLigatures?: boolean` field (default `false`). When `true`, the Rust shaper passes:

```rust
[b"liga", b"clig", b"dlig", b"calt"]
    .iter()
    .map(|tag| harfrust::Feature::new(harfrust::Tag::new(*tag), 0, ..))
    .collect::<Vec<_>>()
```

as the features argument to `shape`. The flag is threaded through the FFI (`text_engine_layout_json` gained a `disable_ligatures: u32` parameter before `out_ptr`) and is part of `ShapeCacheKey` so the same text can be shaped both ways without cache collision.

In the sketch:
```ts
const layout = engine.layoutText({
  text, family: "Charmonman", fontSize, lineHeight, width: MAX_WIDTH,
  ...
  disableLigatures: true,
});
```

Verification probe output (with the flag):
```
"Hello World"   chars=11 glyphs=11 clusters=[0,1,2,3,4,5,6,7,8,9,10]
"ll"            chars=2  glyphs=2  clusters=[0,1]
"lll"           chars=3  glyphs=3  clusters=[0,1,2]
```

Trade-off: rendered text loses the joined-cursive aesthetic. For our per-codepoint phase animation this is fine (arguably correct — see below). The reference HTML (`p5gpu_tegaki_handwriting_reference.html`) also sets `font-feature-settings: "liga" 0, "clig" 0, "dlig" 0, "calt" 0` so visual comparison stays apples-to-apples.

### Option 2: render the font's actual ligatures

Keep ligatures on at shape time, give tegaki stroke data for the ligature glyphs, and look up by **glyph ID** rather than codepoint.

#### Why you'd want this

When playing the animation as a smooth "person writing this paragraph" reveal, fidelity to the font's intended cursive joins matters. `ll` as one joined stroke run looks handwritten; two independent `l`s with a gap looks stamped.

#### Why it doesn't fit our *current* sketch

The premise is per-codepoint phase retriggering — "flash the second `l` independently of the first." A ligature is, by definition, one joined glyph where the two `l`s share ink (a connecting stroke, shared tail). Tegaki skeletonizes that joined shape into **one** polyline run. So even with ligature stroke data, "retrigger the second l" is a meaningless operation — there's no independently retriggerable second `l`.

Option 2 is the right answer for **full-text playback animations**, not per-char effects.

#### What implementing it requires

Four ripples, roughly ordered by cost:

**1. Expose HarfBuzz glyph IDs through the FFI.** `layout.glyphs[i].key` is currently a cache-packed hash (font_id + glyph_id + font_size + axes), not the raw glyph ID. Add a `glyphId: u16` field to the wire format — same mechanical pattern as the cluster work, ~2-byte bump per record (so 20 → 22 bytes, or round up to 24 for alignment). Rust `ShapedGlyph` already has `glyph_id`, so just thread it through. **Low effort.**

**2. Regenerate the tegaki bundle with glyph-id-keyed stroke data.** Tegaki's generator has a `--ligatures` boolean (see `pipelineOptionsSchema.ligatures` in `packages/generator/src/commands/generate.ts`) but it's primarily about whether the CSS `font-feature-settings` in the bundle enables ligatures — it doesn't by itself emit extra glyph entries for ligature glyphs. Two paths:

- **Clean path — extend the generator.** Teach `extractTegakiBundle` / the CLI to also iterate the font's non-codepoint ligature glyphs (opentype.js exposes them via `font.glyphs` + `font.substitution` / by scanning GSUB). Run each through the existing `processGlyph` pipeline and emit a second map: `glyphDataByGid: Record<number, TegakiGlyphData>`. Keep the codepoint map for simple cases. This is the right long-term move — probably worth upstreaming.
- **Hack path — side-car script.** Don't touch tegaki. Write a script that imports tegaki's exported `processGlyph` / `parseFont` (pure functions, no file I/O), loads `charmonman.ttf`, enumerates ligature glyphs via opentype.js, runs each through the pipeline, and emits `glyphDataByGid.json` next to the existing `glyphData.json`. Duplicates some pipeline knowledge but isolates the change.

**Medium effort.** Mostly glue.

**3. Change the sketch's lookup.** `glyphStates.push({ glyph: glyphData[ch], ... })` becomes:

```ts
const td = glyphDataByGid[g.glyphId] ?? glyphData[ch] ?? null;
// ^ prefer glyph-id data for ligatures, fall back to per-codepoint.
```

Keep `state.ch` for debugging (now a "primary char" hint rather than the key). **Low effort.**

**4. Rethink animation semantics.** With ligatures, your ECS unit is "one laid-out glyph" which may span multiple source codepoints. Random retriggering affects whichever chars a ligature covers. Some UX that lives in codepoint space becomes awkward (e.g., "flash word boundaries" — word boundaries are in codepoint space, but glyph space is where you're animating). Usually solvable by keeping both indices on each `GlyphState` and deciding at trigger time.

**Low-to-medium effort.** More design than code.

#### Summary table

| | Option 1 (disable ligatures) | Option 2 (ligatures + glyph-id lookup) |
|---|---|---|
| Code change | ~10 lines Rust + sketch | ~100 lines: FFI + generator/side-car + bundle + sketch |
| Font fidelity | lower (no joined cursive) | higher (honors the font's shaping) |
| Per-codepoint animation control | clean | lost — the glyph becomes the unit |
| Good fit for | random retrigger, per-char effects | playback-reveal "someone is writing this" |

If you ever want "type out this paragraph like a person is writing it, one stroke at a time, with proper Zapfino-esque joins" — that's Option 2 territory.
