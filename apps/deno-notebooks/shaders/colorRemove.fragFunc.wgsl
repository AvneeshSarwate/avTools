struct ColorRemoveUniforms {
  targetR: f32, // 1.0
  targetG: f32, // 1.0
  targetB: f32, // 1.0
  threshold: f32, // 0.3
  feather: f32, // 0.1
};

fn pass0(
  uv: vec2f,
  uniforms: ColorRemoveUniforms,
  src: texture_2d<f32>,
  srcSampler: sampler,
) -> vec4f {
  let color = textureSample(src, srcSampler, uv);
  let targetColor = vec3f(uniforms.targetR, uniforms.targetG, uniforms.targetB);
  let dist = distance(color.rgb, targetColor);
  let mask = smoothstep(uniforms.threshold - uniforms.feather, uniforms.threshold + uniforms.feather, dist);
  return vec4f(color.rgb * mask, color.a * mask);
}
