// Per-pixel irradiance from a stored cascade 0 (the non-fused path): the
// bilinear gather of gather.wgsl over the packed direction store.

override TILE: u32 = 16u;

struct GatherUniforms {
  probeCount: vec2u,
  probeSpacing: f32,
  storedDirs: u32,
};
@group(0) @binding(0) var<uniform> u: GatherUniforms;
@group(0) @binding(1) var<storage, read> store: array<u32>;
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
  let probes = u.probeCount.x * u.probeCount.y;
  var sum = vec3f(0.0);
  for (var c = 0; c < 4; c++) {
    let q = clamp(base + vec2i(c % 2, c / 2), vec2i(0), vec2i(u.probeCount) - vec2i(1));
    let probe = u32(q.y) * u.probeCount.x + u32(q.x);
    var Lc = vec3f(0.0);
    for (var k = 0u; k < u.storedDirs; k++) {
      let i = (k * probes + probe) * 3u;
      Lc += vec3f(unpack2x16float(store[i]), unpack2x16float(store[i + 1u]).x);
    }
    sum += weights[c] * Lc;
  }
  textureStore(irradianceOut, vec2i(gid.xy), vec4f(sum / f32(u.storedDirs), 1.0));
}
