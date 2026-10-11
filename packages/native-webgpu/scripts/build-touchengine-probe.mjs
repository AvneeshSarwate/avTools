import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}/native-manifest.json`, 'utf8'));
if (process.argv.includes('--fetch')) {
  if (!existsSync(`${root}/upstream/touchengine`)) execFileSync('git', ['clone', 'https://github.com/TouchDesigner/TouchEngine-macOS.git', `${root}/upstream/touchengine`], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', manifest.touchEngineSDK], { cwd: `${root}/upstream/touchengine`, stdio: 'inherit' });
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: `${root}/upstream/touchengine`, encoding: 'utf8' }).trim();
if (revision !== manifest.touchEngineSDK) throw new Error('Unexpected TouchEngine SDK revision');
mkdirSync(`${root}/build`, { recursive: true });
rmSync(`${root}/build/TouchEngine.framework`, { recursive: true, force: true });
cpSync(`${root}/upstream/touchengine/TouchEngine.framework`, `${root}/build/TouchEngine.framework`, { recursive: true, verbatimSymlinks: true });
for (const path of ['Versions/A/Frameworks/IPM.framework/Versions/A/ca.derivative.IPMAgent', 'Versions/A/Frameworks/IPM.framework/Versions/A/IPM', 'Versions/A/Frameworks/libTPC.dylib', 'Versions/A/Frameworks/libTouchEngine.dylib', 'Versions/A/TouchEngine']) {
  execFileSync('codesign', ['--force', '--sign', '-', `${root}/build/TouchEngine.framework/${path}`], { stdio: 'inherit' });
}
const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
execFileSync('clang++', ['-std=c++17', '-isysroot', sdk, '-isystem', `${sdk}/usr/include/c++/v1`,
  '-Fbuild', '-framework', 'TouchEngine', '-framework', 'Metal', '-framework', 'Foundation',
  '-Wl,-rpath,@executable_path', 'test/td/touchengine_probe.mm', '-o', 'build/touchengine-probe'],
  { cwd: root, stdio: 'inherit' });
