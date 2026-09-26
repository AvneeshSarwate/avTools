// Compute scene rasterizer, pass 1: bin the segments per screen tile so the
// raster pass tests only nearby segments. One workgroup per tile; its lanes
// stride over the segments and claim bin slots with a workgroup atomic. A
// segment joins a tile's bin when its outline can come within `binRadius` of
// any pixel of the tile (tile-centre distance minus half the tile diagonal).
// The pass also records, per tile, the distance from the tile centre to the
// nearest outline over ALL segments: pixels whose nearest outline is not in
// the bin take that minus half a diagonal as a conservative lower bound, which
// is all sphere tracing needs.

override TILE: u32 = 16u;
override BIN_CAPACITY: u32 = 128u;
override LANES: u32 = 64u;

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
  emission: vec4f,       // rgb, halfWidth
  transmittance: vec4f,  // rgb, 0
  albedo: vec4f,         // rgb, 0
};
@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
/// `tiles.x * tiles.y * BIN_CAPACITY` segment indices.
@group(0) @binding(3) var<storage, read_write> bins: array<u32>;
/// Per tile: (segments that wanted a slot, bits of the tile-centre distance).
@group(0) @binding(4) var<storage, read_write> tileMeta: array<vec2u>;

var<workgroup> claimed: atomic<u32>;
var<workgroup> farBits: atomic<u32>;

fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(p - a, ab) / max(l2, 1e-12), 0.0, 1.0), l2 > 0.0);
  return length(p - (a + ab * t));
}

@compute @workgroup_size(LANES, 1, 1)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) lane: u32,
) {
  if (lane == 0u) {
    atomicStore(&claimed, 0u);
    atomicStore(&farBits, 0x7f7fffffu); // largest finite f32
  }
  workgroupBarrier();
  let tile = wg.xy;
  let tileIndex = tile.y * u.tiles.x + tile.x;
  let center = (vec2f(tile) + 0.5) * f32(TILE);
  let halfDiag = f32(TILE) * 0.5 * sqrt(2.0);
  for (var i = lane; i < u.segmentCount; i += LANES) {
    let s = segments[i];
    let d = segmentDistance(center, s.a, s.b) - materials[s.shape].emission.w;
    // Non-negative floats order as their bits do, so atomicMin works.
    atomicMin(&farBits, bitcast<u32>(max(d, 0.0)));
    if (d - halfDiag <= u.binRadius) {
      let slot = atomicAdd(&claimed, 1u);
      if (slot < BIN_CAPACITY) {
        bins[tileIndex * BIN_CAPACITY + slot] = i;
      }
    }
  }
  workgroupBarrier();
  if (lane == 0u) {
    tileMeta[tileIndex] = vec2u(atomicLoad(&claimed), atomicLoad(&farBits));
  }
}
