---
name: power2d-codegen
description: Shader code generation framework that transforms WGSL and GLSL shader source files into TypeScript companion modules with type-safe APIs for Babylon.js. Use when writing or modifying shader codegen, material generation, or working with @avtools/power2d-codegen.
metadata:
  author: avtools
  version: "0.0.0"
compatibility: Deno runtime. Depends on wgsl_reflect for WGSL parsing.
---
# @avtools/power2d-codegen

## Summary

`@avtools/power2d-codegen` is a shader code generation framework that transforms WGSL and GLSL shader source files into TypeScript companion modules with fully type-safe APIs for Babylon.js integration. It parses shader ASTs (using `wgsl_reflect` for WGSL, and a custom regex-based parser for GLSL), extracts uniform structs, texture bindings, and instance attributes, then emits `.generated.ts` files containing TypeScript interfaces, setter functions, material factories, and metadata arrays. The generated code eliminates manual boilerplate when working with Babylon.js `ShaderMaterial` and `ComputeShader` APIs.

**Package location:** `packages/power2d-codegen/`
**Entry point:** `packages/power2d-codegen/mod.ts`
**Runtime:** Deno (uses `deno.json` with `npm:wgsl_reflect@^1.2.3`)

## Core Concepts

### Shader Categories

The codegen handles four distinct shader categories, each identified by a file suffix convention:

| Category | WGSL Suffix | GLSL Suffix | Purpose |
|---|---|---|---|
| Material | `.material.wgsl` | `.material.glsl` | Fill shaders for 2D shapes (vertex + fragment) |
| Stroke Material | `.strokeMaterial.wgsl` | `.strokeMaterial.glsl` | Stroke/line shaders with arc-length data |
| Fragment Effect | `.fragFunc.wgsl` | `.fragFunc.glsl` | Post-processing / multi-pass fragment effects |
| Compute | `.compute.wgsl` | (N/A) | GPU compute shaders with storage buffers |

### Output Suffixes

| Category | Output Suffix |
|---|---|
| Material (WGSL/GLSL) | `.generated.ts` / `.material.gl.generated.ts` |
| Stroke Material (WGSL/GLSL) | `.generated.ts` / `.strokeMaterial.gl.generated.ts` |
| Fragment Effect (WGSL/GLSL) | `.frag.generated.ts` / `.frag.gl.generated.ts` |
| Compute (WGSL only) | `.generated.ts` |

### Type Mappings

WGSL types are mapped to TypeScript types:

| WGSL Type | TypeScript Type | Babylon Setter |
|---|---|---|
| `f32` | `number` | `setFloat` |
| `i32` | `number` | `setInt` |
| `u32` | `number` | `setUInt` |
| `bool` | `boolean` | `setFloat` (converted to 0/1) |
| `vec2f` | `BABYLON.Vector2 \| readonly [number, number]` | `setVector2` |
| `vec3f` | `BABYLON.Vector3 \| readonly [number, number, number]` | `setVector3` |
| `vec4f` | `BABYLON.Vector4 \| readonly [number, number, number, number]` | `setVector4` |
| `mat4x4f` | `BABYLON.Matrix \| Float32Array \| readonly number[]` | `setMatrix` |

GLSL equivalents use `float`, `int`, `vec2`, `vec3`, `vec4`, `mat4`.

For compute shaders, additional integer vector types are supported: `vec2i`, `vec3i`, `vec4i`, `vec2u`, `vec3u`, `vec4u`.

### Generated Artifacts Per Shader

For each shader file, the generator produces:

1. **Uniform interface** -- a TypeScript interface matching the shader's uniform struct fields (e.g., `BasicUniforms`)
2. **Uniform setter function** -- applies partial uniform updates to a `BABYLON.ShaderMaterial` (e.g., `setBasicUniforms(material, { speed: 2.0 })`)
3. **Uniform defaults** -- a const object with zero-initialized defaults (e.g., `BasicUniformDefaults`)
4. **Uniform metadata array** -- an array of `{ name, kind, bindingName }` objects used for UI generation (e.g., `BasicUniformMeta`)
5. **Material instance interface** -- provides `setUniforms()`, `setTexture()`, `setCanvasSize()`, `dispose()` (e.g., `BasicMaterialInstance`)
6. **Material factory function** -- creates a configured Babylon `ShaderMaterial` and returns a handle object (e.g., `createBasicMaterial(scene)`)
7. **Material definition object** -- a const bundling all metadata, sources, and the factory (e.g., `BasicMaterial`)

