export {
  RAW_SUFFIX as WGSL_MATERIAL_SUFFIX,
  OUTPUT_SUFFIX as WGSL_MATERIAL_OUTPUT_SUFFIX,
  generateMaterialTypesSource,
} from "./wgsl/generateMaterialTypesCore.ts";

export {
  RAW_SUFFIX as WGSL_STROKE_SUFFIX,
  OUTPUT_SUFFIX as WGSL_STROKE_OUTPUT_SUFFIX,
  generateStrokeMaterialTypesSource,
} from "./wgsl/generateStrokeMaterialTypesCore.ts";

export {
  RAW_SUFFIX as WGSL_COMPUTE_SUFFIX,
  DEFAULT_COMPUTE_OUTPUT_SUFFIX as WGSL_COMPUTE_DEFAULT_SUFFIX,
  generateComputeShaderTypesSource,
} from "./wgsl/generateComputeShaderTypesCore.ts";

export {
  RAW_SUFFIX as GLSL_MATERIAL_SUFFIX,
  OUTPUT_SUFFIX as GLSL_MATERIAL_OUTPUT_SUFFIX,
  generateMaterialTypesSource as generateMaterialTypesSource_GL,
} from "./glsl/generateMaterialTypesCore_GL.ts";

export {
  RAW_SUFFIX as GLSL_STROKE_SUFFIX,
  OUTPUT_SUFFIX as GLSL_STROKE_OUTPUT_SUFFIX,
  generateStrokeMaterialTypesSource as generateStrokeMaterialTypesSource_GL,
} from "./glsl/generateStrokeMaterialTypesCore_GL.ts";

export { readTextFile, writeFileIfChanged } from "../codegen-common/codegenIO.ts";
