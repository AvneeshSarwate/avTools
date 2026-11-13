# shader-fx/raw — dense reference

Source: `packages/shader-fx/raw/shaderFXRaw.ts` + `packages/shader-fx/generated-raw/shaders/*.frag.raw.generated.ts`. **Raw WebGPU** — not Babylon. Do NOT import from `@avtools/shader-fx/babylon` or `/generated/` — those are a different runtime.

## Core types

```ts
type ShaderSource = GPUTexture | GPUTextureView | ShaderEffect;
type Dynamic<T> = T | (() => T);

abstract class ShaderEffect<I = ShaderInputs> {
  id: string;
  effectName: string;
  width: number; height: number;
  inputs: Partial<I>;
  uniforms: ShaderUniforms;
  abstract output: GPUTextureView;
  abstract setSrcs(fx: Partial<I>): void;
  abstract setUniforms(uniforms): void;
  abstract updateUniforms(): void;
  abstract render(): void;             // render this effect only
  abstract dispose(): void;
  renderAll(): void;                    // render entire input DAG topologically
  getOrderedEffects(): ShaderEffect[];
  getGraph(): { nodes, edges };
  disposeAll(): void;                   // recursively dispose effect + all input effects
}
```

## Format selection

```ts
const format = await selectShaderFxFormat(device, ["rgba16float", "rgba32float", "rgba8unorm"]);
```
Probes each format for `RENDER_ATTACHMENT | TEXTURE_BINDING`; returns the first supported. Default fallback is `rgba8unorm`. Use `rgba16float` for feedback/accumulation; `rgba8unorm` is fine for final output.

## Effect constructor pattern (all generated-raw effects)

```ts
new SomeEffect(
  device: GPUDevice,
  inputs: { key1: ShaderSource, key2?: ShaderSource, ... },
  width = 1280,
  height = 720,
  format: GPUTextureFormat = 'rgba16float',
  clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 },
  sampleMode: 'nearest' | 'linear' = 'linear',
);
```

Each generated effect defines a typed `setUniforms(...)` with exactly the fields its shader uses. `Dynamic<number>` means you can pass a thunk `() => number` that re-evaluates each frame.

## Available generated effects

Import from `@avtools/shader-fx/generated-raw/shaders/<camelCaseName>.frag.raw.generated.ts`:

| Class | Inputs | Uniforms (non-exhaustive) |
|---|---|---|
| `AlphaTimeTagEffect` | `src` | `drawTime, alphaThreshold` |
| `BloomEffect` | `src` | multi-pass (threshold, intensity, radius) |
| `FeedbackCompositeEffect` | `src`, `feedback` | (blend params) |
| `FloodFillDisplayEffect` | `src` | (display-tuning) |
| `FloodFillStepEffect` | `seed`, `feedback` | `diskRadius, useDisk` |
| `HorizontalBlurEffect` | `src` | `radius` |
| `VerticalBlurEffect` | `src` | `radius` |
| `InvertEffect` | `src` | — |
| `LayerBlendEffect` | `src1`, `src2` | blend mode |
| `MathOpEffect` | `src` | op params |
| `TransformEffect` | `src` | `rotate, anchor, translate, scale` |

Open the `.frag.raw.generated.ts` file to see the exact `Uniforms` interface and input shape.

## Chaining

An effect takes earlier effects directly as sources — the framework extracts `.output` internally via `resolveTexture`:
```ts
const a = new TransformEffect(device, { src: someTexture }, w, h, format);
const b = new BloomEffect(device, { src: a }, w, h, format);
const c = new InvertEffect(device, { src: b }, w, h, format);
c.renderAll();   // renders a, b, c in order
return c;        // terminal — returnable from renderFrame
```

Raw `GPUTexture` / `GPUTextureView` also work as sources; use them at the entry (e.g., `p5.endFrame()` output).

## Feedback loops

```ts
const seed = new PassthruEffect(device, { src: someInitial }, w, h, format, clearColor, "nearest");
const feedback = new FeedbackNode(device, seed, w, h, format, clearColor, "nearest");
const step = new SomeEffect(device, { src: otherInput, feedback }, w, h, format, clear, "nearest");
feedback.setFeedbackSrc(step);
// renderAll(step) -> step's DAG includes feedback (which reads last frame), not a cycle
```

- `FeedbackNode` wraps a `PassthruEffect`. First render copies `startState.output`. After the first render, it reads from the set `feedbackSrc.output`.
- Critical: `setFeedbackSrc` does NOT add to `inputs`. That's why `renderAll()` on the terminal doesn't loop forever.
- If the feedback loop involves ping-pong textures, pass `sampleMode: "nearest"` where exact values matter (JFA, cellular automata). Otherwise `"linear"` is fine for smooth trails/glows.
- Reset feedback by calling `setSrcs({ initialState: newSeed })` — it flips `firstRender = true`.

## Multi-pass (inside a single effect)

`CustomShaderEffect.passCount > 1` runs multiple render passes per `render()`. The primary texture is auto-chained through passes unless overridden via `passTextureSources`. Bloom uses 2 passes. If you're writing a new effect, see the generated files for the pattern; usually you won't need to touch this in a sketch.

## Uniforms — static vs dynamic

```ts
effect.setUniforms({ drawTime: 1.23 });            // static
effect.setUniforms({ drawTime: () => time() });    // re-evaluated every render()
```

Each `render()` triggers `updateUniforms()` which resolves thunks and writes to the GPU uniform buffer.

## Terminal effect & presentation

`createWindowRenderManager`'s frame callback accepts `GPUTexture | GPUTextureView | ShaderEffect`. Returning the terminal effect is cleanest — the manager reads `.output`, blits to the swap chain, and optionally publishes via Syphon.

## Disposal

Always call `terminal.disposeAll()` in cleanup. This recursively walks `inputs` (but NOT the feedback src — that was kept out of `inputs` intentionally, so dispose feedback components manually if needed).

## Gotchas

- **Path matters**: `@avtools/shader-fx/raw` and `/generated-raw/shaders/...`. The `/babylon` version uses Babylon `Scene`/`ShaderMaterial` and will fail here.
- **Feedback first frame**: The seed chain must be renderable on frame 0. If the seed references an input that isn't ready, the first frame is black.
- **`renderAll()` throws "Cycle detected"** if you mis-wire. Check that only `FeedbackNode` closes loops, and it uses `setFeedbackSrc` not `inputs`.
- **Default clearColor alpha is 1** — if you want a transparent background to composite over something, pass `{ r:0, g:0, b:0, a:0 }`.
- **`output` is a `GPUTextureView`**, backed by `outputTexture`. If you need COPY_SRC (for readback/Syphon), the effect's texture already has it.
- **Uniform type mismatch is silent at TS layer but the shader will read garbage** — always pass numbers for `f32`, numbers for `i32`, and boolean-as-number (`useDisk ? 1 : 0`) for booleans.