Fragment effects additionally generate:
- An `Effect` class extending `CustomShaderEffect` with typed `setUniforms()` and `setSrcs()` methods
- Per-pass fragment sources and texture binding metadata

Compute shaders additionally generate:
- Struct interfaces and `pack` functions for storage buffer data
- Uniform buffer create/update helpers
- Storage buffer create/write/update helpers
- Compute shader factory with binding management

## Full API Reference

### WGSL Generators

```typescript
// Material shader codegen
import {
  WGSL_MATERIAL_SUFFIX,        // ".material.wgsl"
  WGSL_MATERIAL_OUTPUT_SUFFIX,  // ".generated.ts"
  generateMaterialTypesSource,
} from "@avtools/power2d-codegen";

const result = generateMaterialTypesSource(shaderCode: string, shaderBaseName: string);
// Returns: { typesSource: string }

// Stroke material shader codegen
import {
  WGSL_STROKE_SUFFIX,          // ".strokeMaterial.wgsl"
  WGSL_STROKE_OUTPUT_SUFFIX,   // ".generated.ts"
  generateStrokeMaterialTypesSource,
} from "@avtools/power2d-codegen";

const result = generateStrokeMaterialTypesSource(shaderCode: string, shaderBaseName: string);
// Returns: { typesSource: string }

// Fragment effect shader codegen
import {
  WGSL_FRAG_SUFFIX,            // ".fragFunc.wgsl"
  WGSL_FRAG_TYPES_SUFFIX,      // ".frag.generated.ts"
  generateFragmentShaderArtifactsSource,
  buildFragmentShaderErrorArtifactSource,
  getFragmentShaderNaming,
} from "@avtools/power2d-codegen";

const result = generateFragmentShaderArtifactsSource({
  shaderCode: string,
  shaderBaseName: string,
  shaderFxImportPath: string,  // e.g., "@avtools/shader-fx-babylon"
});
// Returns: { typesSource, shaderPrefix, effectClassName, uniformInterfaceName }

const naming = getFragmentShaderNaming(shaderBaseName: string);
// Returns: { shaderPrefix, effectClassName, defaultUniformInterfaceName }

const errorSource = buildFragmentShaderErrorArtifactSource({
  effectClassName, uniformInterfaceName, shaderPrefix,
  relativeSourcePath, errorMessage,
});
// Returns: string (TypeScript source that throws on construction)

// Compute shader codegen
import {
  WGSL_COMPUTE_SUFFIX,              // ".compute.wgsl"
  WGSL_COMPUTE_DEFAULT_SUFFIX,      // ".generated.ts"
  generateComputeShaderTypesSource,
} from "@avtools/power2d-codegen";

const result = generateComputeShaderTypesSource({
  shaderCode: string,
  shaderFileName: string,   // e.g., "animation.compute.wgsl"
  shaderStem: string,        // e.g., "animation.compute"
});
// Returns: { typesSource: string, shaderPrefix: string }
```

### GLSL Generators

```typescript
import {
  GLSL_MATERIAL_SUFFIX,        // ".material.glsl"
  GLSL_MATERIAL_OUTPUT_SUFFIX,  // ".material.gl.generated.ts"
  generateMaterialTypesSource_GL,
} from "@avtools/power2d-codegen";

import {
  GLSL_STROKE_SUFFIX,          // ".strokeMaterial.glsl"
  GLSL_STROKE_OUTPUT_SUFFIX,   // ".strokeMaterial.gl.generated.ts"
  generateStrokeMaterialTypesSource_GL,
} from "@avtools/power2d-codegen";

import {
  GLSL_FRAG_SUFFIX,            // ".fragFunc.glsl"
  GLSL_FRAG_TYPES_SUFFIX,      // ".frag.gl.generated.ts"
  generateFragmentShaderArtifactsSource_GL,
} from "@avtools/power2d-codegen";
```

GLSL generators have the same signatures as their WGSL counterparts.

### I/O Utilities

```typescript
import { readTextFile, writeFileIfChanged } from "@avtools/power2d-codegen";

const content = await readTextFile("/path/to/shader.wgsl");

// Only writes if content differs from existing file. Creates directories as needed.
const didWrite = await writeFileIfChanged("/path/to/output.ts", generatedCode);
// Returns: boolean (true if file was written, false if unchanged)
```

## Shader Input Requirements

### Material Shaders (`.material.wgsl`)

