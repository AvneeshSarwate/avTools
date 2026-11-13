import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
execFileSync('clang++', ['-x', 'objective-c++', '-std=c++17', '-isysroot', sdk, '-isystem', `${sdk}/usr/include/c++/v1`,
  '-Ibuild/dawn/avtools-include', '-Iupstream/syphon', '-Fdist/native/darwin-arm64', '-framework', 'Syphon', '-framework', 'Metal', '-framework', 'Foundation',
  '-Wl,-rpath,@executable_path/../dist/native/darwin-arm64', 'test/syphon_receiver.mm', '-o', 'build/syphon-receiver'], { cwd: root, stdio: 'inherit' });
