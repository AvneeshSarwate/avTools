export interface ProjectConfig {
  /** Paths relative to this config file. Each entry produces outDir/name.js. */
  sketches: Record<string, string | {entry: string; target: 'chop'; /** Match the TD Output Channels parameter; used by native check. */ outputs: string[]; /** Match TD Output Samples (default 1). */ samples?: number}>;
  /** Project-local source trees containing WGSL. Default: ["sketches"]. */
  shaderDirs?: string[];
  generatedDir?: string;
  outDir?: string;
  /** TypeScript project to check before publishing bundles. */
  tsconfig?: string;
}
