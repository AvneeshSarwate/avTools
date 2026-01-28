import {
  WGSL_MATERIAL_SUFFIX,
  WGSL_MATERIAL_OUTPUT_SUFFIX,
  WGSL_STROKE_SUFFIX,
  WGSL_STROKE_OUTPUT_SUFFIX,
  generateMaterialTypesSource,
  generateStrokeMaterialTypesSource,
} from "@avtools/power2d-codegen";
import { dirname, join } from "jsr:@std/path@1";

export interface WatchConfig {
  srcDir: string;
  outputDir: string;
  quiet?: boolean;
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

function resolveOutputPath(filePath: string, config: WatchConfig, suffix: string): string {
  const relative = filePath.startsWith(config.srcDir)
    ? filePath.slice(config.srcDir.length + 1)
    : filePath;
  return join(config.outputDir, `${relative}${suffix}`).replace(/\\/g, "/");
}

async function processMaterial(filePath: string, config: WatchConfig): Promise<void> {
  const shaderCode = await Deno.readTextFile(filePath);
  const shaderBaseName = filePath.split("/").pop()?.replace(WGSL_MATERIAL_SUFFIX, "") ?? "Material";
  const output = generateMaterialTypesSource(shaderCode, shaderBaseName).typesSource;
  const outputPath = resolveOutputPath(filePath, config, WGSL_MATERIAL_OUTPUT_SUFFIX);
  await Deno.mkdir(dirname(outputPath), { recursive: true });
  const updated = await writeFileIfChanged(outputPath, output);
  log(config.quiet, `${updated ? "Updated" : "Unchanged"} ${outputPath}`);
}

async function processStrokeMaterial(filePath: string, config: WatchConfig): Promise<void> {
  const shaderCode = await Deno.readTextFile(filePath);
  const shaderBaseName = filePath.split("/").pop()?.replace(WGSL_STROKE_SUFFIX, "") ?? "StrokeMaterial";
  const output = generateStrokeMaterialTypesSource(shaderCode, shaderBaseName).typesSource;
  const outputPath = resolveOutputPath(filePath, config, WGSL_STROKE_OUTPUT_SUFFIX);
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
      if (path.endsWith(WGSL_MATERIAL_SUFFIX)) {
        await processMaterial(path, normalizedConfig);
      } else if (path.endsWith(WGSL_STROKE_SUFFIX)) {
        await processStrokeMaterial(path, normalizedConfig);
      }
    }
  }
}

if (import.meta.main) {
  const [srcDir = "src", outputDir = "../../packages/power2d/generated"] = Deno.args;
  await watchShaders({ srcDir, outputDir });
}
