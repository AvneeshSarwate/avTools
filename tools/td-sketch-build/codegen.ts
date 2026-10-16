import { generateMaterialTypesSource } from '../../packages/power2d-codegen/wgsl/generateMaterialTypesCore_RAW.ts';
import { generateStrokeMaterialTypesSource } from '../../packages/power2d-codegen/wgsl/generateStrokeMaterialTypesCore_RAW.ts';
import { generateFragmentShaderArtifactsSource } from '../../packages/shader-fx-codegen/wgsl/generateFragmentShaderCore_RAW.ts';
import { generateComputeShaderTypesSource } from '../../packages/compute-shader-codegen/wgsl/generateComputeShaderTypesCore_RAW.ts';

export function generate(path: string, source: string): {suffix: string; code: string} | undefined {
  const name = path.split('/').at(-1)!;
  if (name.endsWith('.strokeMaterial.wgsl')) return {suffix: '.strokeMaterial.raw.generated.ts', code: generateStrokeMaterialTypesSource(source, name.replace('.strokeMaterial.wgsl', '')).typesSource};
  if (name.endsWith('.material.wgsl')) return {suffix: '.material.raw.generated.ts', code: generateMaterialTypesSource(source, name.replace('.material.wgsl', '')).typesSource};
  if (name.endsWith('.fragFunc.wgsl')) return {suffix: '.frag.raw.generated.ts', code: generateFragmentShaderArtifactsSource({shaderCode: source, shaderBaseName: name.replace('.fragFunc.wgsl', ''), shaderFxImportPath: '@avtools/shader-fx/raw'}).typesSource};
  if (name.endsWith('.compute.wgsl')) return {suffix: '.compute.raw.generated.ts', code: generateComputeShaderTypesSource({shaderCode: source, shaderFileName: name, shaderStem: name.replace(/\.wgsl$/, '')}).typesSource};
}
