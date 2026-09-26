// WGSL for the stroke rasterizer, the cascade passes, the final gather, the
// bounce feed, the brute-force reference, and the display pass. Every pass is
// a fullscreen triangle; fragment positions are pixel centers of the pass's
// own output, and scene textures are addressed in render pixels.
// export const FULLSCREEN_VERTEX = /* wgsl */ `
// @vertex
// fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
// var positions = array<vec2f, 3>(
// vec2f(-1.0, -1.0),
// vec2f(3.0, -1.0),
// vec2f(-1.0, 3.0),
// );
// return vec4f(positions[index], 0.0, 1.0);
// }
// `;
// Nearest outline wins per pixel. Outputs: emission (a = coverage),
// transmittance (a = coverage), albedo, and the signed distance to the nearest
// outline edge in pixels (negative inside).

// #include "fullscreen_vertex.wgsl"

struct SceneUniforms {
  size: vec2f,
  segmentCount: u32,
  shapeCount: u32,
};
struct Segment {
  a: vec2f,
  b: vec2f,
  shape: u32,
  pad: u32,
};
struct Material {
  emission: vec4f,       // rgb, halfWidth
  transmittance: vec4f,  // rgb, 0
  albedo: vec4f,         // rgb, 0
};
@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;

struct Out {
  @location(0) emission: vec4f,
  @location(1) transmittance: vec4f,
  @location(2) albedo: vec4f,
  @location(3) distance: vec4f,
};

fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(p - a, ab) / max(l2, 1e-12), 0.0, 1.0), l2 > 0.0);
  return length(p - (a + ab * t));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> Out {
  let p = pos.xy;
  var best = 1e4;
  var bestShape = 0u;
  for (var i = 0u; i < u.segmentCount; i++) {
    let s = segments[i];
    let d = segmentDistance(p, s.a, s.b) - materials[s.shape].emission.w;
    if (d < best) {
      best = d;
      bestShape = s.shape;
    }
  }
  var out: Out;
  if (u.segmentCount > 0u && best <= 0.0) {
    let m = materials[bestShape];
    out.emission = vec4f(m.emission.rgb, 1.0);
    out.transmittance = vec4f(m.transmittance.rgb, 1.0);
    out.albedo = vec4f(m.albedo.rgb, 1.0);
  } else {
    out.emission = vec4f(0.0, 0.0, 0.0, 0.0);
    out.transmittance = vec4f(1.0, 1.0, 1.0, 0.0);
    out.albedo = vec4f(0.0, 0.0, 0.0, 0.0);
  }
  out.distance = vec4f(best, 0.0, 0.0, 1.0);
  return out;
}
