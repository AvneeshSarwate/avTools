// Fit a texture into the output and encode it for the canvas. Modes:
// 0 tone-mapped HDR radiance, 1 plain 0..1 color, 2 signed-distance ramp.
// Tone maps: 0 ACES (the sRGB fit from BakingLab), 1 the soft 1 - 1/(1+x)^2.5.

// #include "fullscreen_vertex.wgsl"

struct DisplayUniforms {
  outputSize: vec2f,
  exposure: f32,
  mode: f32,
  tonemap: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(0) var<uniform> u: DisplayUniforms;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;

fn encodeSrgb(linear: vec3f) -> vec3f {
  let c = clamp(linear, vec3f(0.0), vec3f(1.0));
  let low = 12.92 * c;
  let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(low, high, c > vec3f(0.0031308));
}

fn tonemapAces(color: vec3f) -> vec3f {
  // sRGB => AP1 => RRT/ODT fit => sRGB (column-major constructors).
  let inputMat = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
  );
  let outputMat = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
  );
  let c = inputMat * color;
  let a = c * (c + 0.0245786) - 0.000090537;
  let b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(outputMat * (a / b), vec3f(0.0), vec3f(1.0));
}

fn tonemapSoft(color: vec3f) -> vec3f {
  return vec3f(1.0) - vec3f(1.0) / pow(vec3f(1.0) + color, vec3f(2.5));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  // Texel loads rather than a sampler: the distance texture is r32float,
  // which is not filterable, and nearest scaling is fine for a monitor.
  let dims = vec2f(textureDimensions(sourceTex));
  let texel = vec2i(clamp(floor(pos.xy / u.outputSize * dims), vec2f(0.0), dims - vec2f(1.0)));
  let c = textureLoad(sourceTex, texel, 0);
  let mode = i32(u.mode);
  if (mode == 2) {
    let d = c.r;
    if (d <= 0.0) {
      return vec4f(1.0, 0.35, 0.2, 1.0);
    }
    let ring = 0.35 + 0.65 * fract(d / 16.0);
    return vec4f(vec3f(ring) * vec3f(0.6, 0.8, 1.0), 1.0);
  }
  if (mode == 1) {
    return vec4f(encodeSrgb(c.rgb), 1.0);
  }
  let exposed = max(c.rgb, vec3f(0.0)) * u.exposure;
  let mapped = select(tonemapAces(exposed), tonemapSoft(exposed), u.tonemap > 0.5);
  return vec4f(encodeSrgb(mapped), 1.0);
}
