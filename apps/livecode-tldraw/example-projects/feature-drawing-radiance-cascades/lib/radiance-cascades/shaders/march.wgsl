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
