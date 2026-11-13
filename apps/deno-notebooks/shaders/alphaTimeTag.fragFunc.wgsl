struct AlphaTimeTagUniforms {
  drawTime: f32,
  alphaThreshold: f32,
  recencyPeriod: f32,
};

const RECENCY_TAG_EPSILON: f32 = 0.00048828125;

fn pass0(uv: vec2f, uniforms: AlphaTimeTagUniforms, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let dims = vec2i(textureDimensions(src, 0));
  let coord = clamp(vec2i(uv * vec2f(dims)), vec2i(0), dims - vec2i(1));
  let color = textureLoad(src, coord, 0);
  let period = max(0.001, uniforms.recencyPeriod);
  let recencyPhase = fract(uniforms.drawTime / period);
  let encodedRecency = RECENCY_TAG_EPSILON + recencyPhase * (1.0 - RECENCY_TAG_EPSILON);
  let alphaTime = select(0.0, encodedRecency, color.a > uniforms.alphaThreshold);
  return vec4f(color.rgb, alphaTime);
}
