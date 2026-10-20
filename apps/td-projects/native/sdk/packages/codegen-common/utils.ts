/**
 * Shared codegen utilities used by power2d-codegen and shader-fx-codegen.
 */

/**
 * Code snippets emitted into generated files for Babylon.js vector/matrix conversions.
 * Generators select only the helpers actually needed by each shader.
 */
export const HELPER_SNIPPETS: Record<string, string> = {
  ensureVector2: `function ensureVector2(value: BABYLON.Vector2 | readonly [number, number]): BABYLON.Vector2 {\n  return value instanceof BABYLON.Vector2 ? value : BABYLON.Vector2.FromArray(value as readonly [number, number]);\n}`,
  ensureVector3: `function ensureVector3(value: BABYLON.Vector3 | readonly [number, number, number]): BABYLON.Vector3 {\n  return value instanceof BABYLON.Vector3 ? value : BABYLON.Vector3.FromArray(value as readonly [number, number, number]);\n}`,
  ensureVector4: `function ensureVector4(value: BABYLON.Vector4 | readonly [number, number, number, number]): BABYLON.Vector4 {\n  return value instanceof BABYLON.Vector4 ? value : BABYLON.Vector4.FromArray(value as readonly [number, number, number, number]);\n}`,
  ensureMatrix: `function ensureMatrix(value: BABYLON.Matrix | Float32Array | readonly number[]): BABYLON.Matrix {\n  if (value instanceof BABYLON.Matrix) {\n    return value;\n  }\n  const matrix = BABYLON.Matrix.Identity();\n  matrix.copyFromArray(Array.from(value));\n  return matrix;\n}`,
};

export function toPascalCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function escapeTemplateLiteral(value: string): string {
  return `\`${value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')}\``;
}
