export {
  RAW_SUFFIX as WGSL_COMPUTE_SUFFIX,
  DEFAULT_COMPUTE_OUTPUT_SUFFIX as WGSL_COMPUTE_DEFAULT_SUFFIX,
  generateComputeShaderTypesSource,
} from './wgsl/generateComputeShaderTypesCore.ts';

export {
  RAW_SUFFIX as WGSL_COMPUTE_RAW_SUFFIX,
  RAW_OUTPUT_SUFFIX as WGSL_COMPUTE_RAW_OUTPUT_SUFFIX,
  generateComputeShaderTypesSource as generateComputeShaderTypesSource_RAW,
} from './wgsl/generateComputeShaderTypesCore_RAW.ts';
