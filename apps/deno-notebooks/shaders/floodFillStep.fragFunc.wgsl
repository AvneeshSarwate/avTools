struct FloodFillStepUniforms {
  diskRadius: f32,
  useDisk: f32,
};

fn pass0(uv: vec2f, uniforms: FloodFillStepUniforms, seed: texture_2d<f32>, seedSampler: sampler, feedback: texture_2d<f32>, feedbackSampler: sampler) -> vec4f {
  let seedDims = vec2i(textureDimensions(seed, 0));
  let feedbackDims = vec2i(textureDimensions(feedback, 0));
  let seedCoord = clamp(vec2i(uv * vec2f(seedDims)), vec2i(0), seedDims - vec2i(1));
  let feedbackCoord = clamp(vec2i(uv * vec2f(feedbackDims)), vec2i(0), feedbackDims - vec2i(1));

  let seedColor = textureLoad(seed, seedCoord, 0);
  let feedbackColor = textureLoad(feedback, feedbackCoord, 0);

  var recentColor = vec4f(-1.0, -1.0, -1.0, -1.0);

  let useDisk = uniforms.useDisk > 0.5;
  let r = select(1, i32(max(1.0, uniforms.diskRadius)), useDisk);
  let rSq = uniforms.diskRadius * uniforms.diskRadius;

  for (var y = -r; y <= r; y = y + 1) {
    for (var x = -r; x <= r; x = x + 1) {
      if (useDisk) {
        let d = f32(x * x + y * y);
        if (d > rSq) { continue; }
      }
      let neighborCoord = clamp(feedbackCoord + vec2i(x, y), vec2i(0), feedbackDims - vec2i(1));
      let candidate = textureLoad(feedback, neighborCoord, 0);
      if (candidate.a > recentColor.a) {
        recentColor = candidate;
      }
    }
  }

  var chosenFeedback = recentColor;
  if (feedbackColor.a == recentColor.a) {
    chosenFeedback = feedbackColor;
  }

  if (seedColor.a > 0.0) {
    return seedColor;
  }

  return chosenFeedback;
}