Must define exactly two functions:

```wgsl
struct MyUniforms {
  speed: f32,
  color: vec4f,
}

// Required: vertShader with 3 args (no instancing) or 4 args (with instancing)
fn vertShader(position: vec2f, uv: vec2f, uniforms: MyUniforms) -> vec2f {
  return position;
}

// Required: fragShader with 2+ args (uv, uniforms, then optional texture/sampler pairs)
fn fragShader(uv: vec2f, uniforms: MyUniforms) -> vec4f {
  return uniforms.color;
}
```

With instancing:

```wgsl
struct MyInstance {
  offset: vec2f,
  scale: f32,
}

fn vertShader(position: vec2f, uv: vec2f, uniforms: MyUniforms, instance: MyInstance) -> vec2f {
  return position * instance.scale + instance.offset;
}

fn fragShader(uv: vec2f, uniforms: MyUniforms, instance: MyInstance) -> vec4f {
  return uniforms.color;
}
```

With textures (texture/sampler pairs appended after uniforms in `fragShader`):

```wgsl
fn fragShader(
  uv: vec2f,
  uniforms: MyUniforms,
  myTex: texture_2d<f32>,
  myTexSampler: sampler
) -> vec4f {
  return textureSample(myTex, myTexSampler, uv);
}
```

### Stroke Material Shaders (`.strokeMaterial.wgsl`)

Must define `strokeVertShader` (8 args) and `strokeFragShader` (4+ args):

```wgsl
fn strokeVertShader(
  centerPos: vec2f,
  normal: vec2f,
  side: f32,
  arcLength: f32,
  normalizedArc: f32,
  miterFactor: f32,
  thickness: f32,
  uniforms: MyUniforms
) -> vec2f {
  return centerPos + normal * side * thickness * miterFactor;
}

fn strokeFragShader(
  uv: vec2f,
  arcLength: f32,
  normalizedArc: f32,
  uniforms: MyUniforms
  // optional texture/sampler pairs follow
) -> vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
```

### Fragment Effect Shaders (`.fragFunc.wgsl`)

Must define one or more pass functions named `pass0`, `pass1`, etc. in contiguous order starting from 0:

```wgsl
struct BlurUniforms {
  radius: f32,       // 5.0 min=0 max=50 step=1
  strength: f32,     // 1.0 min=0 max=2
}

// Single-pass effect: just pass0
fn pass0(uv: vec2f, u: BlurUniforms, inputTex: texture_2d<f32>, inputTexSampler: sampler) -> vec4f {
  return textureSample(inputTex, inputTexSampler, uv);
}
```

Multi-pass effects can reference earlier passes:

```wgsl
fn pass0(uv: vec2f, u: BlurUniforms, inputTex: texture_2d<f32>, inputTexSampler: sampler) -> vec4f {
  // horizontal blur
  return textureSample(inputTex, inputTexSampler, uv);
}

fn pass1(uv: vec2f, u: BlurUniforms, inputTex: texture_2d<f32>, inputTexSampler: sampler, pass0Texture: texture_2d<f32>, pass0Sampler: sampler) -> vec4f {
  // vertical blur, reading from pass0's output
  return textureSample(pass0Texture, pass0Sampler, uv);
}
```

**Uniform comment annotations** for fragment effects support inline defaults and UI hints:

```wgsl
struct MyUniforms {
  radius: f32,       // 5.0 min=0 max=50 step=1
  color: vec3f,      // [1.0, 0.5, 0.0]
  enabled: bool,     // true
}
```

The comment after each field is parsed for:
- A default value expression (number, boolean, array literal)
- `min=N`, `max=N`, `step=N` for UI slider generation

### Compute Shaders (`.compute.wgsl`)

Standard WGSL compute shaders with `@group`/`@binding` annotations. The generator reflects all uniforms, storage buffers, textures, samplers, and storage textures:

```wgsl
struct Particle {
  position: vec2f,
  velocity: vec2f,
}

@group(0) @binding(0) var<uniform> params: ParamsUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  // ...
}
```

Generated output includes:
- `ParamsUniforms` interface + `createUniformBuffer_params()` + `updateUniformBuffer_params()`
- `Particle` interface + `packParticle()` for storage buffer serialization
- `createStorageBuffer_particles()` + `writeStorageValue_particles()` + `updateStorageBuffer_particles()`
- `createShader()` + `updateBindings()` for the compute pipeline

### GLSL Material Shaders (`.material.glsl`)

