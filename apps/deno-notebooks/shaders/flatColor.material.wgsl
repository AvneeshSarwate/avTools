struct FlatColorUniforms {
  color: vec4f,
};

fn vertShader(position: vec2f, _uv: vec2f, _uniforms: FlatColorUniforms) -> vec2f {
  return position;
}

fn fragShader(_uv: vec2f, uniforms: FlatColorUniforms) -> vec4f {
  return uniforms.color;
}
