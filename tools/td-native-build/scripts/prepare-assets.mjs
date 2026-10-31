import './prepare-environment.mjs';
// Release tooling only. Distributed projects and binaries never invoke Node.
import {build} from '../../td-sketch-build/node_modules/esbuild/lib/main.js';
import {readFileSync,rmSync,existsSync,writeFileSync,mkdirSync,cpSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const tool=resolve(root,'tools/td-native-build');
const result=await build({entryPoints:[resolve(root,'tools/td-sketch-build/codegen.ts')],bundle:true,write:false,platform:'neutral',mainFields:['module','main'],format:'iife',globalName:'avtoolsGenerators',target:'es2022',nodePaths:[resolve(root,'tools/td-sketch-build/node_modules')]});
writeFileSync(resolve(tool,'assets/generators.js'),result.outputFiles[0].contents);
const sdk=resolve(tool,'template/sdk');rmSync(sdk,{recursive:true,force:true});mkdirSync(sdk,{recursive:true});
for(const name of ['creative-algs','power2d','shader-fx','codegen-common','core-timing']) {
 const source=resolve(root,'packages',name),dest=resolve(sdk,'packages',name);
 cpSync(source,dest,{recursive:true,filter:path=>!relative(source,path).split('/').some(p=>['node_modules','dist','build','test','tests','examples','babylon','babylonGL'].includes(p)) && (statSync(path).isDirectory()||/\.(ts|wgsl|json)$/.test(path)||/LICENSE/.test(path))});
}
mkdirSync(resolve(sdk,'packages/native-webgpu'),{recursive:true});
for(const file of ['td-midi.d.ts','td-io.d.ts','td-parameters.d.ts','td-chop.d.ts','td-sketch.d.ts','td-runtime.d.ts','td-top-runtime.d.ts'])cpSync(resolve(root,'packages/native-webgpu',file),resolve(sdk,'packages/native-webgpu',file));
cpSync(resolve(root,'packages/native-webgpu/td-types'),resolve(sdk,'packages/native-webgpu/td-types'),{recursive:true});
mkdirSync(resolve(sdk,'packages/midi'),{recursive:true});
cpSync(resolve(root,'packages/midi/api.ts'),resolve(sdk,'packages/midi/api.ts'));
const modules=resolve(root,'tools/td-sketch-build/node_modules');
for(const name of ['earcut','seedrandom','@types/earcut','@types/seedrandom','@webgpu/types']) cpSync(existsSync(resolve(modules,name))?resolve(modules,name):resolve(root,'node_modules',name),resolve(sdk,'dependencies',name),{recursive:true,dereference:true});
const paths={};
const aliases=JSON.parse(readFileSync(resolve(root,'deno.json'),'utf8')).imports;
for(const [name,value] of Object.entries(aliases))if(value.startsWith('./packages/')&&['creative-algs','power2d','shader-fx','codegen-common','core-timing'].includes(value.split('/')[2])&&!/babylon|codegen/.test(name))paths[name.endsWith('/')?name+'*':name]=['./'+value.slice(2)+(name.endsWith('/')?'*':'')];
paths['@avtools/native-webgpu/td-midi']=['./packages/native-webgpu/td-midi.d.ts'];
paths['@avtools/native-webgpu/td-io']=['./packages/native-webgpu/td-io.d.ts'];
paths['@avtools/native-webgpu/td-parameters']=['./packages/native-webgpu/td-parameters.d.ts'];
paths['@avtools/native-webgpu/td-chop']=['./packages/native-webgpu/td-chop.d.ts'];
paths['@avtools/native-webgpu/td-sketch']=['./packages/native-webgpu/td-sketch.d.ts'];
paths['@avtools/native-webgpu/td-p5']=['./packages/native-webgpu/td-types/p5.d.ts'];
paths['@avtools/core-timing']=['./packages/core-timing/mod.ts'];
// SDK-private dependencies must not override the user's installed npm versions.
// Package imports are scoped to sdk/package.json and understood by both compilers.
writeFileSync(resolve(sdk,'package.json'),JSON.stringify({private:true,imports:{
 '#avtools-earcut':{types:'./dependencies/@types/earcut/index.d.ts',default:'./dependencies/earcut/src/earcut.js'},
 '#avtools-seedrandom':{types:'./dependencies/@types/seedrandom/index.d.ts',default:'./dependencies/seedrandom/index.js'},
}},null,2));
function scopeDependencies(dir){for(const name of readdirSync(dir)){const path=resolve(dir,name);if(statSync(path).isDirectory())scopeDependencies(path);else if(path.endsWith('.ts')){const text=readFileSync(path,'utf8');writeFileSync(path,text.replace(/(from\s*['"])(earcut|seedrandom)(['"])/g,'$1#avtools-$2$3'));}}}
scopeDependencies(resolve(sdk,'packages'));
writeFileSync(resolve(sdk,'tsconfig.json'),JSON.stringify({compilerOptions:{paths,types:[],skipLibCheck:true},files:['./packages/native-webgpu/td-runtime.d.ts']},null,2));
writeFileSync(resolve(sdk,'wgsl.d.ts'),'declare module "*.wgsl" { const source: string; export default source; }\n');
writeFileSync(resolve(sdk,'VERSION'),'avtools-sdk-6\n');
// Embed a deterministic text asset archive; extracted only by explicit init.
const files={};function walk(dir){for(const name of readdirSync(dir).sort()){if(dir===resolve(tool,'template')&&['dist','generated','.avtools','Backup'].includes(name))continue;const path=resolve(dir,name);if(statSync(path).isDirectory())walk(path);else files[relative(resolve(tool,'template'),path)]=readFileSync(path,'utf8');}}
walk(resolve(tool,'template'));writeFileSync(resolve(tool,'assets/template.json'),JSON.stringify(files));
console.log(`Prepared generator bundle and ${Object.keys(files).length} template assets`);
