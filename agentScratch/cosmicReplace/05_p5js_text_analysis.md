# p5.js 2.0 Text Rendering Analysis

Source code at: `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/p5.js/`

## File Map

| File | Purpose |
|------|---------|
| `src/type/textCore.js` | All text API methods added to `Renderer.prototype` (text, textWidth, textAscent, textDescent, textWeight, textWrap, etc.). Word wrapping, line splitting, font-string construction, and `_applyTextProperties`. |
| `src/type/p5.Font.js` | `p5.Font` class, `loadFont()`, glyph-level path extraction (textToPaths, textToPoints, textToModel). Uses Typr.js for raw glyph data. |
| `src/core/p5.Renderer2D.js` (lines 1140-1242) | `_renderText()`, `_positionLines()`, `_yAlignOffset()`, `textDrawingContext()`, `textCanvas()` for the 2D canvas renderer. |
| `src/core/p5.Renderer.js` (lines 395-408) | `_middleAlignOffset()` helper for CENTER vertical alignment. |

---

## 1. How `text(str, x, y, width, height)` Works

### Entry Point

**File:** `src/type/textCore.js`, line 1340

```js
Renderer.prototype.text = function (str, x, y, width, height) {

    let setBaseline = this.textDrawingContext().textBaseline; // store baseline

    // adjust {x,y,w,h} properties based on rectMode
    ({ x, y, width, height } = this._handleRectMode(x, y, width, height));

    // parse the lines according to width, height & linebreaks
    let lines = this._processLines(str, width, height);

    // add the adjusted positions [x,y] to each line
    lines = this._positionLines(x, y, width, height, lines);

    // render each line at the adjusted position
    lines.forEach(line => this._renderText(line.text, line.x, line.y));

    this.textDrawingContext().textBaseline = setBaseline; // restore baseline
};
```

### Pipeline: 4 Steps

1. **`_handleRectMode(x, y, width, height)`** (textCore.js line 1933) -- adjusts x/y/width/height based on the current `rectMode` (CENTER, CORNERS, RADIUS). For default CORNER mode, no change.

2. **`_processLines(str, width, height)`** (textCore.js line 2039) -- THIS IS WHERE WORD WRAPPING HAPPENS. Detailed below.

3. **`_positionLines(x, y, width, height, lines)`** (p5.Renderer2D.js line 1180) -- converts the flat array of line strings into `{ text, x, y }` objects, applying horizontal alignment (LEFT/CENTER/RIGHT) and vertical alignment (TOP/BASELINE/CENTER/BOTTOM) offsets.

4. **`_renderText(text, x, y)`** (p5.Renderer2D.js line 1150) -- calls `ctx.fillText(text, x, y)` and optionally `ctx.strokeText(text, x, y)`. **One call per line of text.** Not per character, not per word.

### Key Finding: Rendering Granularity

p5.js calls `ctx.fillText()` **once per line**. A single `text("Hello world", x, y)` call with no wrapping results in exactly one `ctx.fillText()` call. A wrapped string that becomes 5 lines results in 5 `ctx.fillText()` calls.

---

## 2. Word Wrapping: `_processLines` and `_lineate`

### `_processLines(str, width, height)` -- textCore.js line 2039

```js
Renderer.prototype._processLines = function (str, width, height) {

    if (typeof width !== 'undefined') {
        let drawingContext = this.textDrawingContext();
        if (drawingContext.textBaseline === fn.BASELINE) {
            this.drawingContext.textBaseline = fn.TOP;
        }
    }

    let lines = this._splitOnBreaks(str.toString());
    let hasLineBreaks = lines.length > 1;
    let hasWidth = typeof width !== 'undefined';
    let exceedsWidth = hasWidth &&
        lines.some(l => this._textWidthSingle(l) > width);
    let { textLeading: leading, textWrap } = this.states;

    if (hasLineBreaks || exceedsWidth) {
        if (hasWidth) lines = this._lineate(textWrap, lines, width);
    }

    // handle height truncation
    if (hasWidth && typeof height !== 'undefined') {
        for (let i = 0; i < lines.length; i++) {
            let lh = leading * (i + 1);
            if (lh > height) {
                lines = lines.slice(0, i);
                break;
            }
        }
    }

    return lines;
};
```

**Step 1:** Split on `\r?\n` newlines and replace tabs with double-spaces (`_splitOnBreaks`, line 2264).

**Step 2:** If width is provided AND any line exceeds the width, call `_lineate()` to do word wrapping.

**Step 3:** If height is provided, truncate lines that exceed the height (based on `textLeading` -- lines * leading > height).

### `_lineate(textWrap, lines, maxWidth)` -- textCore.js line 2233

