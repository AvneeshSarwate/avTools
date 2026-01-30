export {
  RAW_SUFFIX as WGSL_FRAG_SUFFIX,
  TYPES_SUFFIX as WGSL_FRAG_TYPES_SUFFIX,
  generateFragmentShaderArtifactsSource,
  buildFragmentShaderErrorArtifactSource,
  getFragmentShaderNaming,
} from './wgsl/generateFragmentShaderCore.ts';

export {
  RAW_SUFFIX as WGSL_FRAG_RAW_SUFFIX,
  TYPES_SUFFIX as WGSL_FRAG_RAW_TYPES_SUFFIX,
  generateFragmentShaderArtifactsSource as generateFragmentShaderArtifactsSource_RAW,
  buildFragmentShaderErrorArtifactSource as buildFragmentShaderErrorArtifactSource_RAW,
  getFragmentShaderNaming as getFragmentShaderNaming_RAW,
} from './wgsl/generateFragmentShaderCore_RAW.ts';

export {
  RAW_SUFFIX as GLSL_FRAG_SUFFIX,
  TYPES_SUFFIX as GLSL_FRAG_TYPES_SUFFIX,
  generateFragmentShaderArtifactsSource as generateFragmentShaderArtifactsSource_GL,
} from './glsl/generateFragmentShaderCore_GL.ts';
