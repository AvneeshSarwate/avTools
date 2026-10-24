import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,symlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const dawn=resolve(root,'upstream/node-webgpu/third_party/dawn');
const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,stdio:'inherit'});
const out=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,encoding:'utf8'}).trim();
const manifest=JSON.parse(readFileSync(resolve(root,'native-manifest.json'),'utf8'));
if(out('git',['rev-parse','HEAD'],dawn)!==manifest.dawn)throw new Error('Unexpected Dawn revision');
if(process.argv[2]==='fetch') {
  const config=readFileSync(resolve(dawn,'scripts/standalone-with-node.gclient'),'utf8')
    .replace('"dawn_node": True,','"dawn_node": True,\n            "checkout_v8": True,');
  writeFileSync(resolve(dawn,'.gclient'),config);
  const depot=resolve(dawn,'../depot_tools');
  execFileSync(resolve(depot,'gclient'),['sync','--no-history','--shallow','--nohooks'],{cwd:dawn,stdio:'inherit',env:{...process.env,DEPOT_TOOLS_UPDATE:'0',PATH:depot+':'+process.env.PATH}});
  const archive=resolve(root,'build/clang-pinned.tar.xz');mkdirSync(resolve(root,'build'),{recursive:true});
  const hash=()=>existsSync(archive)?createHash('sha256').update(readFileSync(archive)).digest('hex'):'';
  if(hash()!==manifest.embedding.clangSHA256)run('curl',['-fL',manifest.embedding.clangArchive,'-o',archive]);
  if(hash()!==manifest.embedding.clangSHA256)throw new Error('Pinned Clang archive checksum mismatch');
  const compiler=resolve(dawn,'third_party/llvm-build/Release+Asserts');mkdirSync(compiler,{recursive:true});
  run('tar',['-xJf',archive,'-C',compiler]);
  process.exit(0);
}
if(out('git',['rev-parse','HEAD'],resolve(dawn,'third_party/v8/src'))!==manifest.embedding.v8)throw new Error('Fetch the pinned V8 dependencies first');
if(out('git',['rev-parse','HEAD'],resolve(dawn,'build'))!==manifest.embedding.chromiumBuild)throw new Error('Unexpected Chromium build configuration revision');
const napiPatch=resolve(root,'patches/0003-napi-v8-callback-lifetime.patch');
try{execFileSync('git',['apply','--reverse','--check',napiPatch],{cwd:dawn,stdio:'pipe'});}
catch{run('git',['apply',napiPatch],dawn);}
// Apply incremental event-loop patches in order. A later patch may overlap an
// earlier one, so first detect the latest applied state.
const retirementPatch=resolve(root,'patches/0006-embedded-environment-retirement.patch');
let retiredPatched=false;
try{execFileSync('git',['apply','--reverse','--check',retirementPatch],{cwd:dawn,stdio:'pipe'});retiredPatched=true;}catch{}
if(!retiredPatched){
const timerPatch=resolve(root,'patches/0005-embedded-timer-deadlines.patch');
try{execFileSync('git',['apply','--reverse','--check',timerPatch],{cwd:dawn,stdio:'pipe'});}
catch{
  const eventPatch=resolve(root,'patches/0004-embedded-event-driven-wait.patch');
  try{execFileSync('git',['apply','--reverse','--check',eventPatch],{cwd:dawn,stdio:'pipe'});}
  catch{run('git',['apply',eventPatch],dawn);}
  run('git',['apply',timerPatch],dawn);
}
run('git',['apply',retirementPatch],dawn);
}
const patch=resolve(root,'patches/embedding-clt-sdk.patch');
try{execFileSync('git',['apply','--reverse','--check',patch],{cwd:resolve(dawn,'build'),stdio:'pipe'});}
catch{run('git',['apply',patch],resolve(dawn,'build'));}
run(process.execPath,[resolve(root,'scripts/libuv.mjs')]);
const target=resolve(dawn,'avtools/embedded');mkdirSync(target,{recursive:true});cpSync(resolve(root,'native/embedded'),target,{recursive:true});
writeFileSync(resolve(target,'Polyfills.h'),'static const char* kPolyfills = R"AVTOOLS('+readFileSync(resolve(root,'native/embedded/polyfills.js'),'utf8')+')AVTOOLS";\n');
cpSync(resolve(root,'build/syphon-embedded/AvToolsSyphonPrefix.h'),resolve(target,'AvToolsSyphonPrefix.h'));
for(const name of ['dawn_syphon.mm','text_addon.cpp','text_engine.h'])cpSync(resolve(root,'native',name),resolve(target,name));
const stagedGN=resolve(target,'BUILD.gn');
writeFileSync(stagedGN,readFileSync(stagedGN,'utf8').replaceAll('@SYPHON_INCLUDE@',resolve(root,'build/syphon-embedded/include')).replaceAll('@SYPHON_LIBRARY@',resolve(root,'build/syphon-embedded/AVToolsSyphon.framework/Versions/A/AVToolsSyphon')).replaceAll('@SYPHON_FRAMEWORK_DIR@',resolve(root,'build/syphon-embedded')).replaceAll('@LIBUV_INCLUDE@',resolve(root,'build/libuv/libuv-v'+manifest.libuv.version+'/include')).replaceAll('@LIBUV_LIBRARY@',resolve(root,'build/libuv/out/libuv.a')).replaceAll('@RUST_TEXT_LIBRARY@',resolve(root,'../../apps/deno-notebooks/native/text_engine/target/release/libtext_engine.a')));
const top=resolve(dawn,'BUILD.gn');let gn=readFileSync(top,'utf8');
if(!gn.includes('group("avtools_embedding")'))writeFileSync(top,gn+'\n# avTools embedding integration, sources staged from packages/native-webgpu/native/embedded.\ngroup("avtools_embedding") { deps = [ "//avtools/embedded:embedded-probe" ] }\n');
const build=resolve(dawn,'out/avtools-v8');mkdirSync(resolve(build,'sdk'),{recursive:true});
if(!existsSync(resolve(build,'sdk/clt')))symlinkSync(out('xcrun',['--show-sdk-path']),resolve(build,'sdk/clt'));
writeFileSync(resolve(build,'args.gn'),`is_debug = false
is_component_build = false
use_allocator_shim = false
use_partition_alloc_as_malloc = false
target_cpu = "arm64"
dawn_use_swiftshader = false
dawn_enable_vulkan = false
dawn_enable_opengles = false
dawn_enable_desktop_gl = false
dawn_enable_null = false
dawn_enable_webgpu_on_webgpu = false
use_system_xcode = true
clang_use_chrome_plugins = false
use_custom_libcxx = true
use_custom_libcxx_for_host = true
treat_warnings_as_errors = false
mac_deployment_target = "15.0"
mac_sdk_min = "15.0"
avtools_clt_sdk_path = "//out/avtools-v8/sdk/clt"
avtools_clt_sdk_version = "${out('xcrun',['--show-sdk-version'])}"
avtools_clt_sdk_build = "${out('xcrun',['--show-sdk-build-version'])}"
v8_monolithic = true
v8_monolithic_for_shared_library = true
v8_enable_i18n_support = false
v8_use_external_startup_data = false
v8_enable_pointer_compression = false
v8_enable_sandbox = false
v8_enable_webassembly = false
`);
// Chromium's compiler archive omits these two inspection tools; use the installed Apple CLT tools.
for(const name of ['nm','otool']) {const path=resolve(dawn,'third_party/llvm-build/Release+Asserts/bin/llvm-'+name);if(!existsSync(path))symlinkSync(out('xcrun',['--find',name]),path);}
run(resolve(dawn,'buildtools/mac/gn'),['gen',build,`--root=${dawn}`]);
run('ninja',['-C',build,'avtools_embedding','avtools/embedded:avtools_runtime','-j',process.env.AVTOOLS_BUILD_JOBS??'6']);
