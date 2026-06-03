struct GrainUniforms {
  deviationPixels: f32,
  time: f32,
  frameNumber: f32,
  cellSize: f32,
};

fn hashU32(value: u32) -> u32 {
  var h = value;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn hashCell(cell: vec2u, frame: u32, salt: u32) -> f32 {
  let mixed = cell.x * 0x8da6b343u ^
    cell.y * 0xd8163841u ^
    frame * 0xcb1ab31fu ^
    salt;
  return f32(hashU32(mixed) & 0x00ffffffu) / 16777215.0;
}

fn pass0(uv: vec2f, uniforms: GrainUniforms, src: texture_2d<f32>, srcSampler: sampler) -> vec4f {
  let dims = vec2f(textureDimensions(src, 0));
  let pixel = floor(uv * dims);
  let cellSize = max(uniforms.cellSize, 1.0);
  let grainCell = vec2u(floor(pixel / vec2f(cellSize)));
  let frame = u32(floor(max(uniforms.frameNumber, 0.0))) % 1048576u;
  let jitter = vec2f(
    hashCell(grainCell, frame, 0x9e3779b9u),
    hashCell(grainCell, frame, 0x85ebca6bu)
  ) * 2.0 - vec2f(1.0);
  let samplePixel = clamp(
    pixel + jitter * max(uniforms.deviationPixels, 0.0),
    vec2f(0.5),
    dims - vec2f(0.5)
  );
  let sampleUv = (samplePixel + vec2f(0.5)) / dims;
  return textureSample(src, srcSampler, sampleUv);
}