Same structure as WGSL but with GLSL types. The generator uses `parseStructs()` and `parseFunctions()` from the custom GLSL parser:

```glsl
struct MyUniforms {
  float speed;
  vec4 color;
};

vec2 vertShader(vec2 position, vec2 uv, MyUniforms uniforms) {
  return position;
}

vec4 fragShader(vec2 uv, MyUniforms uniforms) {
  return uniforms.color;
}
```

Textures in GLSL use `sampler2D` (single argument, not texture/sampler pairs):

```glsl
vec4 fragShader(vec2 uv, MyUniforms uniforms, sampler2D myTex) {
  return texture(myTex, uv);
}
```

## Patterns

### Typical Vite Plugin Integration

The `vite-shader-plugin` tool watches for shader file changes during development and invokes the appropriate generator:

```typescript
import { generateMaterialTypesSource, readTextFile, writeFileIfChanged } from "@avtools/power2d-codegen";

// Read the shader source
const shaderCode = await readTextFile("src/shaders/basic.material.wgsl");

// Generate TypeScript companion
const { typesSource } = generateMaterialTypesSource(shaderCode, "basic");

// Write only if changed (avoids unnecessary HMR triggers)
await writeFileIfChanged("src/shaders/basic.material.wgsl.generated.ts", typesSource);
```

### Using Generated Material Code

```typescript
// In application code, import the generated module
import { createBasicMaterial } from "./basic.material.wgsl.generated.ts";

const mat = createBasicMaterial(scene);
mat.setUniforms({ speed: 2.0, color: [1, 0, 0, 1] });
mat.setCanvasSize(canvas.width, canvas.height);
mesh.material = mat.material;

// Later:
mat.dispose();
```

### Using Generated Fragment Effect Code

```typescript
import { BlurEffect } from "./blur.fragFunc.wgsl.frag.generated.ts";

const blur = new BlurEffect(engine, { inputTex: someShaderSource }, 1280, 720);
blur.setUniforms({ radius: 10, strength: 1.5 });

// Chain effects
blur.setSrcs({ inputTex: previousEffect });
```

### Using Generated Compute Shader Code

```typescript
import {
  createUniformBuffer_params,
  updateUniformBuffer_params,
  createStorageBuffer_particles,
  writeStorageValue_particles,
  updateStorageBuffer_particles,
  createShader,
} from "./animation.compute.wgsl.generated.ts";

const params = createUniformBuffer_params(engine, { deltaTime: 0.016 });
const particles = createStorageBuffer_particles(engine, 1024, {
  initial: initialParticleData,
});

const compute = createShader(engine, {
  params,
  particles: particles.buffer,
});

// Per frame:
updateUniformBuffer_params(params, { deltaTime: dt });
await compute.shader.dispatchWhenReady(16, 1, 1);
```

### Deno Shader Watch Tool

```typescript
import { watchShaders } from "@avtools/power2d-codegen";
// or via the shader-watch tool:
// deno run --allow-read --allow-write tools/shader-watch/watch.ts src generated
```

### Error Handling for Fragment Effects

When a shader has a compilation error, the vite plugin generates a stub module that throws at runtime with a descriptive message:

```typescript
const errorSource = buildFragmentShaderErrorArtifactSource({
  effectClassName: "BlurEffect",
  uniformInterfaceName: "BlurUniforms",
  shaderPrefix: "Blur",
  relativeSourcePath: "src/shaders/blur.fragFunc.wgsl",
  errorMessage: "Missing pass0 function",
});
// Writes a .ts file where constructing BlurEffect throws the error message
```

## Caveats and Constraints

1. **No nested structs or arrays in material/stroke uniforms.** Uniform struct fields must be scalar or vector types only. Fragment effect uniforms do support fixed-size arrays of scalars and vectors.

2. **Texture parameters must come in pairs (WGSL).** In WGSL shaders, every `texture_2d<f32>` argument must be immediately followed by a `sampler` argument. In GLSL, textures use single `sampler2D` arguments.

3. **Fragment effect pass naming is strict.** Pass functions must be named `pass0`, `pass1`, ... with no gaps. Each pass must return `vec4f`. Later passes can reference earlier passes via `pass0Texture`/`pass0Sampler` naming convention.

4. **Uniform binding names are prefixed.** The generator creates Babylon uniform binding names as `{argName}_{fieldName}` (e.g., `uniforms_speed`). This is an internal detail but matters if you inspect the raw `ShaderMaterial`.

