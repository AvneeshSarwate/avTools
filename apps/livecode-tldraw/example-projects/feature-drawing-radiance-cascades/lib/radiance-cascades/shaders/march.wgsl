// Shared ray march. The including shader supplies the scene accessors
//   fn sceneDistance(texel: vec2i) -> f32      signed distance to the nearest outline
//   fn sceneMedium(texel: vec2i) -> Medium     emission and transmittance
// (the fragment programs read the scene textures directly; the compute
// cascade reads a workgroup-memory patch when the ray stays inside it) and
// `marchParams()`. Sphere-traces the distance field between outlines and
// integrates emission/transmittance per pixel of travel inside them. The
// emission of a step is E * (1 - tau^ds) / (1 - tau): the full E at an opaque
// hit whatever the step, E * ds through clear media.

struct MarchParams {
  sceneSize: vec2f,
  useDistanceField: bool,
  stepSize: f32,
  maxSteps: i32,
};
struct Hit {
  L: vec3f,
  T: vec3f,
};
struct Medium {
  E: vec3f,
  tau: vec3f,
};

fn inBounds(p: vec2f, size: vec2f) -> bool {
  return all(p >= vec2f(0.0)) && all(p < size);
}

// `originDistance` is the distance field at `origin` when the caller has it
// (every ray of a probe starts at the same point), or a negative number.
fn march(origin: vec2f, to: vec2f, mp: MarchParams, originDistance: f32) -> Hit {
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  let delta = to - origin;
  let len = length(delta);
  if (len <= 0.0) {
    return Hit(L, T);
  }
  let dir = delta / len;
  // Clip the ray to the scene once instead of testing every step: a sample
  // at t is inside the scene exactly when t < tExit (and t >= 0 from the
  // origin, which is then inside too).
  var tExit = len;
  if (!inBounds(origin, mp.sceneSize)) {
    return Hit(L, T);
  }
  let invDir = 1.0 / dir;
  let toMin = (vec2f(0.0) - origin) * invDir;
  let toMax = (mp.sceneSize - origin) * invDir;
  let far = max(toMin, toMax);
  // A zero direction component gives an infinite exit on that axis.
  tExit = min(tExit, min(select(far.x, 1e30, dir.x == 0.0), select(far.y, 1e30, dir.y == 0.0)));
  var t = 0.0;
  // The first step's distance is known when the caller loaded it.
  if (mp.useDistanceField && originDistance > 0.5) {
    t = originDistance;
  }
  for (var i = 0; i < mp.maxSteps; i++) {
    if (t >= tExit) { break; }
    let p = origin + dir * t;
    let texel = vec2i(floor(p));
    if (mp.useDistanceField) {
      let d = sceneDistance(texel);
      if (d > 0.5) {
        t += max(d, 0.5);
        continue;
      }
    }
    let ds = min(mp.stepSize, len - t);
    let m = sceneMedium(texel);
    let tau = clamp(m.tau, vec3f(0.0), vec3f(1.0));
    if (ds == 1.0) {
      // A whole pixel: tau^1 is tau and the emission factor is exactly 1,
      // for clear and absorbing media alike.
      L += T * m.E;
      T *= tau;
    } else {
      let tauDs = pow(tau, vec3f(ds));
      let clear = tau > vec3f(0.999);
      let emitFactor = select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
      L += T * m.E * emitFactor;
      T *= tauDs;
    }
    if (max(T.r, max(T.g, T.b)) < 0.002) {
      T = vec3f(0.0);
      break;
    }
    t += ds;
  }
  return Hit(L, T);
}

/// The free-space prefix shared by rays from one origin: while the free
/// sphere at a point of the mean ray still covers every ray (their unit
/// directions are within `spread`, a chord length, of `meanDir`), advance
/// all of them at once. Nothing accumulates in free space, so a ray marching
/// on from its point at `t` gets what it would have marching from the
/// origin, with a fraction of the dependent distance loads.
struct Bundle {
  t: f32,
  /// A lower bound on the distance field at every ray's point at `t`.
  originDistance: f32,
};

