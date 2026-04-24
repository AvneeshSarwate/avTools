struct FloodFillStepUniforms {
  diskRadius: f32,
  useDisk: f32,
  skipDistance: f32,
  currentPhase: f32,
};

const RECENCY_TAG_EPSILON: f32 = 0.00048828125;

fn decodeRecencyTag(tag: f32) -> f32 {
  return clamp((tag - RECENCY_TAG_EPSILON) / (1.0 - RECENCY_TAG_EPSILON), 0.0, 1.0);
}

fn wrappedAge(currentPhase: f32, tag: f32) -> f32 {
  let candidatePhase = decodeRecencyTag(tag);
  return fract(currentPhase - candidatePhase + 1.0);
}

fn pass0(uv: vec2f, uniforms: FloodFillStepUniforms, seed: texture_2d<f32>, seedSampler: sampler, feedback: texture_2d<f32>, feedbackSampler: sampler) -> vec4f {
  let seedDims = vec2i(textureDimensions(seed, 0));
  let feedbackDims = vec2i(textureDimensions(feedback, 0));
  let seedCoord = clamp(vec2i(uv * vec2f(seedDims)), vec2i(0), seedDims - vec2i(1));
  let feedbackCoord = clamp(vec2i(uv * vec2f(feedbackDims)), vec2i(0), feedbackDims - vec2i(1));

  let seedColor = textureLoad(seed, seedCoord, 0);
  let feedbackColor = textureLoad(feedback, feedbackCoord, 0);

  var chosenFeedback = feedbackColor;
  var bestAge = select(2.0, wrappedAge(uniforms.currentPhase, feedbackColor.a), feedbackColor.a > 0.0);

  let useDisk = uniforms.useDisk > 0.5;
  let r = select(1, i32(max(1.0, uniforms.diskRadius)), useDisk);
  let rSq = uniforms.diskRadius * uniforms.diskRadius;
  let stride = i32(max(0.0, uniforms.skipDistance)) + 1;

  for (var y = -r; y <= r; y = y + 1) {
    for (var x = -r; x <= r; x = x + 1) {
      if (useDisk) {
        let d = f32(x * x + y * y);
        if (d > rSq) { continue; }
      }
      let neighborCoord = clamp(
        feedbackCoord + vec2i(x, y) * stride,
        vec2i(0),
        feedbackDims - vec2i(1),
      );
      let candidate = textureLoad(feedback, neighborCoord, 0);
      if (candidate.a <= 0.0) {
        continue;
      }
      let candidateAge = wrappedAge(uniforms.currentPhase, candidate.a);
      if (candidateAge < bestAge) {
        bestAge = candidateAge;
        chosenFeedback = candidate;
      }
    }
  }

  if (seedColor.a > 0.0) {
    return seedColor;
  }

  return chosenFeedback;
}
