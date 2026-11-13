# p5gpu — dense reference

Source: `../tools/p5gpu.ts`. GPU-accelerated p5-like immediate-mode 2D drawing. Draws into an off-screen `GPUTexture` which you feed into a shader-fx chain.

## Lifecycle

```ts
const p5 = new P5GPU(device, { width, height });
// per frame:
p5.beginFrame();
// … draw calls …
const tex: GPUTexture = p5.endFrame();
// … eventually:
p5.dispose();
```

`beginFrame()` clears internal batches. `endFrame()` submits the draw commands and returns the rendered texture.

## Drawing primitives

```ts
p5.clear();                         // clear to transparent
p5.background(r, g, b, a?);         // fill to opaque color (use instead of clear for solid bg)
p5.circle(x, y, diameter);
p5.ellipse(x, y, w, h?);
p5.rect(x, y, w, h?, tl?, tr?, br?, bl?);
p5.square(x, y, size, tl?, tr?, br?, bl?);
p5.triangle(x1, y1, x2, y2, x3, y3);
p5.quad(x1, y1, x2, y2, x3, y3, x4, y4);
p5.line(x1, y1, x2, y2);
p5.point(x, y);
p5.arc(x, y, w, h, start, stop, mode?);    // mode: p5.OPEN | p5.CHORD | p5.PIE
p5.bezier(x1,y1, x2,y2, x3,y3, x4,y4);
p5.curve(x1,y1, x2,y2, x3,y3, x4,y4);
```

## Custom shapes

```ts
p5.beginShape(kind?);               // kind: p5.POINTS | p5.LINES | p5.TRIANGLES | p5.TRIANGLE_FAN | p5.TRIANGLE_STRIP | p5.QUADS | p5.QUAD_STRIP | undefined (closed polygon)
p5.vertex(x, y);
p5.curveVertex(x, y);
p5.bezierVertex(x2, y2, x3, y3, x4, y4);
p5.quadraticVertex(cx, cy, x3, y3);
p5.beginContour(); /* … */ p5.endContour();   // holes in polygons
p5.endShape(mode?);                            // mode: p5.CLOSE or undefined
```

## Style

```ts
p5.fill(v1, v2?, v3?, a?);          // (gray), (gray,a), (r,g,b), (r,g,b,a)
p5.noFill();
p5.stroke(v1, v2?, v3?, a?);
p5.noStroke();
p5.strokeWeight(w);
p5.strokeCap(p5.ROUND | p5.SQUARE | p5.PROJECT);
p5.strokeJoin(p5.MITER | p5.BEVEL | p5.ROUND);
p5.colorMode(mode, max1?, max2?, max3?, maxA?);   // mode: p5.RGB | p5.HSB | p5.HSL — changes value ranges for all subsequent fill/stroke/background calls
p5.blendMode(mode);                 // p5.BLEND | (other blend constants)
p5.erase(fillStr?, strokeStr?);     // subsequent draws erase alpha
p5.noErase();
p5.curveTightness(amount);
```

## Transforms

```ts
p5.push(); p5.pop();                 // matrix + style stack
p5.resetMatrix();
p5.translate(x, y);
p5.rotate(radians);
p5.scale(s, sy?);
p5.shearX(angle); p5.shearY(angle);
p5.applyMatrix(a, b, c, d, e, f);    // 2D affine
p5.rectMode(p5.CORNER | p5.CORNERS | p5.CENTER | p5.RADIUS);
p5.ellipseMode(...);
```

## Text

```ts
p5.text(str, x, y, maxWidth?, maxHeight?);
p5.textWidth(str);
p5.textAscent(str?); p5.textDescent(str?);
p5.fontAscent(); p5.fontDescent();
p5.textProperty(prop, value?);       // get/set arbitrary properties
```
Text rendering in Deno needs the FFI canvas backend (`@gfx/canvas`); see `../copiedHelpers/pixi_deno_shim.ts` if you hit issues.

## Constants (instance properties)

`p5.CORNER (0), CORNERS (1), CENTER (2), RADIUS (3)` — rect/ellipse modes
`p5.LEFT, RIGHT, TOP, BOTTOM, BASELINE` — text align
`p5.NORMAL, ITALIC, BOLD, BOLDITALIC`
`p5.WORD, CHAR` — text wrap
`p5.ROUND (10), SQUARE (11), PROJECT (12), MITER (13), BEVEL (14)` — cap/join
`p5.CLOSE (20)` — endShape
`p5.POINTS (30), LINES (31), TRIANGLES (32), TRIANGLE_FAN (33), TRIANGLE_STRIP (34), QUADS (35), QUAD_STRIP (36)` — beginShape kind
`p5.OPEN (40), CHORD (41), PIE (42)` — arc mode
`p5.RGB (50), HSB (51), HSL (52)` — color mode
`p5.BLEND (60), +others` — blend modes

## Color values

Default range 0–255 RGBA. Use `colorMode(p5.HSL, 360, 100, 100)` etc. to change. `fill()` with single arg = grayscale; two args = gray+alpha; three = RGB; four = RGBA. Accepts CSS color strings and arrays too.

## Output texture

`endFrame()` returns a `GPUTexture`. Pass it as a `ShaderSource` to any shader-fx effect:
```ts
const tex = p5.endFrame();
firstEffect.setSrcs({ src: tex });
```
Texture format is fixed internally; ShaderEffects accept `GPUTexture` directly.

## Gotchas

- `circle(x, y, diameter)` — diameter, NOT radius. `ellipse(x, y, w, h)` uses diameters too (subject to `ellipseMode`).
- MSAA is enabled by default internally; don't assume 1-sample output.
- No `image()` API (declared but not implemented — `_img` args prefixed with `_`).
- `updatePixels()`, `set()` exist but have narrow purposes — prefer drawing with shapes.
- Batch order = draw order. No z-buffering.
