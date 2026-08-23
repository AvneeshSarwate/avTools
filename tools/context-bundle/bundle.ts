/**
 * Concatenate the livecode project's source into a single file sized for one
 * LLM call, and report how many tokens that file is.
 *
 * File selection comes from `git ls-files`, so untracked scratch files, build
 * output, and `node_modules` are structurally excluded rather than filtered.
 * Roots default to the livecode scope named in `docs/livecode/README.md`.
 *
 * Usage:
 *   deno task bundle                        # source only -> livecode-bundle.txt
 *   deno task bundle --tests --docs         # add tests and docs/livecode
 *   deno task bundle --all --out ctx.txt
 *   deno task bundle --list                 # print the selection, write nothing
 *   deno task bundle --out -                # bundle to stdout, report to stderr
 *
 * Flags:
 *   --tests            include tests, e2e specs, and test helpers
 *   --examples         include example-project modules and fixtures
 *   --docs             include Markdown (docs/livecode plus in-tree *.md)
 *   --config           include json/jsonc/yaml/toml config
 *   --all              all of the above
 *   --strip-comments   drop blank lines and whole-line comments (approximate)
 *   --roots=a,b        override the default roots
 *   --out=PATH         output path, or "-" for stdout
 *   --list             report the selection without writing a bundle
 */

import { basename, extname, join } from "jsr:@std/path@1";

