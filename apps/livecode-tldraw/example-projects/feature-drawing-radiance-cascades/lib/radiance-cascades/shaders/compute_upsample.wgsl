// Per-pixel irradiance from per-probe irradiance when cascade 0's probe
// spacing is above one pixel: the bilinear gather of gather.wgsl, which
// commutes with the direction mean the cascade-0 pass already took.

override TILE: u32 = 16u;

struct UpsampleUniforms {
  probeCount: vec2u,
  probeSpacing: f32,
  pad: f32,
};
@group(0) @binding(0) var<uniform> u: UpsampleUniforms;
@group(0) @binding(1) var probeIrradiance: texture_2d<f32>;
@group(0) @binding(2) var irradianceOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(TILE, TILE, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(textureDimensions(irradianceOut));
  if (any(vec2i(gid.xy) >= dims)) {
    return;
  }
  let pos = vec2f(gid.xy) + 0.5;
  let upos = pos / u.probeSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var sum = vec3f(0.0);
  for (var c = 0; c < 4; c++) {
    let q = clamp(base + vec2i(c % 2, c / 2), vec2i(0), vec2i(u.probeCount) - vec2i(1));
    sum += weights[c] * textureLoad(probeIrradiance, q, 0).rgb;
  }
  textureStore(irradianceOut, vec2i(gid.xy), vec4f(sum, 1.0));
}