```js
Renderer.prototype._lineate = function (textWrap, lines, maxWidth = Infinity, opts = {}) {

    let splitter = opts.splitChar ?? (textWrap === fn.WORD ? ' ' : '');
    let line, testLine, testWidth, words, newLines = [];

    for (let lidx = 0; lidx < lines.length; lidx++) {
        line = '';
        words = lines[lidx].split(splitter);
        for (let widx = 0; widx < words.length; widx++) {
            testLine = `${line + words[widx]}` + splitter;
            testWidth = this._textWidthSingle(testLine);
            if (line.length > 0 && testWidth > maxWidth) {
                newLines.push(line.trim());
                line = `${words[widx]}` + splitter;
            } else {
                line = testLine;
            }
        }
        newLines.push(line.trim());
    }
    return newLines;
};
```

This is a classic greedy word-wrap algorithm:

- **WORD mode** (`textWrap(WORD)`): splits on spaces. Adds words to the current line until the **tight width** (via `_textWidthSingle`) exceeds `maxWidth`, then starts a new line.
- **CHAR mode** (`textWrap(CHAR)`): splits on empty string (every character). Same greedy algorithm but character-by-character.

### Cost of Word Wrapping

For each candidate line during wrapping, p5 calls `_textWidthSingle(testLine)` which calls `ctx.measureText(testLine)`. So for a paragraph with N words, word wrapping calls `ctx.measureText()` approximately N times.

---

## 3. Canvas2D APIs Called Under the Hood

### For `text(str, x, y)` (no wrapping)

| Step | Canvas2D API | Count |
|------|-------------|-------|
| Wrap check | `ctx.measureText(str)` | 1 (to check if `_textWidthSingle > width`) |
| Render | `ctx.fillText(str, x, y)` | 1 per line |
| Render (if stroke set) | `ctx.strokeText(str, x, y)` | 1 per line |

For a simple `text("A", x, y)` call: 0 measureText calls (no width arg), 1 fillText call.

### For `text(str, x, y, width, height)` (with wrapping)

| Step | Canvas2D API | Count |
|------|-------------|-------|
| Width check | `ctx.measureText(line)` | Once per pre-split line (to check if wrapping needed) |
| Word wrapping | `ctx.measureText(testLine)` | ~N times (N = word count) |
| Render | `ctx.fillText(lineStr, x, y)` | Once per output line |

**p5.js does NOT call `ctx.fillText` per character.** It calls it once per wrapped line. This is efficient.

---

## 4. `textWidth()` -- How It Works

**File:** `src/type/textCore.js`, line 1405

```js
Renderer.prototype.textWidth = function (theText) {
    let lines = this._processLines(theText);
    // return the max width of the lines (using tight bounds)
    return Math.max(...lines.map(l => this._textWidthSingle(l)));
};
```

And `_textWidthSingle` (line 2153):

```js
Renderer.prototype._textWidthSingle = function (s) {
    let metrics = this.textDrawingContext().measureText(s);
    let abl = metrics.actualBoundingBoxLeft;
    let abr = metrics.actualBoundingBoxRight;
    return abr + abl;
};
```

**Key detail:** p5 2.0 uses **tight bounds** (`actualBoundingBoxLeft + actualBoundingBoxRight`), NOT `metrics.width`. This means leading/trailing whitespace is excluded from the measurement. The `fontWidth()` method (line 2163) uses `metrics.width` for "loose" bounds.

Both ultimately delegate to `ctx.measureText()` -- no custom shaping.

---

## 5. `textAscent()` and `textDescent()`

**File:** `src/type/textCore.js`, lines 1429-1455

```js
Renderer.prototype.textAscent = function (txt = '') {
    if (!txt.length) return this.fontAscent();
    return this.textDrawingContext().measureText(txt).actualBoundingBoxAscent;
};

Renderer.prototype.fontAscent = function () {
    return this.textDrawingContext().measureText('_').fontBoundingBoxAscent;
};

Renderer.prototype.textDescent = function (txt = '') {
    if (!txt.length) return this.fontDescent();
    return this.textDrawingContext().measureText(txt).actualBoundingBoxDescent;
};

Renderer.prototype.fontDescent = function () {
    return this.textDrawingContext().measureText('_').fontBoundingBoxDescent;
};
```

- **`textAscent()`** with no args: returns `ctx.measureText('_').fontBoundingBoxAscent` -- the font's intrinsic ascent.
- **`textAscent("Hello")`** with a string: returns `ctx.measureText("Hello").actualBoundingBoxAscent` -- tight ascent for that specific string.
- Same pattern for descent.