const DEFAULT_ROOTS = [
  "apps/livecode-tldraw",
  "apps/deno-notebooks/livecode",
  "packages/livecode-protocol",
  "packages/livecode-engine",
  "packages/core-timing",
  "docs/livecode",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html"]);
const CONFIG_EXTENSIONS = new Set([".json", ".jsonc", ".yml", ".yaml", ".toml"]);

/** Generated or vendored files that carry no signal worth the tokens. */
const SKIPPED_NAMES = new Set(["package-lock.json", "deno.lock", "yarn.lock", "pnpm-lock.yaml"]);

const FILE_DELIMITER = "=".repeat(8);

export type Category = "source" | "test" | "example" | "doc" | "config" | "skipped";

export interface BundleOptions {
  roots: string[];
  categories: Set<Category>;
  stripComments: boolean;
}

export interface BundleFile {
  path: string;
  category: Category;
  content: string;
  lines: number;
}

export interface BundleResult {
  text: string;
  files: BundleFile[];
}

function isTest(path: string): boolean {
  const name = basename(path);
  return (
    path.includes("/tests/") ||
    path.includes("/fixtures/") ||
    name.endsWith("_test.ts") ||
    name.endsWith(".test.ts") ||
    name.endsWith(".e2e.mjs") ||
    name === "timing_tests.ts" ||
    name === "verify-feature-projects.ts"
  );
}

export function categorize(path: string): Category {
  const name = basename(path);
  const extension = extname(path).toLowerCase();
  if (SKIPPED_NAMES.has(name)) return "skipped";
  if (extension === ".md") return "doc";
  const isSource = SOURCE_EXTENSIONS.has(extension);
  const isConfig = CONFIG_EXTENSIONS.has(extension);
  if (!isSource && !isConfig) return "skipped";
  if (isTest(path)) return "test";
  if (path.includes("/example-projects/")) return "example";
  return isConfig ? "config" : "source";
}

/** Repository root, so the bundle is identical from any working directory. */
async function repoRoot(): Promise<string> {
  const command = new Deno.Command("git", { args: ["rev-parse", "--show-toplevel"], stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`git rev-parse failed: ${new TextDecoder().decode(stderr).trim()}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

async function trackedFiles(root: string, roots: string[]): Promise<string[]> {
  const command = new Deno.Command("git", {
    args: ["ls-files", "-z", "--", ...roots],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`git ls-files failed: ${new TextDecoder().decode(stderr).trim()}`);
  }
  return new TextDecoder().decode(stdout).split("\0").filter((entry) => entry.length > 0);
}

async function headCommit(root: string): Promise<string> {
  try {
    const command = new Deno.Command("git", { args: ["rev-parse", "--short", "HEAD"], cwd: root, stdout: "piped" });
    const { code, stdout } = await command.output();
    if (code !== 0) return "unknown";
    return new TextDecoder().decode(stdout).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Line-level comment stripping. It only removes lines that *begin* a comment,
 * so trailing comments survive and no string or template literal is corrupted.
 * A `//`-looking line inside a template literal would be dropped incorrectly;
 * this is a token-saving convenience, not a parser.
 */
function stripComments(content: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const trailingNewline = content.endsWith("\n") ? 1 : 0;
  return content.split("\n").length - trailingNewline;
}

export async function collect(options: BundleOptions): Promise<BundleFile[]> {
  const root = await repoRoot();
  const paths = await trackedFiles(root, options.roots);
  const files: BundleFile[] = [];
  for (const path of paths) {
    const category = categorize(path);
    if (!options.categories.has(category)) continue;
    let content = await Deno.readTextFile(join(root, path));
    if (options.stripComments && category !== "doc") content = stripComments(content);
    files.push({ path, category, content, lines: countLines(content) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function buildBundle(options: BundleOptions): Promise<BundleResult> {
  const files = await collect(options);
  const commit = await headCommit(await repoRoot());
  const parts: string[] = [];

  parts.push("# livecode project bundle");
  parts.push("");
  parts.push(`Repository commit: ${commit}`);
  parts.push(`Roots: ${options.roots.join(", ")}`);
  parts.push(`Included categories: ${[...options.categories].sort().join(", ")}`);
  if (options.stripComments) parts.push("Blank lines and whole-line comments were stripped.");
  parts.push("");
  parts.push(
    `Each file below is introduced by a line of the form ` +
      `\`${FILE_DELIMITER} FILE: <path> (<n> lines) ${FILE_DELIMITER}\`. ` +
      `Everything between one such line and the next belongs to that file.`,
  );
  parts.push("");
  parts.push("## Manifest");
  parts.push("");
  for (const file of files) {
    parts.push(`- ${file.path} (${file.category}, ${file.lines} lines)`);
  }
  parts.push("");

  for (const file of files) {
    if (file.content.includes(`${FILE_DELIMITER} FILE:`)) {
      console.error(`warning: ${file.path} contains the file delimiter; the bundle may be ambiguous`);
    }
    parts.push(`${FILE_DELIMITER} FILE: ${file.path} (${file.lines} lines) ${FILE_DELIMITER}`);
    parts.push(file.content.endsWith("\n") ? file.content.slice(0, -1) : file.content);
    parts.push("");
  }

  return { text: parts.join("\n"), files };
}

export interface TokenCounts {
  [encoding: string]: number;
}

/**
 * Token counts from the real BPE vocabularies. `js-tiktoken` ships the rank
 * tables in the package, so this needs the npm cache but not live network.
 * Returns null when the tokenizer cannot be loaded, so a bundle still gets
 * written on an offline machine.
 */
async function countTokens(text: string): Promise<TokenCounts | null> {
  try {
    const { Tiktoken } = await import("npm:js-tiktoken@1.0.21/lite");
    const o200k = (await import("npm:js-tiktoken@1.0.21/ranks/o200k_base")).default;
    const cl100k = (await import("npm:js-tiktoken@1.0.21/ranks/cl100k_base")).default;
    return {
      o200k_base: new Tiktoken(o200k).encode(text).length,
      cl100k_base: new Tiktoken(cl100k).encode(text).length,
    };
  } catch (error) {
    console.error(`warning: token counting unavailable (${error instanceof Error ? error.message : error})`);
    return null;
  }
}

function parseArgs(args: string[]): { options: BundleOptions; out: string; list: boolean } {
  const categories = new Set<Category>(["source"]);
  let roots = DEFAULT_ROOTS;
  let out = "livecode-bundle.txt";
  let list = false;
  let stripComments = false;

  for (const arg of args) {
    if (arg === "--all") {
      for (const category of ["source", "test", "example", "doc", "config"] as const) categories.add(category);
    } else if (arg === "--tests") categories.add("test");
    else if (arg === "--examples") categories.add("example");
    else if (arg === "--docs") categories.add("doc");
    else if (arg === "--config") categories.add("config");
    else if (arg === "--strip-comments") stripComments = true;
    else if (arg === "--list") list = true;
    else if (arg.startsWith("--roots=")) roots = arg.slice("--roots=".length).split(",").filter(Boolean);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else {
      console.error(`unknown argument: ${arg}`);
      Deno.exit(2);
    }
  }

  return { options: { roots, categories, stripComments }, out, list };
}

function summarize(files: BundleFile[]): void {
  const byCategory = new Map<Category, { files: number; lines: number; bytes: number }>();
  for (const file of files) {
    const entry = byCategory.get(file.category) ?? { files: 0, lines: 0, bytes: 0 };
    entry.files += 1;
    entry.lines += file.lines;
    entry.bytes += new TextEncoder().encode(file.content).length;
    byCategory.set(file.category, entry);
  }
  console.error("");
  console.error("category      files    lines       KB");
  for (const [category, entry] of [...byCategory].sort()) {
    console.error(
      `${category.padEnd(12)}${String(entry.files).padStart(6)}${String(entry.lines).padStart(9)}` +
        `${(entry.bytes / 1024).toFixed(0).padStart(9)}`,
    );
  }
}

if (import.meta.main) {
  const { options, out, list } = parseArgs(Deno.args);
  const { text, files } = await buildBundle(options);

  if (list) {
    for (const file of files) console.log(`${file.category.padEnd(8)} ${file.path}`);
    summarize(files);
    Deno.exit(0);
  }

  if (out === "-") {
    console.log(text);
  } else {
    await Deno.writeTextFile(out, text);
    console.error(`wrote ${out}`);
  }

  summarize(files);
  const bytes = new TextEncoder().encode(text).length;
  console.error("");
  console.error(`bundle: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
  const tokens = await countTokens(text);
  if (tokens) {
    for (const [encoding, count] of Object.entries(tokens)) {
      console.error(`  ${encoding.padEnd(12)} ${count.toLocaleString()} tokens`);
    }
  }
}
