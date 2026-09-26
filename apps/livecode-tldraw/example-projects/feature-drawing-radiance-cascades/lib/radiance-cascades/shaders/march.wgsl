// Shared ray march. Bindings 1..3 must be the scene emission, transmittance
// and distance textures; the including shader supplies \`marchParams()\`.
// Sphere-traces the distance field between outlines and integrates
// emission/transmittance per pixel of travel inside them. The emission of a
// step is E * (1 - tau^ds) / (1 - tau): the full E at an opaque hit whatever
// the step, E * ds through clear media.

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

fn inBounds(p: vec2f, size: vec2f) -> bool {
  return all(p >= vec2f(0.0)) && all(p < size);
}

fn march(origin: vec2f, to: vec2f, mp: MarchParams) -> Hit {
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  let delta = to - origin;
  let len = length(delta);
  if (len <= 0.0) {
    return Hit(L, T);
  }
  let dir = delta / len;
  var t = 0.0;
  for (var i = 0; i < mp.maxSteps; i++) {
    if (t >= len) { break; }
    let p = origin + dir * t;
    if (!inBounds(p, mp.sceneSize)) { break; }
    let texel = vec2i(floor(p));
    if (mp.useDistanceField) {
      let d = textureLoad(distanceTex, texel, 0).r;
      if (d > 0.5) {
        t += max(d, 0.5);
        continue;
      }
    }
    let ds = min(mp.stepSize, len - t);
    let tau = clamp(textureLoad(transmittanceTex, texel, 0).rgb, vec3f(0.0), vec3f(1.0));
    let E = textureLoad(emissionTex, texel, 0).rgb;
    let tauDs = pow(tau, vec3f(ds));
    let clear = tau > vec3f(0.999);
    let emitFactor = select((vec3f(1.0) - tauDs) / max(vec3f(1.0) - tau, vec3f(1e-4)), vec3f(ds), clear);
    L += T * E * emitFactor;
    T *= tauDs;
    if (max(T.r, max(T.g, T.b)) < 0.002) {
      T = vec3f(0.0);
      break;
    }
    t += ds;
  }
  return Hit(L, T);
}
