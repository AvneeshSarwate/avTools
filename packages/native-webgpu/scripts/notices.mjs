import {seedrandomNotices} from './seedrandom-notices.mjs';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative, dirname } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../..');
const dawn = resolve(root, 'upstream/node-webgpu/third_party/dawn');
const notices = new Map();
notices.set('seedrandom-3.0.5/licenses',seedrandomNotices(root));
async function collect(directory, prefix, depth = 0) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(entry.name)) {
      notices.set(`${prefix}/${entry.name}`, await readFile(resolve(directory, entry.name), 'utf8'));
    } else if (depth > 0 && entry.isDirectory() && !entry.name.startsWith('.')) {
      await collect(resolve(directory, entry.name), `${prefix}/${entry.name}`, depth - 1);
    }
  }
}
await collect(dawn, 'Dawn');
// Include notices from the pinned native dependency checkout, including build-only
// dependencies. Presence in this notice bundle does not imply runtime linkage.
await collect(`${dawn}/third_party`, 'Dawn/third_party', 3);
await collect(`${root}/upstream/syphon`, 'Syphon', 0);
await collect(`${root}/node_modules/earcut`, 'earcut');
const crates = new Set();
for (const manifest of [`${root}/native/rust/Cargo.toml`, `${repo}/apps/deno-notebooks/native/deno_window/Cargo.toml`]) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--offline', '--filter-platform', 'aarch64-apple-darwin',
    '--manifest-path', manifest], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  for (const crate of metadata.packages) {
    if (!crate.source || crates.has(crate.id)) continue;
    crates.add(crate.id);
    await collect(dirname(crate.manifest_path), `Rust/${crate.name}-${crate.version}`, 1);
  }
}
await mkdir(`${root}/dist`, { recursive: true });
await writeFile(`${root}/dist/THIRD_PARTY_NOTICES.txt`, 'Third-party source and binary dependency notices.\nFonts carry their license files in dist/fonts.\n\n' +
  [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => `===== ${path} =====\n${text}\n`).join('\n'));
console.log(`Collected ${notices.size} third-party notices`);
