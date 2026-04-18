struct CompositeUniforms {
  mode: u32, // 0
  opacity: f32, // 1.0
};

fn blendAdd(base: vec3f, blend: vec3f) -> vec3f {
  return min(base + blend, vec3f(1.0));
}

fn blendScreen(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

fn blendMultiply(base: vec3f, blend: vec3f) -> vec3f {
  return base * blend;
}

fn blendOverlay(base: vec3f, blend: vec3f) -> vec3f {
  let lo = 2.0 * base * blend;
  let hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return select(hi, lo, base < vec3f(0.5));
}

fn pass0(
  uv: vec2f,
  uniforms: CompositeUniforms,
  src1: texture_2d<f32>,
  src1Sampler: sampler,
  src2: texture_2d<f32>,
  src2Sampler: sampler,
) -> vec4f {
  let base = textureSample(src1, src1Sampler, uv);
  let blend = textureSample(src2, src2Sampler, uv);

  var result: vec3f;
  switch uniforms.mode {
    case 1u: { result = blendScreen(base.rgb, blend.rgb); }
    case 2u: { result = blendMultiply(base.rgb, blend.rgb); }
    case 3u: { result = blendOverlay(base.rgb, blend.rgb); }
    default: { result = blendAdd(base.rgb, blend.rgb); }
  }

  let blendStrength = uniforms.opacity * blend.a;
  let mixed = mix(base.rgb, result, blendStrength);
  let outAlpha = max(base.a, blendStrength);
  return vec4f(mixed, outAlpha);
}
