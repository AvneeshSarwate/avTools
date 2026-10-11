import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
// Hash the bundled renderer (including transitive imports) and all shipped inputs.
// Build elsewhere, then rename once; never overwrite a binary mapped into TD.
const renderer=await build({entryPoints:[resolve(root,'src/td-runtime.ts')],write:false,bundle:true,platform:'neutral',format:'iife',target:'es2022'});
const digest=createHash('sha256');
function hashTree(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){digest.update(entry.name);const child=resolve(path,entry.name);if(entry.isDirectory())hashTree(child);else if(entry.isFile())digest.update(readFileSync(child));}}
for(const path of ['scripts/build-td-plugin.mjs','native/td/SketchTOP.cpp','native/embedded/Bridge.h','upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib','dist/THIRD_PARTY_NOTICES.txt'])digest.update(readFileSync(resolve(root,path)));
digest.update(renderer.outputFiles[0].contents);hashTree(resolve(root,'dist/fonts'));hashTree(resolve(root,'build/syphon-embedded/AVToolsSyphon.framework/Versions/A'));
const tag=digest.digest('hex').slice(0,12),finalBundle=resolve(root,`build/AvToolsSketch-${tag}.plugin`);
if(existsSync(finalBundle)){writeFileSync(resolve(root,'build/td-plugin-path.txt'),finalBundle+'\n');console.log(finalBundle);process.exit(0);}
const bundle=resolve(root,`build/.AvToolsSketch-${tag}-${process.pid}.plugin`),mac=resolve(bundle,'Contents/MacOS'),resources=resolve(bundle,'Contents/Resources');
mkdirSync(mac,{recursive:true});mkdirSync(resources,{recursive:true});
writeFileSync(resolve(resources,'renderer.js'),renderer.outputFiles[0].contents);
cpSync(resolve(root,'dist/fonts'),resolve(resources,'fonts'),{recursive:true});
cpSync(resolve(root,'dist/THIRD_PARTY_NOTICES.txt'),resolve(resources,'THIRD_PARTY_NOTICES.txt'));
cpSync(resolve(root,'upstream/node-webgpu/third_party/dawn/third_party/v8/src/LICENSE'),resolve(resources,'V8-LICENSE.txt'));
cpSync(resolve(root,'build/syphon-embedded/AVToolsSyphon.framework'),resolve(mac,'AVToolsSyphon.framework'),{recursive:true,verbatimSymlinks:true});
cpSync(resolve(root,'upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib'),resolve(mac,'libavtools_runtime.dylib'));
writeFileSync(resolve(bundle,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>AvToolsSketch</string><key>CFBundleIdentifier</key><string>org.avtools.sketch</string><key>CFBundleName</key><string>AvToolsSketch</string><key>CFBundlePackageType</key><string>BNDL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
const headers='/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP';
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
execFileSync('clang++',['-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','-std=c++17','-O2','-fvisibility=hidden','-bundle','-arch','arm64','-mmacosx-version-min=15.0','-I'+headers,resolve(root,'native/td/SketchTOP.cpp'),'-L'+mac,'-lavtools_runtime','-o',resolve(mac,'AvToolsSketch')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',resolve(mac,'AVToolsSyphon.framework')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',resolve(mac,'libavtools_runtime.dylib')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',bundle],{stdio:'inherit'});
renameSync(bundle,finalBundle);
writeFileSync(resolve(root,'build/td-plugin-path.txt'),finalBundle+'\n');
console.log(finalBundle);
