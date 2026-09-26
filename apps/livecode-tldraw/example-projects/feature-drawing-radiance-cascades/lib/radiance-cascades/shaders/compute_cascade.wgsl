// One cascade level as a compute pass. A lane is one (probe, stored direction);
// a workgroup is a TX x TY tile of probes times DW consecutive stored
// directions, laid out 1D with the probe fastest, so a SIMD group holds
// neighbouring probes marching the same direction (as the fragment tiling
// does) rather than one probe's divergent directions. Levels are stored in
// storage buffers, direction-major (dir * probes + probe), each entry three
// u32 of packed f16: radiance rgb and transmittance rgb. What the fragment
// version cannot do:
//
// - USE_PATCH: the scene texels every ray of the tile can touch (tile extent
//   plus a halo) are loaded into workgroup memory once and marched there.
//   Worth it where many short rays share a small patch (cascade 0 with the
//   bilinear fix); the planner decides per level.
// - USE_FOOT: the upper-level probes and directions this tile merges with are
//   staged in workgroup memory once instead of being re-read per lane.
// - REDUCE (cascade 0): a lane is one probe and loops over all of its
//   stored directions, so a SIMD group of neighbouring probes marches one
//   direction at a time (as the fragment tiling does), the direction mean
//   stays in registers and goes straight to the irradiance texture, and
//   cascade 0 is never stored. Probes within `bandWidth` of an outline also
//   append their directional radiance to a compact band buffer (atomic slot
//   counter) for the bounce pass. Needs no workgroup memory or barrier.
// Rays are otherwise identical to cascade.wgsl (merge modes, pre-averaging,
// overlap, sky).

override TX: u32 = 16u;
override TY: u32 = 16u;
override DW: u32 = 1u;
override REDUCE: bool = false;
override USE_PATCH: bool = false;
override PATCH_W: u32 = 1u;
override PATCH_H: u32 = 1u;
override USE_FOOT: bool = false;
override FOOT_X: u32 = 1u;
override FOOT_Y: u32 = 1u;
override FOOT_D: u32 = 1u;

struct CascadeUniforms {
  sky: vec4f,
  sceneSize: vec2f,
  probeCount: vec2u,
  upperProbeCount: vec2u,
  probeSpacing: f32,
  upperSpacing: f32,
  rayCount: u32,
  storedDirs: u32,
  upperRayCount: u32,
  upperStoredDirs: u32,
  intervalStart: f32,
  intervalEnd: f32,
  branching: u32,
  isTop: u32,
  mergeMode: u32,
  preAverage: u32,
  useDistanceField: u32,
  stepSize: f32,
  intervalOverlap: f32,
  maxSteps: i32,
  storeDirs: u32,
  storeRaw: u32,
  bandCapacity: u32,
  bandWidth: f32,
  halo: f32,
  pad0: f32,
};
struct Counter {
  n: atomic<u32>,
};
@group(0) @binding(0) var<uniform> u: CascadeUniforms;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(3) var distanceTex: texture_2d<f32>;
/// The level above, packed; unused at the top.
@group(0) @binding(4) var<storage, read> upper: array<u32>;
/// This level's store, packed; written when `storeDirs` is set.
@group(0) @binding(5) var<storage, read_write> own: array<u32>;
/// This level's own-interval radiance for debugging, two u32 per entry.
@group(0) @binding(6) var<storage, read_write> rawStore: array<u32>;
/// REDUCE only: per-probe irradiance.
@group(0) @binding(7) var irradianceOut: texture_storage_2d<rgba16float, write>;
/// REDUCE only: probe -> band slot + 1, 0 when the probe is not in the band.
@group(0) @binding(8) var<storage, read_write> slotMap: array<u32>;
/// REDUCE only: per band slot, DW radiances of two packed u32.
@group(0) @binding(9) var<storage, read_write> band: array<u32>;
@group(0) @binding(10) var<storage, read_write> bandCounter: Counter;

var<workgroup> scenePatch: array<vec4u, PATCH_W * PATCH_H>;
var<workgroup> footprint: array<u32, FOOT_X * FOOT_Y * FOOT_D * 3u>;

var<private> patchOrigin: vec2i;
var<private> footOrigin: vec2i;
var<private> footDir0: u32;

fn patchWord(texel: vec2i) -> vec4u {
  let l = texel - patchOrigin;
  return scenePatch[u32(l.y) * PATCH_W + u32(l.x)];
}

