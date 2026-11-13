// Publish this platform's packaged ZIP to the rolling `td-plugins` GitHub release,
// replacing only this platform's asset. Run after `npm run td:pack` (or td:build).
// Requires the GitHub CLI (`gh`) authenticated with push access.
//   node packages/native-webgpu/scripts/release-td.mjs
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {repository, tag, assetName, downloadURL, platform} from './td-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const zip = resolve(root, 'prebuilt', assetName());
if (!existsSync(zip)) throw new Error(`Missing ${zip}; run npm run td:pack first`);
const gh = (args, options = {}) => execFileSync('gh', [...args, '--repo', repository], {encoding: 'utf8', ...options});
let exists = true;
try { gh(['release', 'view', tag], {stdio: 'pipe'}); } catch { exists = false; }
if (!exists) gh(['release', 'create', tag, '--title', 'avTools TouchDesigner plugins (latest)', '--notes',
  'Rolling release: always the latest TouchDesigner TOP/CHOP plugins.\n\n' +
  `- macOS Apple Silicon: ${downloadURL('macos-arm64')}\n- Windows x64: ${downloadURL('windows-x64')}\n\n` +
  'Extract the ZIP and follow Plugins/README.md. Each Plugins/version.json identifies the build.'], {stdio: 'inherit'});
gh(['release', 'upload', tag, zip, '--clobber'], {stdio: 'inherit'});
const plugins = resolve(root, '../../apps/td-projects/Plugins');  // refreshed by td:pack on each platform
const version = existsSync(resolve(plugins, 'version.json')) ? JSON.parse(readFileSync(resolve(plugins, 'version.json'), 'utf8')).version : '?';
console.log(`Published ${platform} distribution ${version}: ${downloadURL()}`);