5. **Internal power2d uniforms are injected.** Materials automatically get `power2d_shapeTranslate`, `power2d_shapeRotation`, `power2d_shapeScale`, `power2d_canvasWidth`, `power2d_canvasHeight` uniforms. Stroke materials additionally get `power2d_strokeThickness`.

6. **Name conversion uses PascalCase.** The `shaderBaseName` (derived from the filename without the suffix) is converted to PascalCase for all generated identifier names. Hyphens and underscores are treated as word separators.

7. **Generated files should not be hand-edited.** All output files begin with `// Auto-generated by ... DO NOT EDIT.` and are overwritten on each generation pass.

8. **GLSL output uses `ShadersStore` (WebGL), WGSL uses `ShadersStoreWGSL` (WebGPU).** The generated material factories register shaders in the appropriate Babylon shader store depending on the language.

9. **Compute shader codegen is WGSL-only.** There is no GLSL compute shader generator.

10. **`wgsl_reflect` dependency.** WGSL parsing depends on `wgsl_reflect@^1.2.3` (via npm). The GLSL parser is a lightweight custom implementation using regex (`glsl/parseGlsl.ts`).

11. **Fragment effect uniform annotations are optional.** If no comment annotation is present on a struct field, defaults are zero-initialized and no UI metadata is emitted for that field.

12. **Boolean uniforms are encoded as floats.** WGSL `bool` uniforms are passed to Babylon as `setFloat` with `? 1 : 0` conversion since Babylon's `ShaderMaterial` does not have a native boolean setter.

## Monorepo Relationships

### Consumers

- **`tools/vite-shader-plugin/`** -- The primary consumer. A Vite plugin that watches shader files during development, calls the appropriate generator on file change, and writes `.generated.ts` files alongside the source shaders. Supports all seven shader categories, configurable source/output directories, and custom import path overrides for fragment effects.

- **`tools/shader-watch/`** -- A standalone Deno file watcher that monitors a directory for `.material.wgsl` and `.strokeMaterial.wgsl` changes and regenerates TypeScript output. Used for code generation outside the Vite dev server context.

### Downstream Packages

- **`packages/power2d/`** -- The 2D rendering library that consumes the generated material and stroke material TypeScript files. The generated factory functions produce `ShaderMaterial` instances configured for power2d's shape rendering pipeline (pixel-space coordinates, shape transforms, alpha blending).

- **`packages/shader-fx-babylon/`** -- Consumes generated fragment effect files. Provides the `CustomShaderEffect` base class that the generated `*Effect` classes extend. The generated effect classes wire up multi-pass rendering, texture input management, and typed uniform setters.

### Data Flow

```
*.material.wgsl -----> vite-shader-plugin / shader-watch
*.strokeMaterial.wgsl -----> calls power2d-codegen generators
*.fragFunc.wgsl -----> writes .generated.ts files
*.compute.wgsl -----> consumed by app code / power2d / shader-fx-babylon
*.material.glsl  ----->
```

### Import Map Configuration

In the monorepo `deno.json`, the package is mapped as:
```json
{
  "name": "@avtools/power2d-codegen",
  "exports": "./mod.ts",
  "imports": {
    "wgsl_reflect": "npm:wgsl_reflect@^1.2.3"
  }
}
```

The `tools/vite-shader-plugin` imports directly from the source files via relative paths rather than the package alias, since it runs in a Node/Vite context.

## File Structure

```
packages/power2d-codegen/
  mod.ts                                    # Public API re-exports
  deno.json                                 # Package manifest
  codegen/
    codegenIO.ts                            # readTextFile, writeFileIfChanged
  wgsl/
    generateMaterialTypesCore.ts            # .material.wgsl -> .generated.ts
    generateStrokeMaterialTypesCore.ts      # .strokeMaterial.wgsl -> .generated.ts
    generateFragmentShaderCore.ts           # .fragFunc.wgsl -> .frag.generated.ts
    generateComputeShaderTypesCore.ts       # .compute.wgsl -> .generated.ts
  glsl/
    parseGlsl.ts                            # Regex-based GLSL struct/function parser
    generateMaterialTypesCore_GL.ts         # .material.glsl -> .material.gl.generated.ts
    generateStrokeMaterialTypesCore_GL.ts   # .strokeMaterial.glsl -> .strokeMaterial.gl.generated.ts
    generateFragmentShaderCore_GL.ts        # .fragFunc.glsl -> .frag.gl.generated.ts
```
