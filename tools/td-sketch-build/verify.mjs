import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {toolRoot,repoRoot} from './runner.mjs';

export async function checkProject(project){
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Embedded runtime checks currently require macOS Apple Silicon. Build/typecheck work separately.');
  let plugin=process.env.AVTOOLS_TD_PLUGIN;
  if(!plugin)try{const prebuilt=resolve(repoRoot,'packages/native-webgpu/prebuilt/macos-arm64');plugin=resolve(prebuilt,(await readFile(resolve(prebuilt,'current.txt'),'utf8')).trim());}
  catch{throw Error('Missing prebuilt TD plugin: see packages/native-webgpu/prebuilt/README.md. Or set AVTOOLS_TD_PLUGIN.');}
  const build=resolve(toolRoot,'build');await mkdir(build,{recursive:true});
  const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
  execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1',resolve(toolRoot,'check.cpp'),'-o',resolve(build,'check')],{stdio:'inherit'});
  execFileSync(resolve(build,'check'),[resolve(plugin,'Contents/MacOS/libavtools_runtime.dylib'),resolve(plugin,'Contents/Resources'),resolve(project.root,'.td'),...project.entries.map(entry=>resolve(project.outDir,entry.name+'.js'))],{stdio:'inherit',timeout:120000});
}
