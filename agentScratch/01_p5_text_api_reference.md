# p5.js 2.0 Typography API -- Complete Reference

Source: `dev-2.0` branch of `processing/p5.js`
Key files: `src/type/textCore.js`, `src/type/p5.Font.js`, `src/core/p5.Renderer2D.js`

---

## 1. FONT LOADING

### `loadFont(path, [name], [options], [successCallback], [failureCallback])`

Returns: `Promise<p5.Font>`

**Supported inputs:**
- Local font file paths: `.ttf`, `.otf`, `.woff` (NOT `.woff2`)
- Remote font URLs
- CSS file URLs (e.g. Google Fonts)
- Raw `@font-face` CSS strings

**Options:**
- `sets` (String|Array) -- Unicode range filter for CSS fonts (default: `['latin']`)
- Standard FontFace descriptors: `weight`, `style`, `stretch`, `display`, `unicodeRange`

**Internals:** Uses `Typr.js` for binary font parsing (replaces opentype.js from v1). Creates `FontFace`, adds to `document.fonts`. Variable fonts auto-detect `fvar` axes.

---

## 2. TEXT RENDERING

### `text(str, x, y, [maxWidth], [maxHeight])`

**2D rendering pipeline:**
1. `_handleRectMode(x, y, w, h)` -- adjusts coords for CORNER/CENTER/RADIUS/CORNERS
2. `_processLines(str, w, h)` -- splits on `\n`, replaces tabs, wraps via `_lineate()`, truncates by height
3. `_positionLines(x, y, w, h, lines)` -- applies horizontal alignment + vertical baseline offset
4. For each line: `_renderText(text, x, y)` -- calls `context.fillText()` and optionally `context.strokeText()`

**Key detail:** Uses `fill()` color for text, `stroke()` + `strokeWeight()` for outlines. Default fill is `#000000`.

**WebGL mode:** Uses a completely different approach -- glyph outlines stored as quadratic Bezier curves in texture atlases, GPU shader evaluates curves per-pixel (resolution-independent). **Requires** fonts loaded with `loadFont()`.

---

## 3. TEXT STATE FUNCTIONS (setter/getter pattern)

| Function | Default | Values |
|----------|---------|--------|
| `textFont(font, size?)` | `{family: 'sans-serif'}` | p5.Font, string name, or CSS font string |
| `textSize(size)` | `12` | Number (pixels) |
| `textLeading(leading)` | `textSize * 1.275` | Number (pixels) |
| `textStyle(style)` | `NORMAL` | `NORMAL`, `ITALIC`, `BOLD`, `BOLDITALIC` |
| `textWeight(weight)` | `NORMAL` | Number (100-900) -- **new in 2.0** |
| `textAlign(horiz, vert?)` | `LEFT, BASELINE` | H: `LEFT/CENTER/RIGHT` V: `TOP/BOTTOM/CENTER/BASELINE` |
| `textWrap(style)` | `WORD` | `WORD`, `CHAR` |
| `textDirection(dir)` | `'inherit'` | `'ltr'`, `'rtl'`, `'inherit'` -- **new in 2.0** |

---

## 4. TEXT MEASUREMENT

| Function | Returns | Method |
|----------|---------|--------|
| `textWidth(text)` | Number (px) | Tight: `actualBoundingBoxLeft + Right` |
| `fontWidth(text)` | Number (px) | Loose: `measureText().width` -- **new** |
| `textAscent([txt])` | Number (px) | No arg: font metric. With arg: actual pixel ascent |
| `textDescent([txt])` | Number (px) | No arg: font metric. With arg: actual pixel descent |
| `fontAscent()` | Number (px) | Font's intrinsic ascent -- **new** |
| `fontDescent()` | Number (px) | Font's intrinsic descent -- **new** |

---

## 5. BOUNDING BOXES

| Function | Returns | Description |
|----------|---------|-------------|
| `textBounds(str, x, y, w?, h?)` | `{x,y,w,h}` | **Tight** pixel bounding box |
| `fontBounds(str, x, y, w?, h?)` | `{x,y,w,h}` | **Loose** font-metric box -- **new** |

---

## 6. p5.Font METHODS (on loaded fonts)

- `font.textToPoints(str, x, y, w?, h?, opts?)` -- Array of `{x,y,alpha}` points
- `font.textToContours(str, x, y, w?, h?, opts?)` -- Array of contour arrays
- `font.textToPaths(str, x, y, w?, h?, opts?)` -- Flat path commands (M/L/Q/C/Z)
- `font.textToModel(str, x, y, w?, h?, opts?)` -- 3D geometry (WebGL)
- `font.variations()` -- Variable font axes
- `font.metadata()` -- Font metadata

---

## 7. CONSTANTS

```
NORMAL     = 'normal'      BOLD      = 'bold'
ITALIC     = 'italic'      BOLDITALIC = 'bold italic'
LEFT       = 'left'        CENTER    = 'center'      RIGHT  = 'right'
TOP        = 'top'         BOTTOM    = 'bottom'       BASELINE = 'alphabetic'
WORD       = 'WORD'        CHAR      = 'CHAR'
```

## 8. WRAPPING ALGORITHM (`_lineate`)

- WORD: splits on spaces, tests each word against maxWidth
- CHAR: splits on every character
- Height truncation: removes lines where `leading * (i+1) > height`

## 9. KEY v2.0 CHANGES

- Font parsing: opentype.js → Typr.js
- `loadFont()` now async, supports CSS/Google Fonts
- New: `textWeight()`, `textDirection()`, `fontWidth()`, `fontAscent/Descent()`, `fontBounds()`
- New: `textProperty()` / `textProperties()` for batch get/set
- `rectMode` now affects `text()` positioning
- WebGL text: bitmap atlas → shader-based curve evaluation
