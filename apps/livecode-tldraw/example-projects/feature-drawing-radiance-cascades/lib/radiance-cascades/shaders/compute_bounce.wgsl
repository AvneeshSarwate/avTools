// Effective emission for the next frame (see bounce.wgsl for the model). The
// compute cascade never stores cascade 0, so the directional radiance near
// outlines comes from the band buffer cascade 0 filled last frame: `slotMap`
// maps a probe to its band slot. A probe outside the band (or dropped when the
// band overflowed) contributes its irradiance as if it were uniform over the
// hemisphere, the same as the fragment pass does without a normal.

override TILE: u32 = 16u;

struct BounceUniforms {
  probeCount: vec2u,
  probeSpacing: f32,
  storedDirs: u32,
  rayCount: u32,
  strength: f32,
  offset: f32,
  pad: u32,
};
@group(0) @binding(0) var<uniform> u: BounceUniforms;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var albedoTex: texture_2d<f32>;
@group(0) @binding(3) var distanceTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> slotMap: array<u32>;
@group(0) @binding(5) var<storage, read> band: array<u32>;
@group(0) @binding(6) var probeIrradiance: texture_2d<f32>;
@group(0) @binding(7) var effectiveOut: texture_storage_2d<rgba16float, write>;

const TAU_F: f32 = 6.283185307179586;

fn bandRadiance(slot: u32, k: u32) -> vec3f {
  let i = ((slot - 1u) * u.storedDirs + k) * 2u;
  return vec3f(unpack2x16float(band[i]), unpack2x16float(band[i + 1u]).x);
}

@compute @workgroup_size(TILE, TILE, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(textureDimensions(distanceTex));
  if (any(vec2i(gid.xy) >= dims)) {
    return;
  }
  let texel = vec2i(gid.xy);
  let e = textureLoad(emissionTex, texel, 0);
  if (u.strength <= 0.0 || e.a < 0.5) {
    textureStore(effectiveOut, texel, e);
    return;
  }
  let pos = vec2f(texel) + 0.5;
  let d = textureLoad(distanceTex, texel, 0).r;
  let dx = textureLoad(distanceTex, clamp(texel + vec2i(1, 0), vec2i(0), dims - 1), 0).r
    - textureLoad(distanceTex, clamp(texel - vec2i(1, 0), vec2i(0), dims - 1), 0).r;
  let dy = textureLoad(distanceTex, clamp(texel + vec2i(0, 1), vec2i(0), dims - 1), 0).r
    - textureLoad(distanceTex, clamp(texel - vec2i(0, 1), vec2i(0), dims - 1), 0).r;
  var n = vec2f(dx, dy);
  let nl = length(n);
  let hasNormal = nl > 1e-4;
  n = select(vec2f(0.0), n / max(nl, 1e-4), hasNormal);
  let samplePos = pos + n * (max(-d, 0.0) + u.offset);

  let upos = samplePos / u.probeSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let dirs = u.storedDirs;
  let group = f32(u.rayCount) / f32(dirs);
  var slots = vec4u(0u);
  var means = array<vec3f, 4>();
  for (var c = 0; c < 4; c++) {
    let q = clamp(base + vec2i(c % 2, c / 2), vec2i(0), vec2i(u.probeCount) - vec2i(1));
    slots[c] = slotMap[u32(q.y) * u.probeCount.x + u32(q.x)];
    means[c] = textureLoad(probeIrradiance, q, 0).rgb;
  }
  var irradiance = vec3f(0.0);
  for (var k = 0u; k < dirs; k++) {
    var weight = 2.0 / f32(dirs);
    if (dirs > 1u && hasNormal) {
      let a = TAU_F * (f32(k) * group + group * 0.5) / f32(u.rayCount);
      weight = max(0.0, dot(vec2f(cos(a), sin(a)), n)) * TAU_F / f32(dirs);
    }
    var L = vec3f(0.0);
    for (var c = 0; c < 4; c++) {
      let slot = slots[c];
      L += weights[c] * select(means[c], bandRadiance(slot, k), slot != 0u);
    }
    irradiance += L * weight;
  }
  let albedo = textureLoad(albedoTex, texel, 0).rgb;
  textureStore(effectiveOut, texel, vec4f(e.rgb + u.strength * albedo * irradiance * 0.5, e.a));
}
