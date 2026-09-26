// One cascade level. Direction-major layout: the texture is a grid of
// tiles, tile k holding the whole probe grid for stored direction k.
// Outputs: merged radiance, merged transmittance, and this level's own
// interval radiance before merging (for debugging).

// #include "fullscreen_vertex.wgsl"

struct CascadeUniforms {
  sky: vec4f,
  sceneSize: vec2f,
  probeCount: vec2f,
  upperProbeCount: vec2f,
  probeSpacing: f32,
  upperSpacing: f32,
  rayCount: f32,
  storedDirs: f32,
  upperRayCount: f32,
  upperStoredDirs: f32,
  tileCols: f32,
  upperTileCols: f32,
  intervalStart: f32,
  intervalEnd: f32,
  branching: f32,
  isTop: f32,
  mergeMode: f32,
  preAverage: f32,
  useDistanceField: f32,
  stepSize: f32,
  intervalOverlap: f32,
  maxSteps: f32,
};
@group(0) @binding(0) var<uniform> u: CascadeUniforms;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(3) var distanceTex: texture_2d<f32>;
@group(0) @binding(4) var upperRadiance: texture_2d<f32>;
@group(0) @binding(5) var upperTransmittance: texture_2d<f32>;

// #include "march.wgsl"

fn sceneDistance(texel: vec2i) -> f32 {
  return textureLoad(distanceTex, texel, 0).r;
}

fn sceneMedium(texel: vec2i) -> Medium {
  return Medium(
    textureLoad(emissionTex, texel, 0).rgb,
    textureLoad(transmittanceTex, texel, 0).rgb,
  );
}

fn marchParams() -> MarchParams {
  return MarchParams(u.sceneSize, u.useDistanceField > 0.5, u.stepSize, i32(u.maxSteps));
}

const TAU_F: f32 = 6.283185307179586;

fn dirOf(index: f32, count: f32) -> vec2f {
  let a = TAU_F * (index + 0.5) / count;
  return vec2f(cos(a), sin(a));
}

fn upperTexel(probe: vec2i, stored: i32) -> vec2i {
  let cols = i32(u.upperTileCols);
  let tile = vec2i(stored % cols, stored / cols);
  return tile * vec2i(u.upperProbeCount) + probe;
}

fn upperSample(probe: vec2i, stored: i32) -> Hit {
  let texel = upperTexel(probe, stored);
  return Hit(
    textureLoad(upperRadiance, texel, 0).rgb,
    textureLoad(upperTransmittance, texel, 0).rgb,
  );
}

fn upperProbe(base: vec2i, corner: i32) -> vec2i {
  return clamp(base + vec2i(corner % 2, corner / 2), vec2i(0), vec2i(u.upperProbeCount) - vec2i(1));
}

struct Merged {
  L: vec3f,
  T: vec3f,
  raw: vec3f,
};