fn marchBundle(origin: vec2f, meanDir: vec2f, spread: f32, maxT: f32, mp: MarchParams, originDistance: f32) -> Bundle {
  if (!mp.useDistanceField || maxT <= 0.0 || !inBounds(origin, mp.sceneSize)) {
    return Bundle(0.0, originDistance);
  }
  var t = 0.0;
  var d = originDistance;
  for (var i = 0; i < mp.maxSteps; i++) {
    let c = origin + meanDir * t;
    if (i > 0 || d < 0.0) {
      if (!inBounds(c, mp.sceneSize)) {
        return Bundle(t, -1.0);
      }
      d = sceneDistance(vec2i(floor(c)));
    }
    // Every ray's point at t is within t * spread of c.
    let bound = d - t * spread;
    if (bound <= 0.5) {
      return Bundle(t, bound);
    }
    // Points at t' <= t + step stay inside the sphere of radius d at c:
    // t' * spread + (t' - t) < d.
    let step = bound / (1.0 + spread);
    if (t + step >= maxT) {
      return Bundle(maxT, -1.0);
    }
    t += step;
  }
  return Bundle(t, -1.0);
}

/// Four rays from one origin marched in lockstep: each iteration advances
/// every unfinished ray one step, so a lane has up to four independent
/// distance loads in flight instead of a serial chain. Same result as four
/// `march` calls.
struct Hit4 {
  L0: vec3f, T0: vec3f,
  L1: vec3f, T1: vec3f,
  L2: vec3f, T2: vec3f,
  L3: vec3f, T3: vec3f,
};

fn rayExit(origin: vec2f, dir: vec2f, len: f32, size: vec2f) -> f32 {
  let invDir = 1.0 / dir;
  let far = max((vec2f(0.0) - origin) * invDir, (size - origin) * invDir);
  return min(len, min(select(far.x, 1e30, dir.x == 0.0), select(far.y, 1e30, dir.y == 0.0)));
}

