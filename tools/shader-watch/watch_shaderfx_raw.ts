import {
  WGSL_FRAG_RAW_SUFFIX,
  WGSL_FRAG_RAW_TYPES_SUFFIX,
  generateFragmentShaderArtifactsSource_RAW,
  buildFragmentShaderErrorArtifactSource_RAW,
  getFragmentShaderNaming_RAW,
} from "@avtools/shader-fx-codegen";
import { dirname, join } from "jsr:@std/path@1";

export interface WatchConfig {
  srcDir: string;
  outputDir: string;
  quiet?: boolean;
  shaderFxImportPath?: string;
}

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

function log(quiet: boolean | undefined, message: string): void {
  if (!quiet) console.log(message);
}

function resolveOutputPath(filePath: string, config: WatchConfig, inputSuffix: string, outputSuffix: string): string {
  const relative = filePath.startsWith(config.srcDir)
    ? filePath.slice(config.srcDir.length + 1)
    : filePath;
  const normalized = relative.replace(/\\/g, "/");
  if (!normalized.endsWith(inputSuffix)) {
    return join(config.outputDir, `${normalized}${outputSuffix}`).replace(/\\/g, "/");
  }
  const base = normalized.slice(0, -inputSuffix.length);
  return join(config.outputDir, `${base}${outputSuffix}`).replace(/\\/g, "/");
}

async function processFragment(filePath: string, config: WatchConfig): Promise<void> {
  const shaderCode = await Deno.readTextFile(filePath);
  const shaderBaseName = filePath.split("/").pop()?.replace(WGSL_FRAG_RAW_SUFFIX, "") ?? "Shader";
  const outputPath = resolveOutputPath(filePath, config, WGSL_FRAG_RAW_SUFFIX, WGSL_FRAG_RAW_TYPES_SUFFIX);
  const shaderFxImportPath = config.shaderFxImportPath ?? "@avtools/shader-fx/raw";

  let output: string;
  try {
    output = generateFragmentShaderArtifactsSource_RAW({
      shaderCode,
      shaderBaseName,
      shaderFxImportPath,
    }).typesSource;
  } catch (error) {
    const naming = getFragmentShaderNaming_RAW(shaderBaseName);
    const relativeSourcePath = filePath.startsWith(config.srcDir)
      ? filePath.slice(config.srcDir.length + 1)
      : filePath;
    const message = error instanceof Error ? error.message : String(error);
    output = buildFragmentShaderErrorArtifactSource_RAW({
      effectClassName: naming.effectClassName,
      uniformInterfaceName: naming.defaultUniformInterfaceName,
      shaderPrefix: naming.shaderPrefix,
      relativeSourcePath,
      errorMessage: message,
    });
  }

  await Deno.mkdir(dirname(outputPath), { recursive: true });
  const updated = await writeFileIfChanged(outputPath, output);
  log(config.quiet, `${updated ? "Updated" : "Unchanged"} ${outputPath}`);
}

export async function watchShaders(config: WatchConfig): Promise<void> {
  const srcDir = config.srcDir.replace(/\\/g, "/");
  const outputDir = config.outputDir.replace(/\\/g, "/");
  const normalizedConfig = { ...config, srcDir, outputDir };

  log(config.quiet, `Watching ${srcDir} → ${outputDir}`);

  for await (const event of Deno.watchFs(srcDir)) {
    if (event.kind === "access") continue;
    for (const path of event.paths) {
      if (path.endsWith(WGSL_FRAG_RAW_SUFFIX)) {
        await processFragment(path, normalizedConfig);
      }
    }
  }
}

if (import.meta.main) {
  const [srcDir = "src", outputDir = "../../packages/shader-fx/generated-raw"] = Deno.args;
  await watchShaders({ srcDir, outputDir });
}
