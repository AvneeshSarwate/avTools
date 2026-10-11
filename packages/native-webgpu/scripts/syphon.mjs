import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const embedded=process.argv.includes('--embedded');
const frameworkName=embedded?'AVToolsSyphon':'Syphon';
const source = resolve(root, 'upstream/syphon'), build = resolve(root, embedded?'build/syphon-embedded':'build/syphon');
const pin = 'f4761677a45b8034a3c2069ec0f3d2553da81fba';
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
if (process.argv[2] === 'fetch') {
  if (!existsSync(source)) run('git', ['clone', 'https://github.com/Syphon/Syphon-Framework.git', source]);
  run('git', ['checkout', '--detach', pin], source);
} else {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (revision !== pin) throw new Error('Unexpected Syphon source revision');
  const patch = resolve(root, 'patches/syphon-0001-metal-region.patch');
  try { execFileSync('git', ['apply', '--reverse', '--check', patch], { cwd: source, stdio: 'pipe' }); }
  catch { run('git', ['apply', '--check', patch], source); run('git', ['apply', patch], source); }
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  const framework = `${build}/${frameworkName}.framework`, version = `${framework}/Versions/A`;
  mkdirSync(`${version}/Resources`, { recursive: true }); mkdirSync(`${build}/include/Syphon`, { recursive: true });
  for (const header of readdirSync(source).filter(f => f.endsWith('.h'))) cpSync(`${source}/${header}`, `${build}/include/Syphon/${header}`);
  // CLT-only Macs lack the offline metal compiler. Compile the exact pinned
  // upstream shader through MTLDevice at server creation instead. No shader rewrite.
  const shader = readFileSync(`${source}/SyphonMetalShaders.metal`, 'utf8').replace('#include "SyphonServerMetalTypes.h"',
    readFileSync(`${source}/SyphonServerMetalTypes.h`, 'utf8'));
  const renderer = readFileSync(`${source}/SyphonServerRendererMetal.m`, 'utf8');
  const old = 'id<MTLLibrary> defaultLibrary = [device newDefaultLibraryWithBundle:bundle error:&error];';
  if (!renderer.includes(old)) throw new Error('Syphon runtime-shader seam changed');
  writeFileSync(`${build}/SyphonServerRendererMetal.m`, renderer.replace(old,
    `id<MTLLibrary> defaultLibrary = [device newLibraryWithSource:@${JSON.stringify(shader)} options:nil error:&error];`));
  let prefix=[];
  if(embedded){
    // Keep Objective-C classes and C identifiers out of TouchDesigner's Syphon namespace.
    // String-valued discovery protocol names remain exactly upstream-compatible.
    const texts=readdirSync(source).filter(f=>/\.(h|m|c)$/.test(f)).map(f=>readFileSync(`${source}/${f}`,'utf8'));
    const macros=new Set(texts.flatMap(t=>[...t.matchAll(/^\s*#\s*define\s+(Syphon\w*)/gm)].map(m=>m[1])));
    const names=[...new Set(texts.flatMap(t=>t.match(/\bSyphon[A-Za-z0-9_]+\b/g)??[]))].filter(n=>!macros.has(n)).sort();
    writeFileSync(`${build}/AvToolsSyphonPrefix.h`,names.map(n=>`#define ${n} AVTools${n}`).join('\n')+'\n');
    prefix=['-include',`${build}/AvToolsSyphonPrefix.h`];
  }
  const files = readdirSync(source).filter(f => /\.(m|c)$/.test(f));
  const common = [...prefix, '-O2', '-arch', 'arm64', '-mmacosx-version-min=15.0', '-isysroot', sdk, '-fblocks',
    '-DSYPHON_CORE_SHARE', '-DGL_SILENCE_DEPRECATION', '-Wno-deprecated-declarations', '-I', source,
    '-I', `${build}/include`, '-include', `${source}/Syphon_Prefix.pch`];
  for (const file of files) run('clang', [...common, ...(file.endsWith('.m') ? ['-fobjc-arc', '-fobjc-weak'] : []),
    '-c', file === 'SyphonServerRendererMetal.m' ? `${build}/${file}` : `${source}/${file}`, '-o', `${build}/${file}.o`]);
  run('clang', ['-dynamiclib', '-arch', 'arm64', '-mmacosx-version-min=15.0', ...files.map(f => `${build}/${f}.o`),
    '-framework', 'Cocoa', '-framework', 'Metal', '-framework', 'IOSurface', '-framework', 'OpenGL',
    '-install_name', `@rpath/${frameworkName}.framework/Versions/A/${frameworkName}`, '-o', `${version}/${frameworkName}`]);
  writeFileSync(`${version}/Resources/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>info.v002.${frameworkName}</string><key>CFBundleExecutable</key><string>${frameworkName}</string>
    <key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleVersion</key><string>5</string>
    <key>CFBundleShortVersionString</key><string>5-avtools-${pin.slice(0, 8)}</string></dict></plist>`);
  for (const [path, target] of [[`${framework}/Versions/Current`, 'A'], [`${framework}/${frameworkName}`, `Versions/Current/${frameworkName}`],
    [`${framework}/Resources`, 'Versions/Current/Resources']]) if (!existsSync(path)) symlinkSync(target, path);
  console.log(`Built Syphon ${pin} with upstream shader compiled at runtime`);
}
