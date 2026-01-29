# @avtools/power2d

## Summary

`@avtools/power2d` is a 2D graphics rendering library built on Babylon.js that provides efficient GPU-accelerated styled 2D shapes. It works in pixel-space coordinates (top-left origin, y-down) and handles the pixel-to-NDC conversion internally via shaders. The library supports custom WGSL/GLSL shaders through code-generated material definitions, optional stroke outlines with miter joins, and thin instancing for rendering 10,000+ shapes in a single draw call.

**Package**: `@avtools/power2d` (version `0.0.0`)
**Entry point**: `mod.ts`
**Dependencies**: `babylonjs@^8.20.0`, `earcut@^3.0.0`
**Runtime**: Deno (uses `.ts` extensions and `deno.json` for config)

## Architecture

The package is split into two layers:

```
power2d/
  core/           # Pure geometry, no Babylon dependency
    types.ts          - Point2D, StrokeMeshData
    point_generators.ts - Shape point generators (Rect, Circle, etc.)
    stroke_mesh_generator.ts - Generates triangle-strip stroke meshes
    mod.ts
  babylon/        # Babylon.js integration
    types.ts          - MaterialDef, MaterialInstance, BatchMaterialDef, etc.
    styled_shape.ts   - StyledShape class (single shape with body + stroke)
    batched_styled_shape.ts - BatchedStyledShape class (thin instancing)
    scene_helpers.ts  - createPower2DScene, CanvasTexture
    material_names.ts - Unique material name generation
    mod.ts
  generated/      # Code-generated material definitions (from power2d-codegen)
  mod.ts           # Re-exports core/ and babylon/
```

**Core** is pure TypeScript with no rendering dependency. It generates point arrays and stroke mesh geometry.

**Babylon** consumes core geometry and wraps it in Babylon.js meshes with shader materials. All rendering uses an orthographic camera at [-1,1] NDC range, with shaders converting pixel coordinates to NDC.

## Core Concepts

### Coordinate System

Power2D uses **pixel-space coordinates** with origin at (0, 0) top-left. The y-axis points downward. Points are specified in pixels, and the shader pipeline applies a `power2d_pixelToNDC` transform to convert to clip space:

```wgsl
fn power2d_pixelToNDC(pixel: vec2f) -> vec4f {
  let ndcX = (pixel.x / uniforms.power2d_canvasWidth) * 2.0 - 1.0;
  let ndcY = -((pixel.y / uniforms.power2d_canvasHeight) * 2.0 - 1.0);
  return vec4f(ndcX, ndcY, 0.0, 1.0);
}
```

### Materials Are Code-Generated

Materials are **not** authored at runtime. They are defined as `.wgsl` or `.glsl` source files and processed by `@avtools/power2d-codegen` into TypeScript modules that export a `MaterialDef` (or `BatchMaterialDef` for instanced materials). Each generated module provides:

- Vertex and fragment shader source strings
- A `createMaterial(scene, name?)` factory function
- Typed `setUniforms()` with the specific uniform interface
- Typed `setTexture()` with named texture slots
- Uniform defaults and metadata

You do **not** write `BABYLON.ShaderMaterial` code manually. Instead, import the generated material definition and pass it to `StyledShape` or `BatchedStyledShape`.

### Shape Transform Pipeline

Every shape has a shader-level transform applied in the vertex shader:

1. User's `vertShader()` adjusts the pixel position (optional)
2. `power2d_applyShapeTransform()` applies scale, rotation, then translation
3. `power2d_pixelToNDC()` converts to NDC

This means `x`, `y`, `rotation`, `scaleX`, `scaleY` on `StyledShape`/`BatchedStyledShape` are handled entirely in the GPU via uniforms (`power2d_shapeTranslate`, `power2d_shapeRotation`, `power2d_shapeScale`).

## Core API

### Types

