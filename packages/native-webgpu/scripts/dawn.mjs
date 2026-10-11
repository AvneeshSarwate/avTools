import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, delimiter } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'native-manifest.json'), 'utf8'));
const upstream = resolve(root, 'upstream/node-webgpu');
const dawn = resolve(upstream, 'third_party/dawn');
const depot = resolve(upstream, 'third_party/depot_tools');
const run = (cmd, args, cwd = root, env = process.env) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
const output = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const step = process.argv[2] ?? 'build';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Only darwin-arm64 is validated');
if (step === 'fetch') {
  mkdirSync(resolve(root, 'upstream'), { recursive: true });
  if (!existsSync(upstream)) run('git', ['clone', '--branch', manifest.nodeWebgpuTag, '--depth', '1',
    'https://github.com/dawn-gpu/node-webgpu.git', upstream]);
  if (output('git', ['rev-parse', 'HEAD'], upstream) !== manifest.nodeWebgpu) throw new Error('Unexpected node-webgpu checkout');
  run('git', ['submodule', 'update', '--init', '--depth', '1'], upstream);
  copyFileSync(resolve(dawn, 'scripts/standalone-with-node.gclient'), resolve(dawn, '.gclient'));
  // CMake needs source/CIPD dependencies, not Chromium's Xcode provisioning hooks.
  run(resolve(depot, 'gclient'), ['sync', '--no-history', '--shallow', '--nohooks'], dawn,
    { ...process.env, DEPOT_TOOLS_UPDATE: '0', PATH: depot + delimiter + process.env.PATH });
} else {
  if (output('git', ['rev-parse', 'HEAD'], dawn) !== manifest.dawn) throw new Error('Unexpected Dawn revision');
  if (step === 'patch') {
    for (const patch of manifest.patches) {
      const path = resolve(root, 'patches', patch);
      try { execFileSync('git', ['apply', '--reverse', '--check', path], { cwd: dawn, stdio: 'pipe' }); }
      catch { run('git', ['apply', '--check', path], dawn); run('git', ['apply', path], dawn); }
    }
  } else if (step === 'build') {
    const sdk = output('xcrun', ['--show-sdk-path']);
    const extension = process.argv.includes('--extension');
    const repo = resolve(root, '../..');
    if (extension) run(process.execPath, ['scripts/syphon.mjs', 'build']);
    if (extension) run('cargo', ['build', '--release', '--locked', '--manifest-path',
      `${repo}/apps/deno-notebooks/native/deno_window/Cargo.toml`]);
    run('cmake', ['-S', dawn, '-B', 'build/dawn', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_OSX_ARCHITECTURES=arm64', `-DCMAKE_OSX_SYSROOT=${sdk}`,
      // The installed CLT compiler omits the SDK's libc++ include directory.
      `-DCMAKE_CXX_FLAGS=-isystem ${sdk}/usr/include/c++/v1`,
      `-DCMAKE_OBJCXX_FLAGS=-isystem ${sdk}/usr/include/c++/v1`,
      '-DCMAKE_CXX_VISIBILITY_PRESET=hidden', '-DCMAKE_VISIBILITY_INLINES_HIDDEN=1',
      '-DDAWN_BUILD_NODE_BINDINGS=ON', '-DDAWN_BUILD_SAMPLES=OFF', '-DDAWN_BUILD_TESTS=OFF',
      '-DTINT_BUILD_TESTS=OFF', '-DTINT_BUILD_CMD_TOOLS=OFF', '-DDAWN_ENABLE_INSTALL=OFF',
      '-DDAWN_BUILD_MONOLITHIC_LIBRARY=OFF', '-DDAWN_USE_X11=OFF', '-DDAWN_USE_WAYLAND=OFF',
      `-DGO_EXECUTABLE=${dawn}/tools/golang/mac-arm64/bin/go`,
      `-DAVTOOLS_NATIVE_DIR=${extension ? resolve(root, 'native') : ''}`,
      `-DAVTOOLS_WINDOW_LIBRARY=${repo}/apps/deno-notebooks/native/deno_window/target/release/libdeno_window.a`]);
    run('cmake', ['--build', 'build/dawn', '--target', 'dawn_node', '-j', process.env.AVTOOLS_BUILD_JOBS ?? '8']);
  } else throw new Error('Usage: node scripts/dawn.mjs fetch|patch|build');
}
