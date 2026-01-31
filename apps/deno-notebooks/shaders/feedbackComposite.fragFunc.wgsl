struct FeedbackUniforms {
  translate: vec2f,
  decay: f32,
};

fn pass0(
  uv: vec2f,
  uniforms: FeedbackUniforms,
  src: texture_2d<f32>,
  srcSampler: sampler,
  feedback: texture_2d<f32>,
  feedbackSampler: sampler,
) -> vec4f {
  let current = textureSample(src, srcSampler, uv);
  let prev = textureSample(feedback, feedbackSampler, uv - uniforms.translate);
  let blended = max(current, prev * uniforms.decay);
  return vec4f(blended.rgb, 1.0);
}
