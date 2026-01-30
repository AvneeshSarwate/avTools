struct InstancedSquaresSettings {
  baseX: f32,
  baseY: f32,
  spacing: f32,
  scale: f32,
  gridWidth: u32,
  instanceCount: u32,
};

struct InstancedSolidInstance {
  offset: vec2f,
  scale: f32,
  rotation: f32,
};

@group(0) @binding(0) var<uniform> settings: InstancedSquaresSettings;
@group(0) @binding(1) var<storage, read_write> instanceData: array<InstancedSolidInstance>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= settings.instanceCount) {
    return;
  }

  let row = idx / settings.gridWidth;
  let col = idx % settings.gridWidth;

  let offset = vec2f(
    settings.baseX + f32(col) * settings.spacing,
    settings.baseY + f32(row) * settings.spacing,
  );

  instanceData[idx].offset = offset;
  instanceData[idx].scale = settings.scale;
  instanceData[idx].rotation = 0.0;
}
