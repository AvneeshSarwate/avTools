// Download the latest released plugin distribution for this platform into
// apps/td-projects/Plugins (gitignored), so the in-repo example projects work
// without building native code. Also seeds version.json, so a later local
// `td:pack` continues the distribution number instead of restarting at 1.
//   node packages/native-webgpu/scripts/fetch-td-plugins.mjs [--platform macos-arm64|windows-x64]
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync, readFileSync, cpSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {downloadURL, assetName, platform as hostPlatform} from './td-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const i = process.argv.indexOf('--platform');
const platform = i > 0 ? process.argv[i + 1] : hostPlatform;
const target = resolve(root, '../../apps/td-projects/Plugins');
mkdirSync(resolve(root, 'build'), {recursive: true});
const staging = mkdtempSync(resolve(root, 'build/td-fetch-'));
try {
  const url = downloadURL(platform);
  console.log(`Downloading ${url}`);
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok) throw new Error(`Download failed (${response.status}). Has ${assetName(platform)} been released yet?`);
  const zip = resolve(staging, assetName(platform));
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  // ditto preserves macOS bundle signatures/symlinks; Windows' bsdtar reads ZIPs.
  if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', zip, staging], {stdio: 'inherit'});
  else if (process.platform === 'win32') execFileSync(resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-x', '-f', zip, '-C', staging], {stdio: 'inherit'});
  else execFileSync('unzip', ['-q', zip, '-d', staging], {stdio: 'inherit'});
  const plugins = resolve(staging, `avtools-td-${platform}`, 'Plugins');
  if (!existsSync(plugins)) throw new Error('Unexpected archive layout: missing Plugins folder');
  // Swap whole directories; never copy over binaries a running TD may have loaded.
  const previous = resolve(staging, 'previous-Plugins');
  if (existsSync(target)) renameSync(target, previous);
  renameSync(plugins, target);
  const version = JSON.parse(readFileSync(resolve(target, 'version.json'), 'utf8'));
  console.log(`Installed distribution ${version.version} (${version.platform}) at ${target}`);
  // Repository fixtures without a Plugins/ ancestor (packages/native-webgpu/native/td/*)
  // resolve prebuilt/<platform>/current*.txt. Install the released plugins there too,
  // under versioned names (never overwrite one a running TD may have loaded).
  if (platform === hostPlatform) {
    const prebuilt = resolve(root, 'prebuilt', platform);
    const suffix = platform === 'windows-x64' ? '.dll' : '.plugin';
    mkdirSync(prebuilt, {recursive: true});
    for (const [name, marker] of [['AvToolsSketch', 'current.txt'], ['AvToolsChannels', 'current-chop.txt']]) {
      const installed = `${name}-r${version.version}${suffix}`;
      if (!existsSync(resolve(prebuilt, installed))) cpSync(resolve(target, `${name}${suffix}`), resolve(prebuilt, installed), {recursive: true, verbatimSymlinks: true});
      writeFileSync(resolve(prebuilt, marker), installed + '\n');
    }
    console.log(`Repository fixtures will load ${prebuilt}/AvTools*-r${version.version}${suffix}`);
  }
} finally {
  rmSync(staging, {recursive: true, force: true});
}