fn inPatch(texel: vec2i) -> bool {
  let l = texel - patchOrigin;
  return USE_PATCH && all(l >= vec2i(0)) && l.x < i32(PATCH_W) && l.y < i32(PATCH_H);
}

// #include "march.wgsl"

fn sceneDistance(texel: vec2i) -> f32 {
  if (inPatch(texel)) {
    return bitcast<f32>(patchWord(texel).w);
  }
  return textureLoad(distanceTex, texel, 0).r;
}

fn sceneMedium(texel: vec2i) -> Medium {
  if (inPatch(texel)) {
    let w = patchWord(texel);
    let a = unpack2x16float(w.x);
    let b = unpack2x16float(w.y);
    let c = unpack2x16float(w.z);
    return Medium(vec3f(a, b.x), vec3f(b.y, c));
  }
  return Medium(
    textureLoad(emissionTex, texel, 0).rgb,
    textureLoad(transmittanceTex, texel, 0).rgb,
  );
}

fn marchParams() -> MarchParams {
  return MarchParams(u.sceneSize, u.useDistanceField != 0u, u.stepSize, u.maxSteps);
}

/// The distance field where a probe's rays start, shared by all of them.
fn startDistanceAt(start: vec2f) -> f32 {
  if (u.useDistanceField == 0u || !inBounds(start, u.sceneSize)) {
    return -1.0;
  }
  return sceneDistance(vec2i(floor(start)));
}

const TAU_F: f32 = 6.283185307179586;

fn dirOf(index: f32, count: f32) -> vec2f {
  let a = TAU_F * (index + 0.5) / count;
  return vec2f(cos(a), sin(a));
}

fn unpackLT(x: u32, y: u32, z: u32) -> Hit {
  let a = unpack2x16float(x);
  let b = unpack2x16float(y);
  let c = unpack2x16float(z);
  return Hit(vec3f(a, b.x), vec3f(b.y, c));
}

fn upperIndex(probe: vec2i, stored: u32) -> u32 {
  let probes = u.upperProbeCount.x * u.upperProbeCount.y;
  return (stored * probes + u32(probe.y) * u.upperProbeCount.x + u32(probe.x)) * 3u;
}

fn upperSample(probe: vec2i, stored: u32) -> Hit {
  if (USE_FOOT) {
    let l = probe - footOrigin;
    let dd = i32(stored) - i32(footDir0);
    if (all(l >= vec2i(0)) && l.x < i32(FOOT_X) && l.y < i32(FOOT_Y) && dd >= 0 && dd < i32(FOOT_D)) {
      let i = ((u32(l.y) * FOOT_X + u32(l.x)) * FOOT_D + u32(dd)) * 3u;
      return unpackLT(footprint[i], footprint[i + 1u], footprint[i + 2u]);
    }
  }
  let i = upperIndex(probe, stored);
  return unpackLT(upper[i], upper[i + 1u], upper[i + 2u]);
}

fn upperProbe(base: vec2i, corner: i32) -> vec2i {
  return clamp(base + vec2i(corner % 2, corner / 2), vec2i(0), vec2i(u.upperProbeCount) - vec2i(1));
}

struct Merged {
  L: vec3f,
  T: vec3f,
  raw: vec3f,
};

