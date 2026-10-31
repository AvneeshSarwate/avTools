import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'build/midi-test');
mkdirSync(dir,{recursive:true});
await build({entryPoints:[resolve(root,'src/td-chop-runtime.ts')],bundle:true,format:'iife',platform:'neutral',target:'es2022',outfile:resolve(dir,'chop.js')});
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
execFileSync('clang++',['-std=c++17','-O2','-Wno-deprecated-declarations','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1',resolve(root,'test/midi/bridge.cpp'),'-framework','CoreMIDI','-framework','CoreFoundation','-o',resolve(dir,'bridge')],{stdio:'inherit'});
mkdirSync(resolve(root,'test/midi/results'),{recursive:true});
const output=execFileSync(resolve(dir,'bridge'),[resolve(root,'upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib'),dir],{encoding:'utf8',timeout:120000,env:{...process.env,DYLD_FRAMEWORK_PATH:resolve(root,'build/syphon-embedded')}});
process.stdout.write(output);
writeFileSync(resolve(root,'test/midi/results/native.json'),JSON.stringify({passed:true,platform:process.platform,arch:process.arch,output:output.trim().split('\n')},null,2)+'\n');

execFileSync('clang++',['-std=c++17','-O2','-Wno-deprecated-declarations','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1',resolve(root,'test/midi/benchmark.cpp'),'-framework','CoreMIDI','-framework','CoreFoundation','-o',resolve(dir,'benchmark')],{stdio:'inherit'});
const timing=execFileSync(resolve(dir,'benchmark'),[resolve(root,'upstream/node-webgpu/third_party/dawn/out/avtools-v8/libavtools_runtime.dylib'),dir],{encoding:'utf8',timeout:60000,env:{...process.env,DYLD_FRAMEWORK_PATH:resolve(root,'build/syphon-embedded')}});
process.stdout.write(timing);
writeFileSync(resolve(root,'test/midi/results/timing.json'),JSON.stringify({platform:process.platform,arch:process.arch,output:timing.trim().split('\n')},null,2)+'\n');
