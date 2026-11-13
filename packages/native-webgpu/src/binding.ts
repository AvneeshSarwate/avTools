import { createRequire } from 'node:module';
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`@avtools/native-webgpu has binaries only for macOS arm64; received ${process.platform}-${process.arch}`);
}
export const requireNative = createRequire(import.meta.url);
export const nativeDirectory = './native/darwin-arm64/';
