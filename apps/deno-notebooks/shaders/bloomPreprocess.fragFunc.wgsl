struct BloomPreprocessUniforms {
  blackLevel: f32, // 0.05
  brightness: f32, // 2.0
  threshold: f32, // 0.12
  knee: f32, // 0.5
};

fn pass0(
  uv: vec2f,
  uniforms: BloomPreprocessUniforms,
  src: texture_2d<f32>,
  srcSampler: sampler,
) -> vec4f {
  let color = textureSample(src, srcSampler, uv);

  // Subtract black level and boost brightness
  let isolated = max(color.rgb - vec3f(uniforms.blackLevel), vec3f(0.0)) * uniforms.brightness;

  // Soft knee threshold based on luminance
  let lum = dot(isolated, vec3f(0.2126, 0.7152, 0.0722));
  let t = uniforms.threshold;
  let k = t * uniforms.knee;
  let softEdge = smoothstep(t - k, t + k, lum);
  let bright = isolated * softEdge;

  return vec4f(bright, 1.0);
}
