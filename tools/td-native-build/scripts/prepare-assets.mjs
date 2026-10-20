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
for(const name of ['core-timing','creative-algs','power2d','shader-fx','codegen-common']) {
 const source=resolve(root,'packages',name),dest=resolve(sdk,'packages',name);
 cpSync(source,dest,{recursive:true,filter:path=>!relative(source,path).split('/').some(p=>['node_modules','dist','build','test','tests','examples','babylon','babylonGL'].includes(p)) && (statSync(path).isDirectory()||/\.(ts|wgsl|json)$/.test(path)||/LICENSE/.test(path))});
}
mkdirSync(resolve(sdk,'packages/native-webgpu'),{recursive:true});
for(const file of ['td-chop.d.ts','td-sketch.d.ts'])cpSync(resolve(root,'packages/native-webgpu',file),resolve(sdk,'packages/native-webgpu',file));
cpSync(resolve(root,'packages/native-webgpu/dist/types'),resolve(sdk,'packages/native-webgpu/types'),{recursive:true});
const hostTypes=resolve(sdk,'packages/native-webgpu/td-sketch.d.ts');writeFileSync(hostTypes,readFileSync(hostTypes,'utf8').replace('./dist/types/','./types/'));
const modules=resolve(root,'tools/td-sketch-build/node_modules');
for(const name of ['earcut','seedrandom','@types/earcut','@types/seedrandom','@webgpu/types']) cpSync(existsSync(resolve(modules,name))?resolve(modules,name):resolve(root,'node_modules',name),resolve(sdk,'dependencies',name),{recursive:true,dereference:true});
const paths={};
const aliases=JSON.parse(readFileSync(resolve(root,'deno.json'),'utf8')).imports;
for(const [name,value] of Object.entries(aliases))if(value.startsWith('./packages/')&&['core-timing','creative-algs','power2d','shader-fx','codegen-common'].includes(value.split('/')[2])&&!/babylon|codegen/.test(name))paths[name.endsWith('/')?name+'*':name]=['./'+value.slice(2)+(name.endsWith('/')?'*':'')];
paths['@avtools/native-webgpu/td-chop']=['./packages/native-webgpu/td-chop.d.ts'];
paths['@avtools/native-webgpu/td-sketch']=['./packages/native-webgpu/td-sketch.d.ts'];
paths['@avtools/native-webgpu']=['./packages/native-webgpu/types/packages/native-webgpu/src/index.d.ts'];
paths.earcut=['./dependencies/earcut/src/earcut.js'];paths.seedrandom=['./dependencies/seedrandom/index.js'];
// Types and runtime use the same SDK dependency folders through package metadata.
for(const [name,type] of [['earcut','earcut'],['seedrandom','seedrandom']]){
 const packagePath=resolve(sdk,'dependencies',name,'package.json'),p=JSON.parse(readFileSync(packagePath));
 p.types=`../@types/${type}/index.d.ts`;writeFileSync(packagePath,JSON.stringify(p,null,2));paths[name]=[`./dependencies/${name}`];
}
writeFileSync(resolve(sdk,'tsconfig.json'),JSON.stringify({compilerOptions:{paths,typeRoots:['./dependencies/@types'],types:[],skipLibCheck:true},files:['./dependencies/@webgpu/types/dist/index.d.ts']},null,2));
writeFileSync(resolve(sdk,'wgsl.d.ts'),'declare module "*.wgsl" { const source: string; export default source; }\n');
writeFileSync(resolve(sdk,'VERSION'),'avtools-sdk-1\n');
// Embed a deterministic text asset archive; extracted only by explicit init.
const files={};function walk(dir){for(const name of readdirSync(dir).sort()){if(dir===resolve(tool,'template')&&['dist','generated','.avtools','Backup'].includes(name))continue;const path=resolve(dir,name);if(statSync(path).isDirectory())walk(path);else files[relative(resolve(tool,'template'),path)]=readFileSync(path,'utf8');}}
walk(resolve(tool,'template'));writeFileSync(resolve(tool,'assets/template.json'),JSON.stringify(files));
console.log(`Prepared generator bundle and ${Object.keys(files).length} template assets`);
