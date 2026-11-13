fn pass0(uv: vec2f, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let dims = vec2i(textureDimensions(src, 0));
  let coord = clamp(vec2i(uv * vec2f(dims)), vec2i(0), dims - vec2i(1));
  let color = textureLoad(src, coord, 0);
  let alpha = select(0.0, 1.0, color.a > 0.0);
  return vec4f(color.rgb, alpha);
}
