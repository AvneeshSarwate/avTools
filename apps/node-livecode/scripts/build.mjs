import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../..');
const config = JSON.parse(await readFile(`${repo}/deno.json`, 'utf8'));
const alias = Object.fromEntries(Object.entries(config.imports)
  .filter(([name, path]) => name.startsWith('@avtools/') && !name.endsWith('/') && path.startsWith('./'))
  .map(([name, path]) => [name, resolve(repo, path)]));
await build({ entryPoints: [`${repo}/packages/livecode-engine/engine.ts`], outfile: `${root}/build/engine.js`,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', alias,
  nodePaths: [`${root}/node_modules`], sourcemap: true });
