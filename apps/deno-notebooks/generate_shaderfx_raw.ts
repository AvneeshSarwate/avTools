import {
  WGSL_FRAG_RAW_SUFFIX,
  WGSL_FRAG_RAW_TYPES_SUFFIX,
  generateFragmentShaderArtifactsSource_RAW,
  buildFragmentShaderErrorArtifactSource_RAW,
  getFragmentShaderNaming_RAW,
} from "@avtools/shader-fx-codegen";
import { dirname, join } from "jsr:@std/path@1";

const [srcDir = "./shaders", outputDir = "../../packages/shader-fx/generated-raw"] = Deno.args;

async function writeFileIfChanged(path: string, content: string): Promise<boolean> {
  try {
    const existing = await Deno.readTextFile(path);
    if (existing === content) return false;
  } catch {
    // File doesn't exist or unreadable; we'll write.
  }
  await Deno.mkdir(dirname(path), { recursive: true }).catch(() => {});
  await Deno.writeTextFile(path, content);
  return true;
}

let count = 0;
for await (const entry of Deno.readDir(srcDir)) {
  if (!entry.isFile || !entry.name.endsWith(WGSL_FRAG_RAW_SUFFIX)) continue;

  const filePath = join(srcDir, entry.name);
  const shaderBaseName = entry.name.replace(WGSL_FRAG_RAW_SUFFIX, "");
  const outputPath = join(outputDir, `shaders/${shaderBaseName}${WGSL_FRAG_RAW_TYPES_SUFFIX}`);

  const shaderCode = await Deno.readTextFile(filePath);
  let output: string;
  try {
    output = generateFragmentShaderArtifactsSource_RAW({
      shaderCode,
      shaderBaseName,
      shaderFxImportPath: "@avtools/shader-fx/raw",
    }).typesSource;
  } catch (error) {
    const naming = getFragmentShaderNaming_RAW(shaderBaseName);
    const message = error instanceof Error ? error.message : String(error);
    output = buildFragmentShaderErrorArtifactSource_RAW({
      effectClassName: naming.effectClassName,
      uniformInterfaceName: naming.defaultUniformInterfaceName,
      shaderPrefix: naming.shaderPrefix,
      relativeSourcePath: entry.name,
      errorMessage: message,
    });
    console.error(`Error processing ${entry.name}: ${message}`);
  }

  await Deno.mkdir(dirname(outputPath), { recursive: true }).catch(() => {});
  const updated = await writeFileIfChanged(outputPath, output);
  console.log(`${updated ? "Updated" : "Unchanged"} ${outputPath}`);
  count++;
}

console.log(`Processed ${count} shader(s)`);
