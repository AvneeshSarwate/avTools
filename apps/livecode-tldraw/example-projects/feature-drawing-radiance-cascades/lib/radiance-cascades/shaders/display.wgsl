// Fit a texture into the output and encode it for the canvas. Modes:
// 0 tone-mapped HDR radiance, 1 plain 0..1 color, 2 signed-distance ramp.

// #include "fullscreen_vertex.wgsl"

struct DisplayUniforms {
  outputSize: vec2f,
  exposure: f32,
  mode: f32,
};
@group(0) @binding(0) var<uniform> u: DisplayUniforms;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;

fn encode(linear: vec3f) -> vec3f {
  return pow(clamp(linear, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
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
    return vec4f(encode(c.rgb), 1.0);
  }
  let exposed = c.rgb * u.exposure;
  let mapped = vec3f(1.0) - vec3f(1.0) / pow(vec3f(1.0) + exposed, vec3f(2.5));
  return vec4f(encode(mapped), 1.0);
}
