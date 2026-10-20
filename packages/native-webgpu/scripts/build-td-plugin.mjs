import {build} from 'esbuild';
import {seedrandomNotices} from './seedrandom-notices.mjs';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const chop=process.argv.includes('--chop');
const name=chop?'AvToolsChannels':'AvToolsSketch';
const cpp=chop?'native/td/SketchCHOP.cpp':'native/td/SketchTOP.cpp';
// Hash the bundled renderer (including transitive imports) and all shipped inputs.
// Build elsewhere, then rename once; never overwrite a binary mapped into TD.
const renderer=await build({entryPoints:[resolve(root,chop?'src/td-chop-runtime.ts':'src/td-runtime.ts')],write:false,bundle:true,platform:'neutral',format:'iife',target:'es2022',nodePaths:[resolve(root,'node_modules')]});
const digest=createHash('sha256');
function hashTree(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){digest.update(entry.name);const child=resolve(path,entry.name);if(entry.isDirectory())hashTree(child);else if(entry.isFile())digest.update(readFileSync(child));}}
for(const path of ['scripts/build-td-plugin.mjs',cpp,'native/embedded/Bridge.h','upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib','dist/THIRD_PARTY_NOTICES.txt'])digest.update(readFileSync(resolve(root,path)));
digest.update(seedrandomNotices(root));digest.update(renderer.outputFiles[0].contents);hashTree(resolve(root,'dist/fonts'));hashTree(resolve(root,'build/syphon-embedded/AVToolsSyphon.framework/Versions/A'));
const tag=digest.digest('hex').slice(0,12),prebuilt=resolve(root,'prebuilt/macos-arm64'),finalBundle=resolve(prebuilt,`${name}-${tag}.plugin`);
mkdirSync(prebuilt,{recursive:true});mkdirSync(resolve(root,'build'),{recursive:true});
function publish(){
  writeFileSync(resolve(prebuilt,chop?'current-chop.txt':'current.txt'),basename(finalBundle)+'\n');
  // Preserve the local marker used by native developer probes.
  writeFileSync(resolve(root,chop?'build/td-chop-plugin-path.txt':'build/td-plugin-path.txt'),finalBundle+'\n');
  console.log(finalBundle);
}
if(existsSync(finalBundle)){publish();process.exit(0);}
const bundle=resolve(root,`build/.${name}-${tag}-${process.pid}.plugin`),mac=resolve(bundle,'Contents/MacOS'),resources=resolve(bundle,'Contents/Resources');
mkdirSync(mac,{recursive:true});mkdirSync(resources,{recursive:true});
writeFileSync(resolve(resources,chop?'chop.js':'renderer.js'),renderer.outputFiles[0].contents);
writeFileSync(resolve(resources,'seedrandom-LICENSE.txt'),seedrandomNotices(root));
if(!chop)cpSync(resolve(root,'dist/fonts'),resolve(resources,'fonts'),{recursive:true});
cpSync(resolve(root,'dist/THIRD_PARTY_NOTICES.txt'),resolve(resources,'THIRD_PARTY_NOTICES.txt'));
cpSync(resolve(root,'upstream/node-webgpu/third_party/dawn/third_party/v8/src/LICENSE'),resolve(resources,'V8-LICENSE.txt'));
cpSync(resolve(root,'build/syphon-embedded/AVToolsSyphon.framework'),resolve(mac,'AVToolsSyphon.framework'),{recursive:true,verbatimSymlinks:true});
cpSync(resolve(root,'upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib'),resolve(mac,'libavtools_runtime.dylib'));
writeFileSync(resolve(bundle,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string><key>CFBundleIdentifier</key><string>org.avtools.${chop?'channels':'sketch'}</string><key>CFBundleName</key><string>${name}</string><key>CFBundlePackageType</key><string>BNDL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
const headers='/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/'+(chop?'CHOP':'CPUMemoryTOP');
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
execFileSync('clang++',['-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','-std=c++17','-O2','-fvisibility=hidden','-bundle','-arch','arm64','-mmacosx-version-min=15.0','-I'+headers,resolve(root,cpp),'-L'+mac,'-lavtools_runtime','-o',resolve(mac,name)],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',resolve(mac,'AVToolsSyphon.framework')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',resolve(mac,'libavtools_runtime.dylib')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-',bundle],{stdio:'inherit'});
renameSync(bundle,finalBundle);
publish();
