struct GrainUniforms {
  amount: f32,
  time: f32,
  frameNumber: f32,
};

fn hash12(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn pass0(uv: vec2f, uniforms: GrainUniforms, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let dims = vec2f(textureDimensions(src, 0));
  let pixel = floor(uv * dims);
  let n = hash12(pixel + vec2f(uniforms.frameNumber * 17.0, uniforms.time * 59.0));
  let grain = (n - 0.5) * uniforms.amount;
  let color = textureSample(src, srcSampler, uv);
  return vec4f(clamp(color.rgb + vec3f(grain), vec3f(0.0), vec3f(1.0)), color.a);
}