```typescript
// A 2D point as a readonly tuple
type Point2D = readonly [number, number];

// Triangle mesh data for a stroke outline
interface StrokeMeshData {
  positions: Float32Array;      // vec3 per vertex (z = 0)
  uvs: Float32Array;            // vec2 per vertex (u = 0|1 for side, v = normalizedArc)
  normals: Float32Array;        // vec2 per vertex (miter normal direction)
  sides: Float32Array;          // f32 per vertex (-1 = left, +1 = right)
  arcLengths: Float32Array;     // f32 per vertex (cumulative arc length in pixels)
  normalizedArcs: Float32Array; // f32 per vertex (arc length / total length, 0..1)
  miterFactors: Float32Array;   // f32 per vertex (miter scaling, clamped to [-4, 4])
  indices: Uint32Array;         // triangle indices
  totalArcLength: number;       // total path length in pixels
}
```

### Point Generators

All generators return `Point2D[]`. Points define the outline of a closed polygon.

```typescript
// Rectangle from top-left corner
function RectPts(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point2D[];

// Circle (default 32 segments)
function CirclePts(opts: {
  cx: number;
  cy: number;
  radius: number;
  segments?: number;  // default: 32
}): Point2D[];

// Ellipse (default 32 segments)
function EllipsePts(opts: {
  cx: number;
  cy: number;
  radiusX: number;
  radiusY: number;
  segments?: number;  // default: 32
}): Point2D[];

// Regular polygon (triangle, pentagon, hexagon, etc.)
function RegularPolygonPts(opts: {
  cx: number;
  cy: number;
  radius: number;
  sides: number;
  rotation?: number;  // radians, default: 0
}): Point2D[];

// Arbitrary polygon from {x, y} objects
function PolygonPts(points: Array<{ x: number; y: number }>): Point2D[];
```

### Stroke Mesh Generator

```typescript
// Generates a triangle mesh for a thick stroke along a path
function generateStrokeMesh(
  points: readonly Point2D[],
  thickness: number,
  closed: boolean,
): StrokeMeshData;
```

The generated mesh uses miter joins at corners (clamped to 4x thickness to prevent spikes). For closed paths, a seam-duplicate vertex is added to avoid UV interpolation artifacts across the closing edge. The `thickness` parameter is stored but the actual extrusion is done in the vertex shader using `strokeNormal * side * thickness * miterFactor`.

## Babylon API

### Material Type System

```typescript
// A material instance created from a definition
interface MaterialInstance<U, T extends string> {
  material: BABYLON.ShaderMaterial;
  setUniforms(uniforms: Partial<U>): void;
  setTexture(name: T, texture: BABYLON.BaseTexture): void;
  setCanvasSize(width: number, height: number): void;
  dispose(): void;
  setTextureSampler?(name: T, sampler: BABYLON.TextureSampler): void;
}

// A material definition (factory pattern)
interface MaterialDef<U, T extends string> {
  readonly createMaterial: (scene: BABYLON.Scene, name?: string) => MaterialInstance<U, T>;
  readonly uniformDefaults: U;
  readonly textureNames: readonly T[];
}

// Instance attribute layout for batched materials
interface InstanceAttrLayout<I> {
  size: number;  // total floats per instance
  members: Array<{
    name: keyof I;
    offset: number;      // float offset within instance stride
    floatCount: number;   // number of floats for this member
  }>;
}

// A batched material definition extends MaterialDef with instance attributes
interface BatchMaterialDef<U, T extends string, I> extends MaterialDef<U, T> {
  readonly instanceAttrLayout: InstanceAttrLayout<I>;
}

// Utility types to extract types from a MaterialDef
type MaterialUniforms<M> = M extends MaterialDef<infer U, infer _T> ? U : never;
type MaterialTextureNames<M> = M extends MaterialDef<unknown, infer T> ? T : never;
type BatchInstanceAttrs<M> = M extends { instanceAttrLayout: InstanceAttrLayout<infer I> } ? I : never;
```

### TextureSource

Accepted texture sources for `setTexture()`:

