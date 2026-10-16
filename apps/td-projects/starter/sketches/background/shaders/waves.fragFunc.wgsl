struct WavesUniforms {
  time: f32,
  amount: f32,
  color: vec4f,
};
fn pass0(uv: vec2f, uniforms: WavesUniforms, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let base = textureSample(src, srcSampler, uv);
  let wave = 0.5 + 0.5 * sin(uv.x*18.0 + sin(uv.y*12.0 + uniforms.time)*3.0 + uniforms.time);
  return vec4f(mix(base.rgb, uniforms.color.rgb, wave * uniforms.amount), 1.0);
}