All metrics come from Canvas2D `measureText()`. p5 does zero custom font metric calculation for system/CSS fonts.

---

## 6. Variable Font Weights: `textWeight()`

**File:** `src/type/textCore.js`, line 1571

```js
Renderer.prototype.textWeight = function (weight) {
    // the setter
    if (typeof weight === 'number') {
        this.states.setValue('fontWeight', weight);
        this._applyTextProperties();

        // Safari workaround
        if (!p5.prototype._isSafari()) {
            this._setCanvasStyleProperty('font-variation-settings', `"wght" ${weight}`);
        }
        return;
    }
    // the getter
    return this.states.fontWeight;
};
```

### What happens when you call `textWeight(weight)`:

1. **Sets `this.states.fontWeight = weight`** (a number like 400, 700, etc.)

2. **Calls `_applyTextProperties()`** (line 2338), which calls **`_applyFontString()`** (line 2286):

```js
Renderer.prototype._applyFontString = function () {
    let { textFont, textSize, lineHeight, fontStyle, fontWeight, fontVariant } = this.states;
    let drawingContext = this.textDrawingContext();

    let family = this._parseFontFamily(textFont.family);
    let style = fontStyle !== fn.NORMAL ? `${fontStyle} ` : '';
    let weight = fontWeight !== fn.NORMAL ? `${fontWeight} ` : '';
    let variant = fontVariant !== fn.NORMAL ? `${fontVariant} ` : '';
    let fsize = `${textSize}px` + (lineHeight !== fn.NORMAL ? `/${lineHeight} ` : ' ');
    let fontString = `${style}${variant}${weight}${fsize}${family}`.trim();

    // set the font string on the context
    drawingContext.font = fontString;
};
```

This constructs a CSS font shorthand string like `"700 16px sans-serif"` and assigns it to `ctx.font`.

3. **Sets `canvas.style.fontVariationSettings = '"wght" <weight>'`** on the actual canvas DOM element (not the context). This is needed for Chrome/Firefox to correctly render variable fonts with non-standard weights. Safari is explicitly excluded due to a bug where setting this causes wrong weights when drawing multiple times with different weights.

### The font-string for weight 632 at size 16 with sans-serif would be:
```
"632 16px sans-serif"
```

This gets assigned to `ctx.font` every time `_applyTextProperties()` is called.

---

## 7. Per-Frame Cost Model: 900 `text("A", x, y)` Calls with Different Weights

### Scenario: In `draw()`, calling `textWeight(w); text("A", x, y);` 900 times with varying weights.

Here is what happens for EACH of the 900 calls:

#### `textWeight(w)` -- cost per call:
1. `this.states.setValue('fontWeight', w)` -- trivial JS property set
2. `_applyTextProperties()` which calls:
   - `_applyFontString()`:
     - Constructs font string (JS string concatenation -- cheap)
     - **`ctx.font = fontString`** -- THIS IS THE EXPENSIVE PART. The browser must parse the font string, resolve the font family, and prepare for rendering at the new weight.
   - Sets `ctx.direction`, `ctx.textAlign`, `ctx.textBaseline` (3 property sets)
   - Checks/sets `ctx.fontStretch` if non-normal
3. On non-Safari: `canvas.style.fontVariationSettings = '"wght" <w>'` -- DOM style manipulation

#### `text("A", x, y)` -- cost per call (no width/height):
1. `this.textDrawingContext().textBaseline` -- read property
2. `_handleRectMode(x, y, undefined, undefined)` -- trivial, no width so no adjustment
3. `_processLines("A", undefined, undefined)`:
   - `_splitOnBreaks("A")` -- returns `["A"]` (no newlines)
   - No width provided, so no `_textWidthSingle` check, no `_lineate` call
   - Returns `["A"]`
4. `_positionLines(x, y, undefined, undefined, ["A"])`:
   - Computes adjustedX based on textAlign
   - Returns `[{ text: "A", x, y }]`
5. `_renderText("A", x, y)`:
   - `this.push()` -- **saves canvas state** (`ctx.save()`)
   - Checks strokeColor/strokeSet
   - **`ctx.fillText("A", x, y)`** -- the actual rendering call
   - `this.pop()` -- **restores canvas state** (`ctx.restore()`)
6. Restores textBaseline

### Total Canvas2D API calls per iteration (textWeight + text):