```typescript
type TextureSource =
  | BABYLON.BaseTexture
  | BABYLON.RenderTargetTexture
  | { output: BABYLON.RenderTargetTexture };  // e.g. ShaderEffect objects
```

### StyledShape

A single shape with a body fill and an optional stroke outline. Both body and stroke have independent materials.

```typescript
class StyledShape<BodyMat, StrokeMat?> {
  constructor(options: {
    scene: BABYLON.Scene;
    points: readonly Point2D[];
    bodyMaterial: BodyMat;              // MaterialDef for the fill
    strokeMaterial?: StrokeMat;         // MaterialDef for the stroke (optional)
    strokeThickness?: number;           // default: 1
    closed?: boolean;                   // default: true
    canvasWidth: number;
    canvasHeight: number;
  });

  // Body material API
  body: {
    setUniforms(uniforms: Partial<BodyUniforms>): void;
    setTexture(name: BodyTextureName, source: TextureSource): void;
    setTextureSampler(name: BodyTextureName, sampler: BABYLON.TextureSampler): void;
    readonly mesh: BABYLON.Mesh;
  };

  // Stroke material API (null if no stroke material provided)
  stroke: {
    setUniforms(uniforms: Partial<StrokeUniforms>): void;
    setTexture(name: StrokeTextureName, source: TextureSource): void;
    setTextureSampler(name: StrokeTextureName, sampler: BABYLON.TextureSampler): void;
    thickness: number;    // getter/setter; rebuilds stroke mesh on change
    readonly mesh: BABYLON.Mesh;
  } | null;

  // Transform properties (shader-level, via uniforms)
  x: number;
  y: number;
  rotation: number;       // radians
  scaleX: number;
  scaleY: number;
  position: BABYLON.Vector3;   // convenience (reads/writes x, y)
  scaling: BABYLON.Vector3;    // convenience (reads/writes scaleX, scaleY)
  alphaIndex: number;          // render order for transparency

  // Update shape geometry at runtime
  setPoints(points: readonly Point2D[], closed?: boolean): void;

  // Update canvas dimensions (affects pixel-to-NDC conversion)
  setCanvasSize(width: number, height: number): void;

  dispose(): void;
}
```