fn march4(origin: vec2f, to0: vec2f, to1: vec2f, to2: vec2f, to3: vec2f, mp: MarchParams, originDistance: f32) -> Hit4 {
  var out = Hit4(
    vec3f(0.0), vec3f(1.0), vec3f(0.0), vec3f(1.0),
    vec3f(0.0), vec3f(1.0), vec3f(0.0), vec3f(1.0),
  );
  if (!inBounds(origin, mp.sceneSize)) {
    return out;
  }
  let d0 = to0 - origin;
  let d1 = to1 - origin;
  let d2 = to2 - origin;
  let d3 = to3 - origin;
  let len = vec4f(length(d0), length(d1), length(d2), length(d3));
  let dir0 = d0 / max(len.x, 1e-6);
  let dir1 = d1 / max(len.y, 1e-6);
  let dir2 = d2 / max(len.z, 1e-6);
  let dir3 = d3 / max(len.w, 1e-6);
  let tExit = vec4f(
    rayExit(origin, dir0, len.x, mp.sceneSize),
    rayExit(origin, dir1, len.y, mp.sceneSize),
    rayExit(origin, dir2, len.z, mp.sceneSize),
    rayExit(origin, dir3, len.w, mp.sceneSize),
  );
  var t = vec4f(0.0);
  if (mp.useDistanceField && originDistance > 0.5) {
    t = vec4f(originDistance);
  }
  // A ray is done once t >= tExit or its transmittance is gone.
  var done = t >= tExit;
  for (var i = 0; i < mp.maxSteps; i++) {
    if (all(done)) { break; }
    let p0 = origin + dir0 * t.x;
    let p1 = origin + dir1 * t.y;
    let p2 = origin + dir2 * t.z;
    let p3 = origin + dir3 * t.w;
    let x0 = vec2i(floor(p0));
    let x1 = vec2i(floor(p1));
    let x2 = vec2i(floor(p2));
    let x3 = vec2i(floor(p3));
    // The four loads are independent: issue them together.
    var dist = vec4f(0.0);
    if (mp.useDistanceField) {
      dist = vec4f(
        select(0.0, sceneDistance(x0), !done.x),
        select(0.0, sceneDistance(x1), !done.y),
        select(0.0, sceneDistance(x2), !done.z),
        select(0.0, sceneDistance(x3), !done.w),
      );
    }
    let skip = dist > vec4f(0.5);
    // Ray 0.
    if (!done.x) {
      if (skip.x) { t.x += max(dist.x, 0.5); }
      else {
        let ds = min(mp.stepSize, len.x - t.x);
        let m = sceneMedium(x0);
        let tau = clamp(m.tau, vec3f(0.0), vec3f(1.0));
        if (ds == 1.0) { out.L0 += out.T0 * m.E; out.T0 *= tau; }
        else {
          let tauDs = pow(tau, vec3f(ds));
          let clear = tau > vec3f(0.999);
          out.L0 += out.T0 * m.E * select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
          out.T0 *= tauDs;
        }
        if (max(out.T0.r, max(out.T0.g, out.T0.b)) < 0.002) { out.T0 = vec3f(0.0); done.x = true; }
        t.x += ds;
      }
      done.x = done.x || t.x >= tExit.x;
    }
    // Ray 1.
    if (!done.y) {
      if (skip.y) { t.y += max(dist.y, 0.5); }
      else {
        let ds = min(mp.stepSize, len.y - t.y);
        let m = sceneMedium(x1);
        let tau = clamp(m.tau, vec3f(0.0), vec3f(1.0));
        if (ds == 1.0) { out.L1 += out.T1 * m.E; out.T1 *= tau; }
        else {
          let tauDs = pow(tau, vec3f(ds));
          let clear = tau > vec3f(0.999);
          out.L1 += out.T1 * m.E * select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
          out.T1 *= tauDs;
        }
        if (max(out.T1.r, max(out.T1.g, out.T1.b)) < 0.002) { out.T1 = vec3f(0.0); done.y = true; }
        t.y += ds;
      }
      done.y = done.y || t.y >= tExit.y;
    }
    // Ray 2.
    if (!done.z) {
      if (skip.z) { t.z += max(dist.z, 0.5); }
      else {
        let ds = min(mp.stepSize, len.z - t.z);
        let m = sceneMedium(x2);
        let tau = clamp(m.tau, vec3f(0.0), vec3f(1.0));
        if (ds == 1.0) { out.L2 += out.T2 * m.E; out.T2 *= tau; }
        else {
          let tauDs = pow(tau, vec3f(ds));
          let clear = tau > vec3f(0.999);
          out.L2 += out.T2 * m.E * select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
          out.T2 *= tauDs;
        }
        if (max(out.T2.r, max(out.T2.g, out.T2.b)) < 0.002) { out.T2 = vec3f(0.0); done.z = true; }
        t.z += ds;
      }
      done.z = done.z || t.z >= tExit.z;
    }
    // Ray 3.
    if (!done.w) {
      if (skip.w) { t.w += max(dist.w, 0.5); }
      else {
        let ds = min(mp.stepSize, len.w - t.w);
        let m = sceneMedium(x3);
        let tau = clamp(m.tau, vec3f(0.0), vec3f(1.0));
        if (ds == 1.0) { out.L3 += out.T3 * m.E; out.T3 *= tau; }
        else {
          let tauDs = pow(tau, vec3f(ds));
          let clear = tau > vec3f(0.999);
          out.L3 += out.T3 * m.E * select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
          out.T3 *= tauDs;
        }
        if (max(out.T3.r, max(out.T3.g, out.T3.b)) < 0.002) { out.T3 = vec3f(0.0); done.w = true; }
        t.w += ds;
      }
      done.w = done.w || t.w >= tExit.w;
    }
  }
  return out;
}