| API Call | Count | Notes |
|----------|-------|-------|
| `ctx.font = ...` | 1 | Parses new font string with new weight |
| `ctx.direction = ...` | 1 | |
| `ctx.textAlign = ...` | 1 | |
| `ctx.textBaseline = ...` | 2 | Set in _applyTextProperties + restore at end |
| `canvas.style.fontVariationSettings = ...` | 1 | DOM style write (non-Safari) |
| `ctx.save()` | 1 | From push() |
| `ctx.fillText("A", x, y)` | 1 | The actual rendering |
| `ctx.restore()` | 1 | From pop() |
| **Total** | **~9** | Per character rendered |

### For 900 characters per frame:

- **900 x `ctx.font = ...` assignments** -- This is the dominant cost. Each assignment forces the browser to resolve the font at the new weight.
- **900 x `canvas.style.fontVariationSettings = ...`** -- DOM style write per character (non-Safari)
- **900 x `ctx.save()` / `ctx.restore()` pairs** -- Canvas state save/restore overhead
- **900 x `ctx.fillText()`** calls -- The actual GPU text rasterization
- **0 x `ctx.measureText()`** calls -- no measurement happens for simple `text("A", x, y)` without width/height

### Does Canvas2D Cache Font Instances?

Browsers do cache font face objects internally, but **changing `ctx.font` is not free even if the font family is the same**. The browser must:
1. Parse the CSS font shorthand string
2. Resolve weight/style/size against available font faces
3. For variable fonts, interpolate glyph outlines to the requested weight

Whether the browser caches the intermediate weight-interpolated glyph data is browser-dependent. Chrome's Skia backend has some caching, but 900 distinct weights would likely exceed any font glyph cache.

### The `canvas.style.fontVariationSettings` Issue

The DOM style write (`canvas.style.fontVariationSettings = '"wght" <w>'`) is particularly concerning:
- It modifies the live DOM, which can trigger style recalc
- It's done on every weight change, even for the same font
- Safari is excluded because it causes rendering bugs with multiple weights

---

## 8. Does p5.js Do Any Text Shaping Itself?

**NO, for 2D Canvas rendering.** p5.js delegates 100% of text shaping to the browser's Canvas2D:

- **Text rendering:** `ctx.fillText()` / `ctx.strokeText()`
- **Text measurement:** `ctx.measureText()`
- **Font selection/weight:** `ctx.font = "weight size family"`
- **Line breaking:** p5 does its own greedy word-wrap, but uses `ctx.measureText()` to get word widths
- **No BiDi handling:** delegates to `ctx.direction`
- **No kerning/ligature handling:** delegates to the browser

The `Typr.js` library (in `src/type/lib/Typr.js`) IS used for glyph-level path extraction (`textToPaths`, `textToPoints`, `textToModel`), but this is only for extracting vector paths from loaded font files -- it is NOT used for regular 2D text rendering.

---

## 9. Summary: What p5.js Abstracts vs. What It Delegates

| Concern | p5.js does it? | Delegates to |
|---------|---------------|-------------|
| Word wrapping | YES (greedy algorithm in `_lineate`) | Uses `ctx.measureText()` for widths |
| Line breaking on `\n` | YES (`_splitOnBreaks`) | -- |
| Height truncation | YES (in `_processLines`) | -- |
| Text alignment | YES (in `_positionLines`, `_yAlignOffset`) | -- |
| Glyph shaping | NO | `ctx.fillText()` |
| Kerning | NO | Browser's text engine |
| BiDi | NO | `ctx.direction` |
| Font weight | NO (just sets CSS string) | `ctx.font` + `canvas.style.fontVariationSettings` |
| Font metrics | NO | `ctx.measureText()` properties |
| Text rasterization | NO | Browser's Canvas2D |

---

## 10. Implications for a Custom Text Rendering Pipeline

If you were to replicate p5.js 2.0's text rendering outside a browser (e.g., in Deno with WebGPU):

1. **Word wrapping** is straightforward JS -- just port `_lineate` and `_processLines`. The only dependency is a `measureText()` equivalent.

2. **The entire rendering path** depends on `ctx.fillText()`. There is no fallback glyph-by-glyph rendering path in 2D mode.

3. **Variable font weights** require both `ctx.font` string construction AND `canvas.style.fontVariationSettings`. In a non-browser environment, you'd need to handle font variation axis interpolation yourself.

4. **Font metrics** (`textAscent`, `textDescent`, `textWidth`) all come from `ctx.measureText()` properties (`actualBoundingBoxAscent`, `actualBoundingBoxDescent`, `actualBoundingBoxLeft`, `actualBoundingBoxRight`, `fontBoundingBoxAscent`, `fontBoundingBoxDescent`, `width`).

5. **For 900 per-frame text calls with different weights**, p5.js sets `ctx.font` 900 times per frame. The browser's font engine handles all caching (or lack thereof). There is no p5-level optimization for this case -- no batching, no atlas, no font caching.
