export {
  RAW_SUFFIX as WGSL_MATERIAL_SUFFIX,
  OUTPUT_SUFFIX as WGSL_MATERIAL_OUTPUT_SUFFIX,
  generateMaterialTypesSource,
} from "./wgsl/generateMaterialTypesCore.ts";
export {
  RAW_SUFFIX as WGSL_MATERIAL_RAW_SUFFIX,
  OUTPUT_SUFFIX as WGSL_MATERIAL_RAW_OUTPUT_SUFFIX,
  generateMaterialTypesSource as generateMaterialTypesSource_RAW,
} from "./wgsl/generateMaterialTypesCore_RAW.ts";

export {
  RAW_SUFFIX as WGSL_STROKE_SUFFIX,
  OUTPUT_SUFFIX as WGSL_STROKE_OUTPUT_SUFFIX,
  generateStrokeMaterialTypesSource,
} from "./wgsl/generateStrokeMaterialTypesCore.ts";
export {
  RAW_SUFFIX as WGSL_STROKE_RAW_SUFFIX,
  OUTPUT_SUFFIX as WGSL_STROKE_RAW_OUTPUT_SUFFIX,
  generateStrokeMaterialTypesSource as generateStrokeMaterialTypesSource_RAW,
} from "./wgsl/generateStrokeMaterialTypesCore_RAW.ts";

export {
  WGSL_COMPUTE_SUFFIX,
  WGSL_COMPUTE_DEFAULT_SUFFIX,
  WGSL_COMPUTE_RAW_SUFFIX,
  WGSL_COMPUTE_RAW_OUTPUT_SUFFIX,
  generateComputeShaderTypesSource,
  generateComputeShaderTypesSource_RAW,
} from "../compute-shader-codegen/mod.ts";

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
