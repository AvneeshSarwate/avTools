// Developer-only C ABI integration tests; the distributed tool needs no compiler.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const tool=resolve(import.meta.dirname,'..');
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(tool,'target/release/avtools-build');
const library=resolve(dirname(binary),'libavtools_build.dylib');
const temporary=mkdtempSync('/private/tmp/avtools-native-hosts-');
try {
 const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
 const compile=name=>{
  const executable=resolve(temporary,name);
  execFileSync('clang++',['-std=c++17','-isysroot',sdk,'-isystem',resolve(sdk,'usr/include/c++/v1'),resolve(tool,'tests',name+'.cpp'),'-L'+dirname(library),'-lavtools_build','-Wl,-rpath,'+dirname(library),'-o',executable],{stdio:'inherit'});
  return executable;
 };
 const project=resolve(temporary,'project');execFileSync(binary,['init',project],{stdio:'inherit'});copyFileSync(resolve(tool,'tests/legacy-project.json'),resolve(project,'avtools.json'));
 execFileSync(compile('c-host'),[project],{stdio:'inherit'});
 execFileSync(compile('entry-host'),[resolve(temporary,'entry-project')],{stdio:'inherit'});
 execFileSync(compile('file-host'),[resolve(temporary,'source.js').replace('/private/tmp/','/tmp/')],{stdio:'inherit'});
 const second=resolve(temporary,'libsecond_build.dylib');copyFileSync(library,second);
 execFileSync('install_name_tool',['-id',second,second]);
 execFileSync('codesign',['--force','--sign','-',second],{stdio:'inherit'});
 execFileSync(compile('two-libraries'),[library,second,project],{stdio:'inherit'});
 if(process.argv.includes('--soak'))execFileSync(compile('service-soak'),[project,'200'],{stdio:'inherit'});
} finally {rmSync(temporary,{recursive:true,force:true});}