// Identical to cascade.wgsl's castMerged; see there for the merge modes.
fn castMerged(center: vec2f, d: i32, start: vec2f, startDistance: f32) -> Merged {
  let mp = marchParams();
  let rayCount = f32(u.rayCount);
  let w = dirOf(f32(d), rayCount);
  let t0 = u.intervalStart;
  let t1 = u.intervalEnd;
  let overlapEnd = center + w * (t0 + (t1 - t0) * u.intervalOverlap);
  if (u.isTop != 0u) {
    let hit = march(start, overlapEnd, mp, startDistance);
    return Merged(hit.L + hit.T * u.sky.rgb, hit.T, hit.L);
  }
  let upos = center / u.upperSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let upperPerDir = u.upperStoredDirs >= u.upperRayCount;
  let B = i32(u.branching);
  let childCount = select(1, B, upperPerDir);
  let upperRayCount = f32(u.upperRayCount);

  if (u.mergeMode == 1u) {
    var L = vec3f(0.0);
    var T = vec3f(0.0);
    var raw = vec3f(0.0);
    for (var c = 0; c < 4; c++) {
      let q = upperProbe(base, c);
      let qCenter = (vec2f(q) + 0.5) * u.upperSpacing;
      var Lc = vec3f(0.0);
      var Tc = vec3f(0.0);
      var rawc = vec3f(0.0);
      for (var k = 0; k < childCount; k++) {
        let stored = select(d, d * B + k, upperPerDir);
        let wc = select(w, dirOf(f32(d * B + k), upperRayCount), upperPerDir);
        let hit = march(start, qCenter + wc * t1, mp, startDistance);
        let up = upperSample(q, u32(stored));
        Lc += hit.L + hit.T * up.L;
        Tc += hit.T * up.T;
        rawc += hit.L;
      }
      let scale = weights[c] / f32(childCount);
      L += Lc * scale;
      T += Tc * scale;
      raw += rawc * scale;
    }
    return Merged(L, T, raw);
  }

  let hit = march(start, overlapEnd, mp, startDistance);
  var upL = vec3f(0.0);
  var upT = vec3f(0.0);
  for (var c = 0; c < 4; c++) {
    let q = upperProbe(base, c);
    if (u.mergeMode == 2u) {
      let qCenter = (vec2f(q) + 0.5) * u.upperSpacing;
      let v = overlapEnd - qCenter;
      let nominal = TAU_F * (f32(d) + 0.5) / rayCount;
      var shift = atan2(v.y, v.x) - nominal;
      shift = shift - floor((shift + 3.14159265) / TAU_F) * TAU_F;
      let stored = f32(u.upperStoredDirs);
      let shiftIndex = shift / TAU_F * stored;
      var Lc = vec3f(0.0);
      var Tc = vec3f(0.0);
      for (var k = 0; k < childCount; k++) {
        var idx = f32(select(d, d * B + k, upperPerDir)) + shiftIndex;
        idx = idx - floor(idx / stored) * stored;
        let i0 = i32(floor(idx)) % i32(stored);
        let i1 = (i0 + 1) % i32(stored);
        let fr = fract(idx);
        let s0 = upperSample(q, u32(i0));
        let s1 = upperSample(q, u32(i1));
        Lc += mix(s0.L, s1.L, fr);
        Tc += mix(s0.T, s1.T, fr);
      }
      upL += weights[c] * Lc / f32(childCount);
      upT += weights[c] * Tc / f32(childCount);
    } else {
      var Lc = vec3f(0.0);
      var Tc = vec3f(0.0);
      for (var k = 0; k < childCount; k++) {
        let s = upperSample(q, u32(select(d, d * B + k, upperPerDir)));
        Lc += s.L;
        Tc += s.T;
      }
      upL += weights[c] * Lc / f32(childCount);
      upT += weights[c] * Tc / f32(childCount);
    }
  }
  return Merged(hit.L + hit.T * upL, hit.T * upT, hit.L);
}

// One stored direction of a probe: its `group` rays merged and averaged.
fn castStored(center: vec2f, stored: u32, group: u32) -> Merged {
  let startDir = select(
    dirOf(f32(stored), f32(u.rayCount)),
    dirOf(f32(stored), f32(u.storedDirs)),
    u.preAverage != 0u,
  );
  let start = center + startDir * u.intervalStart;
  let startDistance = startDistanceAt(start);
  var L = vec3f(0.0);
  var T = vec3f(0.0);
  var raw = vec3f(0.0);
  for (var j = 0u; j < group; j++) {
    let m = castMerged(center, i32(stored * group + j), start, startDistance);
    L += m.L;
    T += m.T;
    raw += m.raw;
  }
  let inv = 1.0 / f32(group);
  return Merged(L * inv, T * inv, raw * inv);
}

fn storeEntry(entry: u32, m: Merged) {
  own[entry * 3u] = pack2x16float(m.L.rg);
  own[entry * 3u + 1u] = pack2x16float(vec2f(m.L.b, m.T.r));
  own[entry * 3u + 2u] = pack2x16float(m.T.gb);
}

