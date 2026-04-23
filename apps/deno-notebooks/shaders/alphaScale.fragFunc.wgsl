struct AlphaScaleUniforms {
  opacity: f32, // 1.0
};

fn pass0(
  uv: vec2f,
  uniforms: AlphaScaleUniforms,
  src: texture_2d<f32>,
  srcSampler: sampler,
) -> vec4f {
  let color = textureSample(src, srcSampler, uv);
  return vec4f(color.rgb, color.a * uniforms.opacity);
}
