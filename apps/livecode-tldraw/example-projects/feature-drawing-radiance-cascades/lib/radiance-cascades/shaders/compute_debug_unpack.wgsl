// Debug views for the compute backend: unpack a level's store (and raw store)
// into the direction-tiled textures the fragment backend renders directly, so
// the same display pass shows either.

override TILE: u32 = 16u;

struct UnpackUniforms {
  probeCount: vec2u,
  storedDirs: u32,
  tileCols: u32,
};
@group(0) @binding(0) var<uniform> u: UnpackUniforms;
@group(0) @binding(1) var<storage, read> store: array<u32>;
@group(0) @binding(2) var<storage, read> rawStore: array<u32>;
@group(0) @binding(3) var mergedOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var rawOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(TILE, TILE, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(textureDimensions(mergedOut));
  if (any(vec2i(gid.xy) >= dims)) {
    return;
  }
  let texel = vec2i(gid.xy);
  let probes = vec2i(u.probeCount);
  let tile = texel / probes;
  let probe = texel - tile * probes;
  let stored = u32(tile.y) * u.tileCols + u32(tile.x);
  if (stored >= u.storedDirs) {
    textureStore(mergedOut, texel, vec4f(0.0));
    textureStore(rawOut, texel, vec4f(0.0));
    return;
  }
  let entry = stored * u32(probes.x * probes.y) + u32(probe.y * probes.x + probe.x);
  let a = unpack2x16float(store[entry * 3u]);
  let b = unpack2x16float(store[entry * 3u + 1u]);
  textureStore(mergedOut, texel, vec4f(a, b.x, 1.0));
  let r = unpack2x16float(rawStore[entry * 2u]);
  let s = unpack2x16float(rawStore[entry * 2u + 1u]);
  textureStore(rawOut, texel, vec4f(r, s.x, 1.0));
}