// `start` is where this probe's interval begins for direction d: along d
// itself, or, when pre-averaging, along the stored (parent) direction so the
// level below's bilinear-fix rays end exactly where these begin (Yaazarai's
// fork).
fn castMerged(center: vec2f, d: i32, start: vec2f) -> Merged {
  let mp = marchParams();
  let w = dirOf(f32(d), u.rayCount);
  let t0 = u.intervalStart;
  let t1 = u.intervalEnd;
  let overlapEnd = center + w * (t0 + (t1 - t0) * u.intervalOverlap);
  if (u.isTop > 0.5) {
    let hit = march(start, overlapEnd, mp);
    return Merged(hit.L + hit.T * u.sky.rgb, hit.T, hit.L);
  }
  let upos = center / u.upperSpacing - 0.5;
  let base = vec2i(floor(upos));
  let f = fract(upos);
  let weights = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let upperPerDir = u.upperStoredDirs >= u.upperRayCount - 0.5;
  let B = i32(u.branching);
  let childCount = select(1, B, upperPerDir);
  let mode = i32(u.mergeMode);

  if (mode == 1) {
    // Bilinear fix: one ray per upper probe, from this interval's start to
    // the point where that probe's child interval starts, merged with that
    // probe alone; the four merged results are then bilinearly weighted.
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
        let wc = select(w, dirOf(f32(d * B + k), u.upperRayCount), upperPerDir);
        let hit = march(start, qCenter + wc * t1, mp);
        let up = upperSample(q, stored);
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

  let hit = march(start, overlapEnd, mp);
  var upL = vec3f(0.0);
  var upT = vec3f(0.0);
  for (var c = 0; c < 4; c++) {
    let q = upperProbe(base, c);
    if (mode == 2) {
      // Parallax fix (Sannikov's MERGE_FIX 4): seen from the upper probe,
      // this ray's end point lies off the ray's own direction by a parallax
      // angle, so look the upper probe up in that direction, interpolating
      // its two nearest stored directions. When the upper level stores one
      // texel per ray, shift the whole child cone by the angle rather than
      // collapsing it to one direction, so the cone average survives when
      // cascade 0 has few, wide rays.
      let qCenter = (vec2f(q) + 0.5) * u.upperSpacing;
      let v = overlapEnd - qCenter;
      let nominal = TAU_F * (f32(d) + 0.5) / u.rayCount;
      var shift = atan2(v.y, v.x) - nominal;
      shift = shift - floor((shift + 3.14159265) / TAU_F) * TAU_F;
      let stored = u.upperStoredDirs;
      let shiftIndex = shift / TAU_F * stored;
      var Lc = vec3f(0.0);
      var Tc = vec3f(0.0);
      for (var k = 0; k < childCount; k++) {
        var idx = f32(select(d, d * B + k, upperPerDir)) + shiftIndex;
        idx = idx - floor(idx / stored) * stored;
        let i0 = i32(floor(idx)) % i32(stored);
        let i1 = (i0 + 1) % i32(stored);
        let fr = fract(idx);
        let s0 = upperSample(q, i0);
        let s1 = upperSample(q, i1);
        Lc += mix(s0.L, s1.L, fr);
        Tc += mix(s0.T, s1.T, fr);
      }
      upL += weights[c] * Lc / f32(childCount);
      upT += weights[c] * Tc / f32(childCount);
    } else {
      var Lc = vec3f(0.0);
      var Tc = vec3f(0.0);
      for (var k = 0; k < childCount; k++) {
        let s = upperSample(q, select(d, d * B + k, upperPerDir));
        Lc += s.L;
        Tc += s.T;
      }
      upL += weights[c] * Lc / f32(childCount);
      upT += weights[c] * Tc / f32(childCount);
    }
  }
  return Merged(hit.L + hit.T * upL, hit.T * upT, hit.L);
}

struct Out {
  @location(0) radiance: vec4f,
  @location(1) transmittance: vec4f,
  @location(2) raw: vec4f,
};

@fragment
fn fs(@builtin(position) pos: vec4f) -> Out {
  let texel = vec2i(floor(pos.xy));
  let probes = vec2i(u.probeCount);
  let tile = texel / probes;
  let probe = texel - tile * probes;
  let stored = tile.y * i32(u.tileCols) + tile.x;
  var out: Out;
  if (stored >= i32(u.storedDirs)) {
    out.radiance = vec4f(0.0);
    out.transmittance = vec4f(0.0);
    out.raw = vec4f(0.0);
    return out;
  }
  let center = (vec2f(probe) + 0.5) * u.probeSpacing;
  let group = select(1, i32(u.branching), u.preAverage > 0.5);
  let startDir = select(
    dirOf(f32(stored), u.rayCount),
    dirOf(f32(stored), u.storedDirs),
    u.preAverage > 0.5,
  );
  let start = center + startDir * u.intervalStart;
  var L = vec3f(0.0);
  var T = vec3f(0.0);
  var raw = vec3f(0.0);
  for (var j = 0; j < group; j++) {
    let m = castMerged(center, stored * group + j, start);
    L += m.L;
    T += m.T;
    raw += m.raw;
  }
  let inv = 1.0 / f32(group);
  out.radiance = vec4f(L * inv, 1.0);
  out.transmittance = vec4f(T * inv, 1.0);
  out.raw = vec4f(raw * inv, 1.0);
  return out;
}
