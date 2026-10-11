import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../..');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Currently validated for macOS arm64 only');
run('cargo', ['build', '--release', '--locked', '--manifest-path', `${repo}/apps/deno-notebooks/native/text_engine/Cargo.toml`]);
const headers = resolve(dirname(process.execPath), '../include/node');
const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
run('cmake', ['-S', 'native', '-B', 'build/text', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_SYSROOT=${sdk}`,
  `-DCMAKE_CXX_FLAGS=-isystem ${sdk}/usr/include/c++/v1`,
  `-DNODE_INCLUDE_DIR=${headers}`,
  `-DTEXT_ENGINE_LIBRARY=${repo}/apps/deno-notebooks/native/text_engine/target/release/libtext_engine.a`]);
run('cmake', ['--build', 'build/text']);
const nativeDir = resolve(root, 'dist/native/darwin-arm64');
await mkdir(nativeDir, { recursive: true });
await cp(resolve(root, 'build/text/avtools_text.node'), `${nativeDir}/avtools_text.node`);
await cp(resolve(root, 'build/dawn/dawn.node'), `${nativeDir}/dawn.node`);
await rm(`${nativeDir}/Syphon.framework`, { recursive: true, force: true });
await cp(`${root}/build/syphon/Syphon.framework`, `${nativeDir}/Syphon.framework`, { recursive: true, verbatimSymlinks: true });
await cp(`${repo}/apps/deno-notebooks/assets/fonts`, resolve(root, 'dist/fonts'), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/index.ts')], outfile: resolve(root, 'dist/index.js'),
  bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: true,
  external: ['webgpu'], nodePaths: [resolve(root, 'node_modules')] });
await build({ entryPoints: [resolve(root, 'test/scenes.ts')], outfile: resolve(root, 'build/scenes.js'),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022' });
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);

run(process.execPath, ['scripts/notices.mjs']);
