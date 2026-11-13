// Windows x64 counterpart of package-td.mjs (invoked by it on Windows).
// End-user layout (one ZIP, one folder to copy beside the .toe):
//   avtools-td-windows-x64/   (ZIP: prebuilt/avtools-td-plugins-windows-x64.zip; Plugins also refreshed at apps/td-projects/Plugins)
//     README.md
//     Plugins/
//       README.md                  GUI walkthrough (Windows)
//       AvToolsSketch.dll          TOP, fully self-contained
//       AvToolsChannels.dll        CHOP, fully self-contained
//       avtools-build.exe          offline typechecker CLI
//       avtools-build-VERSION.txt
//       THIRD_PARTY_NOTICES.txt    every bundled component's notices in one file
//       version.json
//     Examples/                  example projects (scripts/td-examples.mjs)
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {writeDistributionVersion} from './td-distribution-version.mjs';
import {copyExamples} from './td-examples.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prebuilt = resolve(root, 'prebuilt/windows-x64');
mkdirSync(resolve(root, 'build'), {recursive: true});
const staging = mkdtempSync(resolve(root, 'build/td-release-win-'));
const release = resolve(staging, 'avtools-td-windows-x64'), plugins = resolve(release, 'Plugins');
mkdirSync(plugins, {recursive: true});

// Operators: versioned DLLs selected by the current markers, shipped under stable names.
for (const [marker, name] of [['current.txt', 'AvToolsSketch'], ['current-chop.txt', 'AvToolsChannels']]) {
  const file = readFileSync(resolve(prebuilt, marker), 'utf8').trim();
  if (!new RegExp(`^${name}-[a-f0-9]{12}\\.dll$`).test(file)) throw new Error(`Unexpected ${marker}: ${file}`);
  cpSync(resolve(prebuilt, file), resolve(plugins, `${name}.dll`));
}
// Standalone CLI (statically linked, static CRT).
const cliTag = readFileSync(resolve(prebuilt, 'native-build/current.txt'), 'utf8').trim();
if (!/^[a-f0-9]{12}$/.test(cliTag)) throw new Error(`Invalid CLI compiler tag: ${cliTag}`);
const cli = resolve(prebuilt, 'native-build', cliTag);
cpSync(resolve(cli, 'avtools-build.exe'), resolve(plugins, 'avtools-build.exe'));
writeFileSync(resolve(plugins, 'avtools-build-VERSION.txt'), `compiler ${cliTag}\n` + readFileSync(resolve(cli, 'VERSION'), 'utf8'));

// One notices file: runtime (Dawn/V8/libuv/Rust crates/seedrandom/fonts) + compiler.
const notices = resolve(prebuilt, 'notices');
const sections = readdirSync(notices).sort().map(file => [file, readFileSync(resolve(notices, file), 'utf8')]);
sections.push(['avtools-build (TypeScript compiler)', readFileSync(resolve(cli, 'THIRD_PARTY_NOTICES.txt'), 'utf8')]);
writeFileSync(resolve(plugins, 'THIRD_PARTY_NOTICES.txt'), 'Third-party notices for the avTools TouchDesigner plugins and avtools-build.exe.\n\n' +
  sections.map(([title, text]) => `######## ${title} ########\n\n${text.trim()}\n`).join('\n'));
cpSync(resolve(prebuilt, 'README.md'), resolve(plugins, 'README.md'));

// Distribution number: increments only when shipped files change (same scheme as
// macOS). apps/td-projects/Plugins (gitignored; seeded by `npm run td:fetch`)
// holds the previous version.json.
const projectPlugins = resolve(root, '../../apps/td-projects/Plugins');
const version = writeDistributionVersion(plugins, projectPlugins, 'windows-x64');
writeFileSync(resolve(release, 'README.md'), `# avTools for TouchDesigner (Windows) — distribution ${version.version}\n\nStart with [Plugins/README.md](Plugins/README.md) for the GUI setup walkthrough.\nThen open the example projects in [Examples](Examples/README.md).\n`);
// Example projects beside Plugins/ (not part of version.json: that identifies the plugins).
copyExamples(resolve(root, '../..'), release);

// ZIP with Windows' own bsdtar (no extra tools), then swap into place.
const tar = resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const temporary = resolve(staging, 'plugins.zip');
execFileSync(tar, ['-a', '-c', '-f', temporary, '-C', staging, 'avtools-td-windows-x64'], {stdio: 'inherit'});
const archive = resolve(root, 'prebuilt/avtools-td-plugins-windows-x64.zip');
rmSync(archive, {force: true});
renameSync(temporary, archive);

// Refresh the local copyable folder (as on macOS): swap whole directories, never
// copy over DLLs a running TouchDesigner may have loaded.
const previous = resolve(staging, 'previous-Plugins');
if (existsSync(projectPlugins)) renameSync(projectPlugins, previous);
try { renameSync(plugins, projectPlugins); }
catch (error) { if (existsSync(previous)) renameSync(previous, projectPlugins); throw error; }
rmSync(staging, {recursive: true, force: true});
console.log(`TouchDesigner Windows distribution ${version.version}: ${archive}\nLocal copy: ${projectPlugins}\nPublish: npm run td:release`);
