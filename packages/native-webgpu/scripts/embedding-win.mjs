// Windows x64 counterpart of scripts/embedding.mjs: stage the embedded runtime into
// the pinned Dawn tree and build one self-contained DLL per TD operator.
// Invoked by scripts/embedding.mjs on Windows (same commands as macOS):
//   node scripts/embedding.mjs fetch   pinned node-webgpu/Dawn/V8 + Chromium clang
//   node scripts/embedding.mjs         stage + build the runtime probe
// Direct use: node scripts/embedding-win.mjs [fetch|stage|build] [--jobs N] [--targets a,b]
//   stage: patches, libuv, Rust staticlib, staged sources, args.gn, gn gen
//   build: stage + ninja (default target: embedded-probe; the operator DLLs are
//          built by scripts/build-td-plugin.mjs, which embeds their resources)
// Prerequisites (developer machine only): VS 2026 Build Tools (C++ workload),
// Windows SDK 10.0.28000, Rust (rustup), Node 22, git.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,realpathSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 only; use scripts/embedding.mjs on macOS');
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'native-manifest.json'), 'utf8'));
const step = ['fetch', 'stage', 'build'].includes(process.argv[2]) ? process.argv[2] : 'build';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const jobs = arg('--jobs', process.env.AVTOOLS_BUILD_JOBS ?? '3');
const targets = arg('--targets', 'avtools/embedded:embedded-probe').split(',');
// Upstream lives at a short real path (MAX_PATH); packages/native-webgpu/upstream is a junction to it.
const upstreamLink = resolve(root, 'upstream');
const upstreamDir = process.env.AVTOOLS_UPSTREAM_DIR ?? 'C:\\src\\avtools-upstream';

