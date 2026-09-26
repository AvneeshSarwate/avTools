// #include "fullscreen_vertex.wgsl"

struct GatherUniforms {
  probeCount: vec2f,
  probeSpacing: f32,
  storedDirs: f32,
  tileCols: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(0) var<uniform> u: GatherUniforms;
@group(0) @binding(1) var radianceTex: texture_2d<f32>;

fn texelOf(probe: vec2i, stored: i32) -> vec2i {
  let cols = i32(u.tileCols);
  return vec2i(stored % cols, stored / cols) * vec2i(u.probeCount) + probe;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let upos = pos.xy / u.probeSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let dirs = i32(u.storedDirs);
  var sum = vec3f(0.0);
  for (var c = 0; c < 4; c++) {
    let q = clamp(base + vec2i(c % 2, c / 2), vec2i(0), vec2i(u.probeCount) - vec2i(1));
    for (var k = 0; k < dirs; k++) {
      sum += weights[c] * textureLoad(radianceTex, texelOf(q, k), 0).rgb;
    }
  }
  return vec4f(sum / f32(dirs), 1.0);
}
