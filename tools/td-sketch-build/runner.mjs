import {build} from 'esbuild';
import ts from 'typescript';
import {builtinModules} from 'node:module';
import {readFile, writeFile, mkdir, rename, readdir, rm} from 'node:fs/promises';
import {existsSync, watch} from 'node:fs';
import {resolve, dirname, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const toolRoot=dirname(fileURLToPath(import.meta.url));
export const repoRoot=resolve(toolRoot,'../..');
const modules=resolve(toolRoot,'node_modules');
const hash=value=>createHash('sha256').update(value).digest('hex');
const posix=path=>path.split(sep).join('/');
const inside=(root,path)=>path===root||(!relative(root,path).startsWith('..'+sep)&&relative(root,path)!=='..'&&!isAbsolute(relative(root,path)));

export async function atomicWrite(path,contents){
  try {if(Buffer.from(contents).equals(await readFile(path)))return false;}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${process.pid}.tmp`;
  try {await writeFile(temporary,contents);await rename(temporary,path);}finally{await rm(temporary,{force:true});}
  return true;
}

export async function loadProject(configPath){
  configPath=resolve(configPath);const root=dirname(configPath);
  const compiled=await build({entryPoints:[configPath],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  const config=(await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'))).default;
  if(!config||!config.sketches||!Object.keys(config.sketches).length)throw Error('Config must export a nonempty sketches map');
  const local=(path,label)=>{if(typeof path!=='string')throw Error(`${label} must be a path`);const result=resolve(root,path);if(!inside(root,result)||result===root)throw Error(`${label} must be inside the project directory`);return result;};
  const entries=Object.entries(config.sketches).map(([name,value])=>{
    if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name))throw Error(`Invalid sketch name: ${name}`);
    const target=typeof value==='string'?'top':value?.target;
    if(!['top','chop'].includes(target))throw Error(`Invalid target for ${name}`);
    const outputs=target==='chop'?value.outputs:[];
    if(target==='chop'&&(!Array.isArray(outputs)||!outputs.length||outputs.length>1024||outputs.some(n=>typeof n!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(n))||new Set(outputs).size!==outputs.length))throw Error(`${name}: outputs must be unique channel identifiers`);
    const samples=target==='chop'?(value.samples??1):1;
    if(!Number.isInteger(samples)||samples<1||samples*Math.max(1,outputs.length)>1048576)throw Error(`${name}: samples must be a positive integer; maximum 1M total output samples`);
    return {name,target,outputs,samples,entry:local(typeof value==='string'?value:value.entry,`sketch ${name}`)};
  });
  const outDir=local(config.outDir??'dist','outDir'),generatedDir=local(config.generatedDir??'generated','generatedDir');
  if(inside(outDir,generatedDir)||inside(generatedDir,outDir))throw Error('Output and generated directories must be separate');
  const shaderDirs=(config.shaderDirs??['sketches']).map(path=>local(path,'shaderDirs'));
  for(const entry of entries)if(inside(outDir,entry.entry)||inside(generatedDir,entry.entry))throw Error('Sketch entry cannot be inside a generated directory');
  for(const path of shaderDirs)if(inside(path,outDir)||inside(path,generatedDir)||inside(outDir,path)||inside(generatedDir,path))throw Error('Shader directories must be separate from generated/output directories');
  return {root,configPath,entries,outDir,generatedDir,shaderDirs,tsconfig:local(config.tsconfig??'tsconfig.json','tsconfig')};
}

const blockedPackages=new Map([
  ['@avtools/core-timing','Use host.timing for lifecycle-managed launches; type-only imports are supported.'],
  ['@avtools/native-webgpu','Use host.device and the supplied p renderer; native-webgpu is a Node host.'],
  ['@avtools/power2d','Import @avtools/power2d/raw or /core explicitly.'],
  ['@avtools/shader-fx','Import @avtools/shader-fx/raw explicitly.'],
]);
async function aliases(){
  const {imports}=JSON.parse(await readFile(resolve(repoRoot,'deno.json'),'utf8'));
  return Object.fromEntries(Object.entries(imports).filter(([name,path])=>name.startsWith('@avtools/')&&path.startsWith('./')).map(([name,path])=>[name,resolve(repoRoot,path)]));
}

export async function prepareTypes(project){
  const paths={};
  for(const [name,path] of Object.entries(await aliases()))paths[name.endsWith('/')?name+'*':name]=[posix(path)+(name.endsWith('/')?'/*':'')];
  paths['@avtools/native-webgpu/td-sketch']=[resolve(repoRoot,'packages/native-webgpu/td-sketch.d.ts')];
  paths['@avtools/native-webgpu/td-chop']=[resolve(repoRoot,'packages/native-webgpu/td-chop.d.ts')];
  paths['@avtools/native-webgpu']=[resolve(repoRoot,'packages/native-webgpu/dist/types/packages/native-webgpu/src/index.d.ts')];
  paths['earcut']=[resolve(modules,'@types/earcut/index.d.ts')];
  paths['seedrandom']=[resolve(modules,'@types/seedrandom/index.d.ts')];
  await atomicWrite(resolve(project.root,'.td/tsconfig.paths.json'),JSON.stringify({compilerOptions:{paths,typeRoots:[resolve(modules,'@types'),modules],types:['@webgpu/types']}},null,2)+'\n');
}

let generator;
async function getGenerator(){
  if(!generator){
    const result=await build({entryPoints:[resolve(toolRoot,'codegen.ts')],bundle:true,platform:'node',format:'esm',write:false,nodePaths:[modules],logLevel:'silent'});
    generator=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
  }
  return generator.generate;
}
async function walk(root){
  const files=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    const path=resolve(root,entry.name);
    if(entry.isDirectory()&&!['node_modules','.git'].includes(entry.name))files.push(...await walk(path));
    else if(entry.isFile())files.push(path);
  }
  return files;
}
async function generateShaders(project){
  const generate=await getGenerator(),outputs=new Map();
  for(const dir of project.shaderDirs){
    if(!existsSync(dir))continue;
    for(const path of await walk(dir)){
      if(!path.endsWith('.wgsl'))continue;
      let result;
      try {result=generate(posix(path),await readFile(path,'utf8'));}catch(error){throw Error(`${relative(project.root,path)}: ${error.message}`);}
      if(!result)continue; // Plain WGSL can also be imported as a string.
      const target=resolve(project.generatedDir,relative(project.root,path).replace(/\.(?:strokeMaterial|material|fragFunc|compute)\.wgsl$/,result.suffix));
      outputs.set(target,result.code);
    }
  }
  // Generate the entire set successfully before changing any derived files.
  for(const [path,code] of outputs)await atomicWrite(path,code);
  if(existsSync(project.generatedDir))for(const path of await walk(project.generatedDir))if(path.endsWith('.generated.ts')&&!outputs.has(path))await rm(path);
}

function typecheck(project){
  const config=ts.readConfigFile(project.tsconfig,ts.sys.readFile);
  if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,project.root,{noEmit:true},project.tsconfig);
  const program=ts.createProgram(parsed.fileNames,parsed.options);
  const errors=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
  if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>project.root,getCanonicalFileName:path=>path,getNewLine:()=> '\n'}));
  return program;
}

function checkRuntimeInputs(project,result,program){
  const checker=program.getTypeChecker();
  const forbidden=new Set(['window','document','navigator','fetch','WebSocket','Worker','setInterval','clearInterval','Deno','process','require']);
  for(const input of Object.keys(result.metafile.inputs)){
    const path=resolve(project.root,input);
    if(inside(resolve(repoRoot,'packages/core-timing'),path))throw Error('Bundled core-timing bypasses managed cleanup. Use host.timing (type-only imports are fine).');
    if(/\/babylon(?:GL)?\//.test(posix(path)))throw Error(`Browser/Babylon implementation in bundle: ${input}. Use the raw WebGPU entry point.`);
    const source=program.getSourceFile(path);
    if(!source)continue;
    const visit=node=>{
      if(ts.isTypeNode(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node))return;
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)throw Error(`${input}: runtime import() is unsupported; use static imports.`);
      if(ts.isIdentifier(node)&&forbidden.has(node.text)){
        const symbol=checker.getSymbolAtLocation(node);
        // Locally declared identifiers are ordinary code, not unavailable host APIs.
        if(!symbol||symbol.declarations?.every(d=>d.getSourceFile().isDeclarationFile)){
          if((ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node&&node.parent.expression.getText(source)!=='globalThis')||ts.isPropertyAssignment(node.parent)&&node.parent.name===node)return;
          const {line,character}=source.getLineAndCharacterOfPosition(node.getStart());
          throw Error(`${input}:${line+1}:${character+1}: ${node.text} is unavailable in the TD runtime.`);
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
}

async function bundle(project,entry,alias){
  const dependencies=new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
  const resolver={name:'td-runtime-imports',setup(context){context.onResolve({filter:/.*/},args=>{
    if(args.kind==='entry-point')return;
    if(blockedPackages.has(args.path))return {errors:[{text:blockedPackages.get(args.path)}]};
    if(args.path.startsWith('node:')||dependencies.has(args.path)||/^(?:https?:|jsr:|npm:)/.test(args.path))return {errors:[{text:`Unsupported runtime import ${args.path}; bundle host-independent local/npm code only.`}]};
    const name=Object.keys(alias).sort((a,b)=>b.length-a.length).find(name=>name.endsWith('/')?args.path.startsWith(name):args.path===name);
    if(name)return {path:name.endsWith('/')?resolve(alias[name],args.path.slice(name.length)):alias[name]};
  });}};
  // The TOP evaluates this file with new Function; callbacks must be in that scope.
  const footer=entry.target==='chop'?`
function setup(host) { return __tdSketch.setup?.(host); }
function onCook(host, frame) { return __tdSketch.onCook?.(host, frame); }
const onPulse = __tdSketch.onPulse;
//# sourceURL=td-chop/${entry.name}.js
`:`
if (typeof __tdSketch.draw !== 'function') throw new Error('Sketch must export draw');
function setup(p, host) { return __tdSketch.setup?.(p, host); }
function draw(p, frame) { return __tdSketch.draw(p, frame); }
const onPulse = __tdSketch.onPulse;
//# sourceURL=td-sketch/${entry.name}.js
`;
  return build({absWorkingDir:project.root,entryPoints:[entry.entry],outfile:resolve(project.outDir,entry.name+'.js'),bundle:true,write:false,metafile:true,platform:'neutral',format:'iife',globalName:'__tdSketch',target:'es2022',nodePaths:[modules],mainFields:['module','main'],conditions:['import','default'],loader:{'.wgsl':'text'},plugins:[resolver],footer:{js:footer},logLevel:'silent'});
}

export async function buildProject(project,{log=console.log}={}){
  await prepareTypes(project);
  await generateShaders(project);
  const program=typecheck(project),alias=await aliases();
  const results=[];
  for(const entry of project.entries){
    const result=await bundle(project,entry,alias);checkRuntimeInputs(project,result,program);
    const source=program.getSourceFile(entry.entry);
    const exports=source&&program.getTypeChecker().getExportsOfModule(program.getTypeChecker().getSymbolAtLocation(source));
    if(!exports?.some(symbol=>entry.target==='chop'?['setup','onCook'].includes(symbol.name):symbol.name==='draw'))throw Error(`${entry.entry}: must export ${entry.target==='chop'?'setup or onCook':'draw'}`);
    results.push({entry,result});
  }
  // All entries must validate before publishing. Each replacement is atomic;
  // independent TOPs may observe different revisions for a cook during publication.
  const changed=[];const inputs=new Set([project.configPath,project.tsconfig]);
  for(const {entry,result} of results){
    for(const input of Object.keys(result.metafile.inputs))inputs.add(resolve(project.root,input));
    const contents=result.outputFiles[0].contents;
    if(await atomicWrite(resolve(project.outDir,entry.name+'.js'),contents))changed.push(entry.name);
  }
  await atomicWrite(resolve(project.root,'.td/build.json'),JSON.stringify({entries:results.map(({entry,result})=>({name:entry.name,target:entry.target,outputs:entry.outputs,samples:entry.samples,source:relative(project.root,entry.entry),bundle:relative(project.root,resolve(project.outDir,entry.name+'.js')),sha256:hash(result.outputFiles[0].contents)}))},null,2)+'\n');
  log(changed.length?`Built ${changed.join(', ')}`:'Checked; bundles unchanged');
  return {changed,inputs};
}

export async function watchProject(configPath,{log=console.log,onBuild=()=>{},onFatal=()=>{}}={}){
  let project=await loadProject(configPath),closed=false,running=false,dirty=false,timer,watchError;
  const watchers=new Map();
  const ignored=path=>[project.outDir,project.generatedDir,resolve(project.root,'.td'),resolve(project.root,'node_modules'),resolve(project.root,'.git')].some(dir=>inside(dir,path))||path.endsWith('.tmp')||
    (inside(resolve(repoRoot,'packages'),path)&&relative(resolve(repoRoot,'packages'),path).split(sep).some(part=>['build','artifacts','node_modules','.git'].includes(part)));
  const schedule=()=>{if(closed)return;dirty=true;clearTimeout(timer);timer=setTimeout(run,90);};
  const add=(dir,recursive=false)=>{if(watchers.has(dir))return;const watcher=watch(dir,{recursive},(_,file)=>{if(!file||!ignored(resolve(dir,String(file))))schedule();});watcher.on('error',error=>{
    watchError=Error(`Filesystem watcher stopped: ${error.message}. Check OS access/file limits; restricted macOS sandboxes can block fs.watch.`);
    closed=true;clearTimeout(timer);for(const item of watchers.values())item.close();log(watchError.message);onFatal(watchError);
  });watchers.set(dir,watcher);};
  add(project.root,true);
  // Observe workspace libraries even after a failed first build or a new import.
  add(resolve(repoRoot,'packages'),true);
  await new Promise(resolve=>setImmediate(resolve));if(watchError)throw watchError;
  async function run(){
    if(closed||running)return;running=true;dirty=false;
    try {
      project=await loadProject(configPath);
      const result=await buildProject(project,{log});
      for(const input of result.inputs)if(!inside(project.root,input)&&!inside(resolve(repoRoot,'packages'),input)&&!input.includes('/node_modules/'))add(dirname(input));
      onBuild(null,result);
    }catch(error){log(`Build failed; previous bundles retained.\n${error.message}`);onBuild(error);}
    finally{running=false;if(dirty&&!closed)schedule();}
  }
  await run();log(`Watching ${project.root}`);
  return {async close(){closed=true;clearTimeout(timer);for(const watcher of watchers.values())watcher.close();while(running)await new Promise(resolve=>setTimeout(resolve,10));}};
}