const vs = process.env.vs2026_install ?? 'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools';
const cmake = resolve(vs, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
const tdInstall = process.env.TOUCHDESIGNER_INSTALL ?? 'C:\\Program Files\\Derivative\\TouchDesigner';
const depotGuess = resolve(existsSync(upstreamLink) ? upstreamLink : upstreamDir, 'node-webgpu/third_party/depot_tools');
const env = {...process.env, DEPOT_TOOLS_WIN_TOOLCHAIN: '0', DEPOT_TOOLS_UPDATE: '0', vs2026_install: vs,
  PATH: depotGuess + ';' + process.env.PATH,
  // Never let a system-wide core.autocrlf rewrite checked-out upstream sources.
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.longpaths', GIT_CONFIG_VALUE_1: 'true'};
const run = (cmd, args, cwd = root, input) => execFileSync(cmd, args, {cwd, env, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], input});
const out = (cmd, args, cwd = root) => execFileSync(cmd, args, {cwd, env, encoding: 'utf8'}).trim();
// Windows' own curl/tar (bsdtar), not Git Bash's GNU tools that may precede them on PATH.
const systemTool = name => resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
const gnPath = path => '/' + realpathSync(path).replaceAll('\\', '/');  // GN system-absolute path


if (step === 'fetch') {
  mkdirSync(upstreamDir, {recursive: true});
  if (!existsSync(upstreamLink)) run('cmd.exe', ['/c', 'mklink', '/J', upstreamLink, upstreamDir]);
  const upstream = resolve(upstreamLink, 'node-webgpu');
  if (!existsSync(upstream)) run('git', ['clone', '--branch', manifest.nodeWebgpuTag, '--depth', '1', 'https://github.com/dawn-gpu/node-webgpu.git', upstream]);
  if (out('git', ['rev-parse', 'HEAD'], upstream) !== manifest.nodeWebgpu) throw new Error('Unexpected node-webgpu checkout');
  run('git', ['submodule', 'update', '--init', '--depth', '1'], upstream);
  const fetchedDawn = realpathSync(resolve(upstream, 'third_party/dawn'));
  if (out('git', ['rev-parse', 'HEAD'], fetchedDawn) !== manifest.dawn) throw new Error('Unexpected Dawn revision');
  if (out('git', ['rev-parse', 'HEAD'], resolve(upstream, 'third_party/depot_tools')) !== manifest.depotTools) throw new Error('Unexpected depot_tools revision');
  writeFileSync(resolve(fetchedDawn, '.gclient'), readFileSync(resolve(fetchedDawn, 'scripts/standalone-with-node.gclient'), 'utf8')
    .replace('"dawn_node": True,', '"dawn_node": True,\n            "checkout_v8": True,'));
  // With DEPOT_TOOLS_UPDATE=0 depot_tools never bootstraps its git/python wrappers itself.
  run('cmd.exe', ['/c', resolve(depotGuess, 'bootstrap/win_tools.bat')], fetchedDawn);
  run('cmd.exe', ['/c', 'gclient.bat', 'sync', '--no-history', '--shallow', '--nohooks'], fetchedDawn);
  // The hooks a standalone Windows build needs (sync ran with --nohooks, as on macOS).
  run('cmd.exe', ['/c', 'vpython3.bat', 'tools/clang/scripts/update.py', '--package=clang'], fetchedDawn);
  run('cmd.exe', ['/c', 'vpython3.bat', 'third_party/depot_tools/download_from_google_storage.py', '--no_resume', '--bucket', 'chromium-browser-clang/rc', '-s', 'build/toolchain/win/rc/win/rc.exe.sha1'], fetchedDawn);
  run('cmd.exe', ['/c', 'vpython3.bat', 'build/util/lastchange.py', '-o', 'build/util/LASTCHANGE'], fetchedDawn);
  process.exit(0);
}

const dawn = realpathSync(resolve(upstreamLink, 'node-webgpu/third_party/dawn'));

// 1. Pins.
if (out('git', ['rev-parse', 'HEAD'], dawn) !== manifest.dawn) throw new Error('Unexpected Dawn revision');
if (out('git', ['rev-parse', 'HEAD'], resolve(dawn, 'third_party/v8/src')) !== manifest.embedding.v8) throw new Error('Fetch the pinned V8 dependencies first');
if (out('git', ['rev-parse', 'HEAD'], resolve(dawn, 'build')) !== manifest.embedding.chromiumBuild) throw new Error('Unexpected Chromium build configuration revision');

// 2. Dawn binding patches (same set and order as macOS: dawn.mjs patch, then
// embedding.mjs). Strip CR: a Windows checkout may store .patch files as CRLF.
const patchText = name => readFileSync(resolve(root, 'patches', name), 'utf8').replaceAll('\r\n', '\n');
const applied = name => { try { execFileSync('git', ['apply', '--reverse', '--check', '-'], {cwd: dawn, env, input: patchText(name), stdio: ['pipe', 'pipe', 'pipe']}); return true; } catch { return false; } };
const chain = [...manifest.patches, '0003-napi-v8-callback-lifetime.patch', '0004-embedded-event-driven-wait.patch', '0005-embedded-timer-deadlines.patch', '0006-embedded-environment-retirement.patch'];
// Later patches overlap earlier ones; if the last is applied, the chain is complete.
// On a fresh checkout apply the whole chain in order (as macOS does).
if (!applied(chain.at(-1))) for (const name of chain) run('git', ['apply', '-'], dawn, patchText(name));
// Windows-only, after the shared chain: explicit unwrapped state for constructed
// objects. Pointer compression (required on Windows) exposed napi_v8 reading an
// unset internal field. Correct on macOS too; not yet applied there.
const windowsPatches = ['0007-napi-v8-construct-wrap-state.patch'];
for (const name of windowsPatches) if (!applied(name)) run('git', ['apply', '-'], dawn, patchText(name));

// 3. libuv: pinned, checksummed, static, static CRT (/MT). C only: no C++ ABI.
const uvBase = resolve(root, 'build/libuv-win'), uvSource = resolve(uvBase, `libuv-v${manifest.libuv.version}`), uvOut = resolve(uvBase, 'out');
mkdirSync(uvBase, {recursive: true});
const uvArchive = resolve(uvBase, 'source.tar.gz');
if (!existsSync(uvArchive)) run(systemTool('curl.exe'), ['-fL', `https://dist.libuv.org/dist/v${manifest.libuv.version}/libuv-v${manifest.libuv.version}.tar.gz`, '-o', uvArchive]);
if (createHash('sha256').update(readFileSync(uvArchive)).digest('hex') !== manifest.libuv.sha256) throw new Error('libuv archive checksum mismatch');
if (!existsSync(uvSource)) run(systemTool('tar.exe'), ['-xzf', uvArchive, '-C', uvBase]);
run(cmake, ['-S', uvSource, '-B', uvOut, '-G', 'Visual Studio 18 2026', '-A', 'x64', '-DLIBUV_BUILD_SHARED=OFF', '-DLIBUV_BUILD_TESTS=OFF', '-DLIBUV_BUILD_BENCH=OFF', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW']);
run(cmake, ['--build', uvOut, '--config', 'Release', '--target', 'uv_a', '--', '/m:2']);
const uvLibrary = resolve(uvOut, 'Release/libuv.lib');
if (!existsSync(uvLibrary)) throw new Error('libuv static library not found at ' + uvLibrary);

// 4. One Rust staticlib (TypeScript compiler + MIDI + text), static CRT.
const rustDir = resolve(root, 'native/rust-windows');
run('cargo', ['build', '--release', '-j', jobs, '--manifest-path', resolve(rustDir, 'Cargo.toml')], rustDir);
const rustLibrary = resolve(rustDir, 'target/release/avtools_windows_native.lib');

// 5. Stage embedded sources (as on macOS) and fill BUILD.gn placeholders.
const target = resolve(dawn, 'avtools/embedded'); mkdirSync(target, {recursive: true});
cpSync(resolve(root, 'native/embedded'), target, {recursive: true});
writeFileSync(resolve(target, 'Polyfills.h'), 'static const char* kPolyfills = R"AVTOOLS(' + readFileSync(resolve(root, 'native/embedded/polyfills.js'), 'utf8') + ')AVTOOLS";\n');
for (const name of ['text_addon.cpp', 'text_engine.h']) cpSync(resolve(root, 'native', name), resolve(target, name));
const stagedGN = resolve(target, 'BUILD.gn');
writeFileSync(stagedGN, readFileSync(stagedGN, 'utf8')
  .replaceAll('@LIBUV_INCLUDE@', gnPath(resolve(uvSource, 'include')))
  .replaceAll('@LIBUV_LIBRARY@', gnPath(uvLibrary))
  .replaceAll('@RUST_WINDOWS_LIBRARY@', gnPath(rustLibrary))
  .replaceAll('@TD_SOURCE_DIR@', gnPath(resolve(root, 'native/td')))
  .replaceAll('@TD_TOP_HEADERS@', gnPath(resolve(tdInstall, 'Samples/CPlusPlus/CPUMemoryTOP')))
  .replaceAll('@TD_CHOP_HEADERS@', gnPath(resolve(tdInstall, 'Samples/CPlusPlus/CHOP'))));
const top = resolve(dawn, 'BUILD.gn'); const gn = readFileSync(top, 'utf8');
if (!gn.includes('group("avtools_embedding")')) writeFileSync(top, gn + '\n# avTools embedding integration, sources staged from packages/native-webgpu/native/embedded.\ngroup("avtools_embedding") { deps = [ "//avtools/embedded:embedded-probe" ] }\n');

// 6. Configure. Mirrors the macOS embedding args; D3D12 + Vulkan, no built DXC
// (FXC fallback via the Windows system d3dcompiler_47.dll keeps the DLL self-contained).
const build = resolve(dawn, 'out/avtools-win'); mkdirSync(build, {recursive: true});
writeFileSync(resolve(build, 'args.gn'), `# Generated by packages/native-webgpu/scripts/embedding-win.mjs
is_debug = false
is_component_build = false
target_cpu = "x64"
symbol_level = 0
use_allocator_shim = false
use_partition_alloc_as_malloc = false
clang_use_chrome_plugins = false
use_custom_libcxx = true
treat_warnings_as_errors = false
dawn_use_swiftshader = false
dawn_enable_null = false
dawn_enable_opengles = false
dawn_enable_desktop_gl = false
dawn_enable_webgpu_on_webgpu = false
dawn_enable_d3d11 = false
dawn_enable_d3d12 = true
dawn_enable_vulkan = true
dawn_use_built_dxc = false
# Load system components (vulkan-1.dll, d3d12/dxgi, FXC d3dcompiler_47.dll) from
# System32 only. Without this Dawn's bare-name fallback uses LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
# which Windows rejects (error 87), so Vulkan never loads; it also prevents picking up
# a stray copy beside TouchDesigner.exe.
dawn_force_system_component_load = true
v8_monolithic = true
v8_monolithic_for_shared_library = true
v8_enable_i18n_support = false
v8_use_external_startup_data = false
# Windows: this V8 revision miscompiles layouts with compression off (JSAtomicsMutex
# Torque/C++ offset mismatch under the MSVC ABI); Chrome's tested Windows config is on.
# The V8 sandbox stays off: Dawn exposes GPU-mapped external ArrayBuffers.
v8_enable_pointer_compression = true
v8_enable_sandbox = false
v8_enable_webassembly = false
# Don't mark executables (embedded-probe) CET shadow-stack compatible. V8's deoptimizer
# rewrites return addresses, which fail-fasts (0xC0000409) under hardware shadow stacks;
# V8's CET support (v8_enable_cet_shadow_stack) is experimental. TouchDesigner.exe itself
# is not CET-compatible, so this matches the process our operator DLLs run in.
enable_cet_shadow_stack = false
`);
run(resolve(dawn, 'buildtools/win/gn.exe'), ['gen', build, `--root=${dawn}`], dawn);
if (step === 'stage') process.exit(0);
if (step !== 'build') throw new Error('Usage: node scripts/embedding-win.mjs [stage|build] [--jobs N] [--targets a,b]');

// 7. Build. Outputs: out/avtools-win/AvToolsSketch.dll, AvToolsChannels.dll, embedded-probe.exe
run(resolve(dawn, 'third_party/ninja/ninja.exe'), ['-C', build, '-j', jobs, ...targets], dawn);
