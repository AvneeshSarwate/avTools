// Compute scene rasterizer, pass 2: one workgroup per tile, one lane per
// pixel. The tile's binned segments are staged once in workgroup memory and
// every pixel tests only those; a tile whose bin overflowed falls back to all
// segments, so the result is always exact where it matters. Far from every
// binned segment the distance written is a lower bound (see pass 1), which
// sphere tracing accepts. Outputs match the fragment rasterizer: emission
// (a = coverage), transmittance (a = coverage), albedo, signed distance.

override TILE: u32 = 16u;
override BIN_CAPACITY: u32 = 128u;

struct SceneUniforms {
  size: vec2f,
  segmentCount: u32,
  shapeCount: u32,
  tiles: vec2u,
  binRadius: f32,
  pad: f32,
};
struct Segment {
  a: vec2f,
  b: vec2f,
  shape: u32,
  pad: u32,
};
struct Material {
  emission: vec4f,
  transmittance: vec4f,
  albedo: vec4f,
};
@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
@group(0) @binding(3) var<storage, read> bins: array<u32>;
@group(0) @binding(4) var<storage, read> tileMeta: array<vec2u>;
@group(0) @binding(5) var emissionOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var transmittanceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var albedoOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var distanceOut: texture_storage_2d<r32float, write>;

struct Staged {
  a: vec2f,
  b: vec2f,
  halfWidth: f32,
  shape: u32,
};
var<workgroup> staged: array<Staged, BIN_CAPACITY>;

fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(p - a, ab) / max(l2, 1e-12), 0.0, 1.0), l2 > 0.0);
  return length(p - (a + ab * t));
}

@compute @workgroup_size(TILE, TILE, 1)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let tileIndex = wg.y * u.tiles.x + wg.x;
  let info = tileMeta[tileIndex];
  let binned = info.x;
  let complete = binned <= BIN_CAPACITY;
  if (complete) {
    for (var i = li; i < binned; i += TILE * TILE) {
      let s = segments[bins[tileIndex * BIN_CAPACITY + i]];
      staged[i] = Staged(s.a, s.b, materials[s.shape].emission.w, s.shape);
    }
  }
  workgroupBarrier();
  if (any(gid.xy >= vec2u(u.size))) {
    return;
  }
  let p = vec2f(gid.xy) + 0.5;
  var best = 1e4;
  var bestShape = 0u;
  if (complete) {
    for (var i = 0u; i < binned; i++) {
      let s = staged[i];
      let d = segmentDistance(p, s.a, s.b) - s.halfWidth;
      if (d < best) {
        best = d;
        bestShape = s.shape;
      }
    }
    if (best > u.binRadius) {
      // Every unbinned segment is farther than binRadius from every pixel of
      // this tile, and the distance field is 1-Lipschitz, so the tile-centre
      // distance minus this pixel's distance to the centre bounds the rest.
      let center = (vec2f(wg.xy) + 0.5) * f32(TILE);
      best = max(u.binRadius, bitcast<f32>(info.y) - length(p - center));
    }
  } else {
    for (var i = 0u; i < u.segmentCount; i++) {
      let s = segments[i];
      let d = segmentDistance(p, s.a, s.b) - materials[s.shape].emission.w;
      if (d < best) {
        best = d;
        bestShape = s.shape;
      }
    }
  }
  let texel = vec2i(gid.xy);
  if (u.segmentCount > 0u && best <= 0.0) {
    let m = materials[bestShape];
    textureStore(emissionOut, texel, vec4f(m.emission.rgb, 1.0));
    textureStore(transmittanceOut, texel, vec4f(m.transmittance.rgb, 1.0));
    textureStore(albedoOut, texel, vec4f(m.albedo.rgb, 1.0));
  } else {
    textureStore(emissionOut, texel, vec4f(0.0, 0.0, 0.0, 0.0));
    textureStore(transmittanceOut, texel, vec4f(1.0, 1.0, 1.0, 0.0));
    textureStore(albedoOut, texel, vec4f(0.0, 0.0, 0.0, 0.0));
  }
  textureStore(distanceOut, texel, vec4f(best, 0.0, 0.0, 1.0));
}
