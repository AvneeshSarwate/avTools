import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)), out=resolve(root,'artifacts/parameters');
const pre=resolve(root,'prebuilt/macos-arm64');
const declarations=`#include <fstream>
static void probeParameters(TD::OP_ParameterManager* m){
 int version=1;std::ifstream("${out}/schema.txt")>>version;
 for(const char* name:{"Probespeed","Probeexpr","Probeexport","Probebind"}) {TD::OP_NumericParameter p;p.name=name;p.label=name;p.page="Declared";p.defaultValues[0]=version;p.minSliders[0]=0;p.maxSliders[0]=version==1?10:100;m->appendFloat(p);}
 TD::OP_NumericParameter p;p.name=version==1?"Probegone":"Probeadded";p.label=p.name;p.page="Declared";p.defaultValues[0]=9;m->appendFloat(p);
}
`;
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
for(const [kind,marker,name,header] of [['CHOP','current-chop.txt','AvToolsChannels','CHOP'],['TOP','current.txt','AvToolsSketch','CPUMemoryTOP']]){
 const source=readFileSync(resolve(root,`native/td/Sketch${kind}.cpp`),'utf8').replace('using namespace TD;','using namespace TD;\n'+declarations).replace('void setupParameters(OP_ParameterManager* manager,void*)override{','void setupParameters(OP_ParameterManager* manager,void*)override{probeParameters(manager);');
 const cpp=resolve(out,`RuntimeProbe${kind}.cpp`);writeFileSync(cpp,source);
 const bundle=resolve(out,name+'.plugin');cpSync(resolve(pre,readFileSync(resolve(pre,marker),'utf8').trim()),bundle,{recursive:true,verbatimSymlinks:true});
 const mac=bundle+'/Contents/MacOS';
 execFileSync('clang++',['-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','-std=c++17','-O2','-fvisibility=hidden','-bundle','-arch','arm64','-mmacosx-version-min=15.0','-I/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/'+header,'-I'+resolve(root,'native/td'),cpp,'-L'+mac,'-lavtools_runtime','-o',mac+'/'+name],{stdio:'inherit'});
 execFileSync('codesign',['--force','--sign','-',bundle],{stdio:'inherit'});
}
cpSync(pre+'/native-build',out+'/native-build',{recursive:true,verbatimSymlinks:true});
