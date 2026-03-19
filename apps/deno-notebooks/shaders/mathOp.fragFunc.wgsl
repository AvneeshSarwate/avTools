struct MathOpUniforms {
  mult: f32,
};

fn pass0(uv: vec2f, uniforms: MathOpUniforms, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let color = textureSample(src, srcSampler, uv);
  return color * uniforms.mult;
}
