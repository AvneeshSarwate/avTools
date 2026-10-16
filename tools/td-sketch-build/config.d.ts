export interface ProjectConfig {
  /** Paths relative to this config file. Each entry produces outDir/name.js. */
  sketches: Record<string, string>;
  /** Project-local source trees containing WGSL. Default: ["sketches"]. */
  shaderDirs?: string[];
  generatedDir?: string;
  outDir?: string;
  /** TypeScript project to check before publishing bundles. */
  tsconfig?: string;
}
