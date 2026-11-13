export { HELPER_SNIPPETS, toPascalCase, escapeTemplateLiteral } from './utils.ts';
export { readTextFile, writeFileIfChanged } from './codegenIO.ts';
export {
  type GlslArgument,
  type GlslFunction,
  type GlslStructMember,
  type GlslStruct,
  stripComments,
  parseStructs,
  parseFunctions,
} from './parseGlsl.ts';
