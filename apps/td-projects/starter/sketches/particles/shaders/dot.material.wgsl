struct DotUniforms {
  color: vec4f,
};
fn vertShader(position: vec2f, _uv: vec2f, _uniforms: DotUniforms) -> vec2f {
  return position;
}
fn fragShader(_uv: vec2f, uniforms: DotUniforms) -> vec4f {
  return uniforms.color;
}
