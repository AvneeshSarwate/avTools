import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {toolRoot,repoRoot} from './runner.mjs';

export async function checkProject(project){
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Embedded runtime checks currently require macOS Apple Silicon. Build/typecheck work separately.');
  const build=resolve(toolRoot,'build');await mkdir(build,{recursive:true});
  const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
  for(const target of ['top','chop']){
    const entries=project.entries.filter(entry=>entry.target===target);if(!entries.length)continue;
    let plugin=process.env[target==='chop'?'AVTOOLS_TD_CHOP_PLUGIN':'AVTOOLS_TD_PLUGIN'];
    if(!plugin)try{const prebuilt=resolve(repoRoot,'packages/native-webgpu/prebuilt/macos-arm64');plugin=resolve(prebuilt,(await readFile(resolve(prebuilt,target==='chop'?'current-chop.txt':'current.txt'),'utf8')).trim());}
    catch{throw Error('Missing prebuilt TD plugin: see packages/native-webgpu/prebuilt/README.md.');}
    const name=target==='chop'?'check-chop':'check';
    execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1',resolve(toolRoot,name+'.cpp'),'-o',resolve(build,name)],{stdio:'inherit'});
    const base=[resolve(plugin,'Contents/MacOS/libavtools_runtime.dylib'),resolve(plugin,'Contents/Resources')];
    if(target==='chop')for(const entry of entries)execFileSync(resolve(build,name),[...base,resolve(project.outDir,entry.name+'.js'),entry.outputs.join(' '),String(entry.samples)],{stdio:'inherit',timeout:120000});
    else execFileSync(resolve(build,name),[...base,resolve(project.root,'.td'),...entries.map(entry=>resolve(project.outDir,entry.name+'.js'))],{stdio:'inherit',timeout:120000});
  }
}
