struct InstancedSolidUniforms {
  color: vec4f,
};

struct InstancedSolidInstance {
  offset: vec2f,
  scale: f32,
  rotation: f32,
};

fn vertShader(
  position: vec2f,
  _uv: vec2f,
  _uniforms: InstancedSolidUniforms,
  inst: InstancedSolidInstance,
) -> vec2f {
  let c = cos(inst.rotation);
  let s = sin(inst.rotation);
  let rotated = vec2f(
    position.x * c - position.y * s,
    position.x * s + position.y * c,
  );
  return inst.offset + rotated * inst.scale;
}

fn fragShader(
  _uv: vec2f,
  uniforms: InstancedSolidUniforms,
  _inst: InstancedSolidInstance,
) -> vec4f {
  return uniforms.color;
}