@compute @workgroup_size(TX * TY * DW, 1, 1)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let lanes = TX * TY * DW;
  let laneProbe = li % (TX * TY);
  let laneDir = li / (TX * TY);
  let lid = vec2u(laneProbe % TX, laneProbe / TX);
  let tileOrigin = vec2i(wg.xy * vec2u(TX, TY));
  let dir0 = wg.z * DW;
  let sceneDims = vec2i(u.sceneSize);

  // Workgroup memory: the scene patch every ray of this tile stays inside.
  patchOrigin = vec2i(floor(vec2f(tileOrigin) * u.probeSpacing - u.halo));
  if (USE_PATCH) {
    let n = PATCH_W * PATCH_H;
    for (var i = li; i < n; i += lanes) {
      let local = vec2i(i32(i % PATCH_W), i32(i / PATCH_W));
      let texel = clamp(patchOrigin + local, vec2i(0), sceneDims - vec2i(1));
      let E = textureLoad(emissionTex, texel, 0).rgb;
      let tau = textureLoad(transmittanceTex, texel, 0).rgb;
      let d = textureLoad(distanceTex, texel, 0).r;
      scenePatch[i] = vec4u(
        pack2x16float(E.rg),
        pack2x16float(vec2f(E.b, tau.r)),
        pack2x16float(tau.gb),
        bitcast<u32>(d),
      );
    }
  }

  // Workgroup memory: the upper probes and directions this tile merges with.
  // A stored direction s of this level reads upper directions
  // [s * G, (s + 1) * G): its G = group * childCount children.
  let group = select(1u, u.branching, u.preAverage != 0u);
  let upperPerDir = u.upperStoredDirs >= u.upperRayCount;
  let G = group * select(1u, u.branching, upperPerDir);
  footDir0 = select(dir0 * G, 0u, REDUCE);
  footOrigin = clamp(
    vec2i(floor((vec2f(tileOrigin) + 0.5) * u.probeSpacing / u.upperSpacing - 0.5)),
    vec2i(0),
    max(vec2i(0), vec2i(u.upperProbeCount) - vec2i(i32(FOOT_X), i32(FOOT_Y))),
  );
  if (USE_FOOT && u.isTop == 0u) {
    let n = FOOT_X * FOOT_Y * FOOT_D;
    for (var i = li; i < n; i += lanes) {
      let dd = i % FOOT_D;
      let rest = i / FOOT_D;
      let q = footOrigin + vec2i(i32(rest % FOOT_X), i32(rest / FOOT_X));
      let upDir = footDir0 + dd;
      if (all(q < vec2i(u.upperProbeCount)) && upDir < u.upperStoredDirs) {
        let src = upperIndex(q, upDir);
        footprint[i * 3u] = upper[src];
        footprint[i * 3u + 1u] = upper[src + 1u];
        footprint[i * 3u + 2u] = upper[src + 2u];
      }
    }
  }
  workgroupBarrier();

  let probe = tileOrigin + vec2i(lid);
  let live = all(probe < vec2i(u.probeCount));
  let probeIndex = u32(probe.y) * u.probeCount.x + u32(probe.x);
  let probes = u.probeCount.x * u.probeCount.y;
  if (!live) {
    return;
  }
  let center = (vec2f(probe) + 0.5) * u.probeSpacing;

  if (REDUCE) {
    // Band membership first: this lane's probe, all its directions.
    var slot = 0u;
    let d = sceneDistance(clamp(vec2i(floor(center)), vec2i(0), sceneDims - vec2i(1)));
    if (d < u.bandWidth) {
      let claimed = atomicAdd(&bandCounter.n, 1u);
      slot = select(0u, claimed + 1u, claimed < u.bandCapacity);
    }
    slotMap[probeIndex] = slot;
    var sum = vec3f(0.0);
    for (var stored = 0u; stored < u.storedDirs; stored++) {
      let m = castStored(center, stored, group);
      sum += m.L;
      let entry = stored * probes + probeIndex;
      if (u.storeDirs != 0u) {
        storeEntry(entry, m);
      }
      if (u.storeRaw != 0u) {
        rawStore[entry * 2u] = pack2x16float(m.raw.rg);
        rawStore[entry * 2u + 1u] = pack2x16float(vec2f(m.raw.b, 0.0));
      }
      if (slot != 0u) {
        let i = ((slot - 1u) * u.storedDirs + stored) * 2u;
        band[i] = pack2x16float(m.L.rg);
        band[i + 1u] = pack2x16float(vec2f(m.L.b, 0.0));
      }
    }
    textureStore(irradianceOut, probe, vec4f(sum / f32(u.storedDirs), 1.0));
    return;
  }

  let stored = dir0 + laneDir;
  if (stored >= u.storedDirs) {
    return;
  }
  let m = castStored(center, stored, group);
  let entry = stored * probes + probeIndex;
  if (u.storeDirs != 0u) {
    storeEntry(entry, m);
  }
  if (u.storeRaw != 0u) {
    rawStore[entry * 2u] = pack2x16float(m.raw.rg);
    rawStore[entry * 2u + 1u] = pack2x16float(vec2f(m.raw.b, 0.0));
  }
}
