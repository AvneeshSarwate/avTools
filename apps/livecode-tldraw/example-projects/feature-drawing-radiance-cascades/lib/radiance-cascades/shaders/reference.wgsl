// #include "fullscreen_vertex.wgsl"

struct ReferenceUniforms {
  sky: vec4f,
  sceneSize: vec2f,
  rays: f32,
  maxDistance: f32,
  useDistanceField: f32,
  stepSize: f32,
  maxSteps: f32,
  pad: f32,
};
@group(0) @binding(0) var<uniform> u: ReferenceUniforms;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(3) var distanceTex: texture_2d<f32>;

// #include "march.wgsl"

const TAU_F: f32 = 6.283185307179586;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mp = MarchParams(u.sceneSize, u.useDistanceField > 0.5, u.stepSize, i32(u.maxSteps));
  let rays = i32(u.rays);
  var sum = vec3f(0.0);
  for (var k = 0; k < rays; k++) {
    let a = TAU_F * (f32(k) + 0.5) / u.rays;
    let w = vec2f(cos(a), sin(a));
    let hit = march(pos.xy, pos.xy + w * u.maxDistance, mp);
    sum += hit.L + hit.T * u.sky.rgb;
  }
  return vec4f(sum / u.rays, 1.0);
}
