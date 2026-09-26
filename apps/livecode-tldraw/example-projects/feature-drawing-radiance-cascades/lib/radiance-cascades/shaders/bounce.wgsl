// Effective emission for the next frame: the scene's emission plus, inside an
// outline, the light that reached the outline last frame times its albedo.
// Incoming light is the hemispherical irradiance just outside the surface
// (cascade 0's stored directions, cosine-weighted against the outline
// normal), and a diffuse 2D surface re-emits albedo * E / 2.

// #include "fullscreen_vertex.wgsl"

struct BounceUniforms {
  probeCount: vec2f,
  probeSpacing: f32,
  storedDirs: f32,
  tileCols: f32,
  rayCount: f32,
  strength: f32,
  offset: f32,
};
@group(0) @binding(0) var<uniform> u: BounceUniforms;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var albedoTex: texture_2d<f32>;
@group(0) @binding(3) var distanceTex: texture_2d<f32>;
@group(0) @binding(4) var radianceTex: texture_2d<f32>;

const TAU_F: f32 = 6.283185307179586;

fn texelOf(probe: vec2i, stored: i32) -> vec2i {
  let cols = i32(u.tileCols);
  return vec2i(stored % cols, stored / cols) * vec2i(u.probeCount) + probe;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let texel = vec2i(floor(pos.xy));
  let e = textureLoad(emissionTex, texel, 0);
  if (u.strength <= 0.0 || e.a < 0.5) {
    return e;
  }
  let dims = vec2i(textureDimensions(distanceTex));
  let d = textureLoad(distanceTex, texel, 0).r;
  let dx = textureLoad(distanceTex, clamp(texel + vec2i(1, 0), vec2i(0), dims - 1), 0).r
    - textureLoad(distanceTex, clamp(texel - vec2i(1, 0), vec2i(0), dims - 1), 0).r;
  let dy = textureLoad(distanceTex, clamp(texel + vec2i(0, 1), vec2i(0), dims - 1), 0).r
    - textureLoad(distanceTex, clamp(texel - vec2i(0, 1), vec2i(0), dims - 1), 0).r;
  var n = vec2f(dx, dy);
  let nl = length(n);
  let hasNormal = nl > 1e-4;
  n = select(vec2f(0.0), n / max(nl, 1e-4), hasNormal);
  let samplePos = pos.xy + n * (max(-d, 0.0) + u.offset);

  let upos = samplePos / u.probeSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let dirs = i32(u.storedDirs);
  let group = u.rayCount / u.storedDirs;
  var irradiance = vec3f(0.0);
  for (var k = 0; k < dirs; k++) {
    var weight = 2.0 / f32(dirs);
    if (dirs > 1 && hasNormal) {
      let a = TAU_F * (f32(k) * group + group * 0.5) / u.rayCount;
      weight = max(0.0, dot(vec2f(cos(a), sin(a)), n)) * TAU_F / f32(dirs);
    }
    var L = vec3f(0.0);
    for (var c = 0; c < 4; c++) {
      let q = clamp(base + vec2i(c % 2, c / 2), vec2i(0), vec2i(u.probeCount) - vec2i(1));
      L += weights[c] * textureLoad(radianceTex, texelOf(q, k), 0).rgb;
    }
    irradiance += L * weight;
  }
  let albedo = textureLoad(albedoTex, texel, 0).rgb;
  return vec4f(e.rgb + u.strength * albedo * irradiance * 0.5, e.a);
}