**Key details**:
- Body mesh is triangulated using `earcut` (polygon ear-clipping).
- UVs are computed as normalized bounding-box coordinates `(x - minX) / width`.
- Setting `stroke.thickness` triggers a full stroke mesh rebuild.
- `setPoints()` disposes and recreates both body and stroke meshes.
- All materials get `disableDepthWrite = true`, `depthFunction = ALWAYS`, `backFaceCulling = false`, and `alphaMode = ALPHA_COMBINE` (painter's algorithm for 2D).

### BatchedStyledShape

Thin instancing for rendering many copies of the same shape with per-instance attributes. Uses WebGPU `StorageBuffer` for instance data.

```typescript
class BatchedStyledShape<M extends BatchMaterialDef<...>> {
  constructor(options: {
    scene: BABYLON.Scene;
    points: readonly Point2D[];
    material: M;                       // BatchMaterialDef with instance layout
    instanceCount: number;
    canvasWidth: number;
    canvasHeight: number;
    closed?: boolean;                  // default: true
  });

  // Shared uniforms (same for all instances)
  setUniforms(uniforms: Partial<MaterialUniforms<M>>): void;
  setTexture(name: MaterialTextureNames<M>, source: TextureSource): void;
  setTextureSampler(name: MaterialTextureNames<M>, sampler: BABYLON.TextureSampler): void;

  // Per-instance attribute writing
  writeInstanceAttr(index: number, values: Partial<BatchInstanceAttrs<M>>): void;

  // Upload instance data to GPU (call once per frame after all writes)
  updateInstanceBuffer(): void;

  // Convenience: calls updateInstanceBuffer()
  beforeRender(): void;

  // Use an external StorageBuffer for instance data (e.g. from compute shader)
  setInstancingBuffer(buffer: BABYLON.StorageBuffer | null): void;
  setExternalBufferMode(enabled: boolean): void;
  getInstanceBuffer(): BABYLON.StorageBuffer;

  // Transform (applies to ALL instances as a group)
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  position: BABYLON.Vector3;
  scaling: BABYLON.Vector3;

  setCanvasSize(width: number, height: number): void;
  dispose(): void;
}
```

**Key details**:
- Internally uses `thinInstanceSetBuffer('matrix', null, 16)` and `forcedInstanceCount` for thin instancing.
- Instance data is stored in a `Float32Array` of size `instanceLayout.size * instanceCount`.
- `writeInstanceAttr` writes to the CPU-side buffer. Call `updateInstanceBuffer()` (or `beforeRender()`) to upload to the GPU.
- When using `setInstancingBuffer()`, `writeInstanceAttr` is disabled (warns on use). This is for compute-shader-driven instance data.
- Instance attributes are exposed as `VertexBuffer` objects with instanced divisor, named `inst_<memberName>` in shaders.
- **Requires WebGPU engine** (`BABYLON.WebGPUEngine`), not the WebGL engine.

### CanvasTexture

Helper for uploading HTML Canvas content to a GPU texture each frame.

```typescript
class CanvasTexture {
  constructor(options: {
    engine: BABYLON.WebGPUEngine;
    scene: BABYLON.Scene;
    width?: number;          // initial width, default: 1
    height?: number;         // initial height, default: 1
    samplingMode?: number;   // default: BILINEAR
  });

  readonly texture: BABYLON.BaseTexture;  // pass to setTexture()
  readonly width: number;
  readonly height: number;

  // Upload canvas content; auto-resizes if canvas dimensions changed
  update(canvas: HTMLCanvasElement | OffscreenCanvas): void;

  dispose(): void;
}
```

**Key details**:
- Creates a `DynamicTexture` internally with CLAMP addressing.
- On first creation, uploads a transparent canvas to make the texture "ready" for WebGPU.
- When canvas dimensions change, creates a new internal texture and defers disposal of the old one to the next frame to avoid "destroyed texture" errors.
- Pass `canvasTexture.texture` to `shape.body.setTexture(...)`.

### createPower2DScene

Sets up a Babylon.js scene configured for 2D rendering.

```typescript
function createPower2DScene(options: {
  engine: BABYLON.WebGPUEngine;
  canvasWidth: number;
  canvasHeight: number;
  clearColor?: BABYLON.Color4;  // default: black (0,0,0,1)
}): {
  scene: BABYLON.Scene;
  camera: BABYLON.FreeCamera;
  canvasWidth: number;
  canvasHeight: number;
  resize(width: number, height: number): void;
};
```

**Key details**:
- Creates an orthographic camera at `z = -1`, looking at `z = 0`, with ortho bounds `[-1, 1]` in both axes.
- `autoClear = true`, `autoClearDepthAndStencil = true`.
- The `resize()` function is currently a no-op because the shaders handle pixel-to-NDC conversion via canvas size uniforms.

## Code-Generated Material Structure

Materials are generated by `@avtools/power2d-codegen` from WGSL/GLSL source files. Each generated `.generated.ts` file exports:

### For Body Materials

```typescript
// Shader source strings
export const <Name>VertexSource: string;
export const <Name>FragmentSource: string;

// Typed uniform interface
export interface <Name>Uniforms {
  time: number;
  color: BABYLON.Vector3 | readonly [number, number, number];
  // ... per-material
}

// Defaults
export const <Name>UniformDefaults: <Name>Uniforms;

// Uniform metadata (binding names, WGSL types)
export const <Name>UniformMeta: readonly [...];

// Typed setter
export function set<Name>Uniforms(material: BABYLON.ShaderMaterial, uniforms: Partial<...>): void;

// Texture slot names (type-level, can be `never` if no textures)
export type <Name>TextureName = 'webcamTex' | ...;

// Material instance interface
export interface <Name>MaterialInstance { ... }

// Factory function
export function create<Name>Material(scene: BABYLON.Scene, name?: string): <Name>MaterialInstance;

// MaterialDef object (pass to StyledShape/BatchedStyledShape)
export const <Name>Material: <Name>MaterialDef;
export default <Name>Material;
```

### For Stroke Materials

Same structure but the vertex shader receives stroke-specific attributes (`strokeNormal`, `strokeSide`, `strokeArcLength`, `strokeNormalizedArc`, `strokeMiterFactor`) and the `power2d_strokeThickness` uniform.

The `strokeVertShader` function signature is:

```wgsl
fn strokeVertShader(
  centerPos: vec2f,
  normal: vec2f,
  side: f32,
  arcLength: f32,
  normalizedArc: f32,
  miterFactor: f32,
  thickness: f32,
  uniforms: <Name>Uniforms,
) -> vec2f
```

The `strokeFragShader` function signature is:

```wgsl
fn strokeFragShader(
  uv: vec2f,
  arcLength: f32,
  normalizedArc: f32,
  uniforms: <Name>Uniforms,
) -> vec4f
```

### For Instanced (Batch) Materials

Extends the body material pattern with:

```typescript
// Per-instance attribute interface
export interface <Name>Instance {
  offset: readonly [number, number];
  scale: number;
  rotation: number;
  tint: readonly [number, number, number];
  instanceIndex: number;
  // ... per-material
}

// Instance attribute layout
export const <Name>InstanceAttrLayout: InstanceAttrLayout<...>;

// MaterialDef includes instanceAttrLayout
export const <Name>Material: <Name>MaterialDef;  // satisfies BatchMaterialDef
```

The `vertShader` and `fragShader` receive an additional `inst: <Name>Instance` parameter.

## Usage Patterns

### Basic Shape with Body Material

```typescript
import { createPower2DScene, StyledShape, CirclePts } from '@avtools/power2d';
import { BasicMaterial } from './basic.material.wgsl.generated.ts';

// Setup
const { scene, canvasWidth, canvasHeight } = createPower2DScene({
  engine,
  canvasWidth: 800,
  canvasHeight: 600,
});

// Create a circle
const circle = new StyledShape({
  scene,
  points: CirclePts({ cx: 400, cy: 300, radius: 100 }),
  bodyMaterial: BasicMaterial,
  canvasWidth,
  canvasHeight,
});

// Set uniforms
circle.body.setUniforms({ time: 0, color: [1, 0.5, 0.2] });

// Animate
circle.x = 400;
circle.y = 300;
circle.rotation += 0.01;
```

### Shape with Body and Stroke

```typescript
import { StyledShape, RectPts } from '@avtools/power2d';
import { BasicMaterial } from './basic.material.wgsl.generated.ts';
import { BasicStrokeMaterial } from './basic.strokeMaterial.wgsl.generated.ts';

const rect = new StyledShape({
  scene,
  points: RectPts({ x: 100, y: 100, width: 200, height: 150 }),
  bodyMaterial: BasicMaterial,
  strokeMaterial: BasicStrokeMaterial,
  strokeThickness: 4,
  canvasWidth,
  canvasHeight,
});

// Body and stroke have independent uniforms
rect.body.setUniforms({ color: [0.2, 0.4, 0.8] });
rect.stroke!.setUniforms({ color: [1, 1, 1] });

// Change stroke thickness at runtime (rebuilds stroke mesh)
rect.stroke!.thickness = 8;
```

### Batched Instancing (10,000+ shapes)

```typescript
import { BatchedStyledShape, CirclePts } from '@avtools/power2d';
import { InstancedBasicMaterial } from './instancedBasic.material.wgsl.generated.ts';

const COUNT = 10000;

const batch = new BatchedStyledShape({
  scene,
  points: CirclePts({ cx: 0, cy: 0, radius: 5 }),
  material: InstancedBasicMaterial,
  instanceCount: COUNT,
  canvasWidth,
  canvasHeight,
});

// Set shared uniforms
batch.setUniforms({ time: 0, color: [1, 1, 1] });

// Write per-instance attributes
for (let i = 0; i < COUNT; i++) {
  batch.writeInstanceAttr(i, {
    offset: [Math.random() * 800, Math.random() * 600],
    scale: 0.5 + Math.random() * 2,
    rotation: Math.random() * Math.PI * 2,
    tint: [Math.random(), Math.random(), Math.random()],
    instanceIndex: i,
  });
}

// In render loop: upload instance data to GPU
batch.beforeRender();  // or batch.updateInstanceBuffer()
```

### Canvas Texture Integration

```typescript
import { CanvasTexture, StyledShape, RectPts } from '@avtools/power2d';
import { WebcamPixelMaterial } from './webcamPixel.material.wgsl.generated.ts';

const canvasTex = new CanvasTexture({ engine, scene, width: 640, height: 480 });

const quad = new StyledShape({
  scene,
  points: RectPts({ x: 0, y: 0, width: 640, height: 480 }),
  bodyMaterial: WebcamPixelMaterial,
  canvasWidth: 800,
  canvasHeight: 600,
});

// In render loop:
const offscreenCanvas = getVideoFrame();  // your canvas source
canvasTex.update(offscreenCanvas);
quad.body.setTexture('webcamTex', canvasTex.texture);
```

### Dynamic Point Updates

```typescript
const shape = new StyledShape({
  scene,
  points: CirclePts({ cx: 0, cy: 0, radius: 50 }),
  bodyMaterial: BasicMaterial,
  canvasWidth,
  canvasHeight,
});

// Later: change to a different shape entirely
shape.setPoints(
  RegularPolygonPts({ cx: 0, cy: 0, radius: 50, sides: 6 }),
  true,  // closed
);
```

### External Instance Buffer (Compute Shader Driven)

```typescript
// Create a StorageBuffer from a compute shader
const computeBuffer = new BABYLON.StorageBuffer(engine, totalFloats * 4, ...);

// Attach to batched shape
batch.setInstancingBuffer(computeBuffer);

// Now writeInstanceAttr is disabled; the compute shader writes directly
// batch.writeInstanceAttr(i, ...) will warn

// To switch back to CPU-driven:
batch.setInstancingBuffer(null);
```

## Render Pipeline Details

All materials created by the generated code have these settings:

- `disableDepthWrite = true` -- 2D shapes do not write to depth buffer
- `depthFunction = BABYLON.Constants.ALWAYS` -- always pass depth test
- `backFaceCulling = false` -- both faces visible
- `alphaMode = BABYLON.Engine.ALPHA_COMBINE` -- standard alpha blending

Render order is controlled by `alphaIndex` on `StyledShape`. Lower values render first (behind), higher values render on top.

### Reserved Shader Uniforms

These uniforms are managed internally by power2d and must not be set manually:

| Uniform | Type | Purpose |
|---------|------|---------|
| `power2d_shapeTranslate` | `vec2f` | Shape translation (x, y) |
| `power2d_shapeRotation` | `f32` | Shape rotation in radians |
| `power2d_shapeScale` | `vec2f` | Shape scale (scaleX, scaleY) |
| `power2d_canvasWidth` | `f32` | Canvas width in pixels |
| `power2d_canvasHeight` | `f32` | Canvas height in pixels |
| `power2d_strokeThickness` | `f32` | Stroke thickness (stroke materials only) |

### Stroke Vertex Attributes

Stroke meshes provide these custom vertex attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `strokeNormal` | `vec2<f32>` | Miter normal direction at vertex |
| `strokeSide` | `f32` | `-1` for left edge, `+1` for right edge |
| `strokeArcLength` | `f32` | Cumulative arc length in pixels |
| `strokeNormalizedArc` | `f32` | Arc length normalized to `[0, 1]` |
| `strokeMiterFactor` | `f32` | Miter join scale factor (clamped `[-4, 4]`) |

## Caveats and Important Notes

1. **WebGPU Required for BatchedStyledShape**: The `BatchedStyledShape` class casts the engine to `BABYLON.WebGPUEngine` and uses `StorageBuffer`. It will not work with WebGL.

2. **StyledShape works with both WebGL and WebGPU**: The `StyledShape` class does not use `StorageBuffer` and can work with either engine, but the generated materials may be WGSL-only (WebGPU) or GLSL-only (WebGL) depending on which codegen path was used.

3. **Materials must be code-generated**: You cannot create a `MaterialDef` by hand in a practical way. Use `@avtools/power2d-codegen` to generate material TypeScript from `.wgsl` or `.glsl` source files.

4. **setPoints() is expensive**: It disposes and recreates the body mesh (and stroke mesh if present). Do not call it every frame. For animation, use transform properties or shader uniforms instead.

5. **stroke.thickness setter rebuilds the mesh**: Changing `stroke.thickness` at runtime triggers `rebuildStrokeMesh()`. Avoid rapid changes.

6. **Closed shapes by default**: `StyledShape` defaults to `closed: true`. Open paths must explicitly set `closed: false`.

7. **Miter join limits**: Stroke miter factors are clamped to `[-4, 4]` to prevent spike artifacts at sharp corners. Very acute angles will have clipped miters.

8. **CanvasTexture deferred disposal**: When the canvas size changes, the old `InternalTexture` is disposed on the _next_ `update()` call, not immediately. This prevents WebGPU "destroyed texture" errors.

9. **Instance attribute naming convention**: In shaders, instance attributes are prefixed with `inst_` (e.g., `inst_offset`, `inst_scale`). The corresponding varyings are prefixed with `vInst_`.

10. **earcut triangulation**: Body meshes use the `earcut` algorithm for polygon triangulation. This works well for simple and convex polygons but may produce suboptimal results for highly concave or self-intersecting polygons.

11. **No z-ordering in geometry**: All shapes are rendered at `z = 0`. Render order is determined by `alphaIndex` and Babylon.js mesh registration order.

12. **Uniform vectors accept tuples**: Generated uniform setters accept both `BABYLON.Vector3` and `readonly [number, number, number]` tuples. Tuples are converted to `Vector3` internally via `Vector3.FromArray()`.

## Monorepo Relationships

- **`@avtools/power2d`** -- This package. The runtime library.
- **`@avtools/power2d-codegen`** -- The code generator that processes `.wgsl` and `.glsl` shader files into TypeScript material definitions. It is a build-time dependency, not a runtime dependency. Its output goes into the `generated/` directory (or a project-specific output path).
- Generated material files import from `babylonjs` directly and conform to the `MaterialDef` / `BatchMaterialDef` interfaces defined in `@avtools/power2d`.
- The codegen supports both WGSL (for WebGPU) and GLSL (for WebGL) backends, producing separate `.wgsl.generated.ts` and `.gl.generated.ts` files respectively.

## File Reference

| File | Purpose |
|------|---------|
| `core/types.ts` | `Point2D`, `StrokeMeshData` type definitions |
| `core/point_generators.ts` | `RectPts`, `CirclePts`, `EllipsePts`, `RegularPolygonPts`, `PolygonPts` |
| `core/stroke_mesh_generator.ts` | `generateStrokeMesh()` function |
| `babylon/types.ts` | `MaterialDef`, `MaterialInstance`, `BatchMaterialDef`, `InstanceAttrLayout`, `TextureSource` |
| `babylon/styled_shape.ts` | `StyledShape` class |
| `babylon/batched_styled_shape.ts` | `BatchedStyledShape` class |
| `babylon/scene_helpers.ts` | `createPower2DScene()`, `CanvasTexture` class |
| `babylon/material_names.ts` | `createMaterialInstanceName()` -- auto-incrementing unique names |
| `mod.ts` | Re-exports everything from `core/mod.ts` and `babylon/mod.ts` |
