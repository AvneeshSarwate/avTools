import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'artifacts/parameters');
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
for(const name of process.argv.includes('--storage-only')?['StorageProbe']:['BootstrapProbe','StorageProbe']){
 const bundle=resolve(out,name+'.plugin');mkdirSync(bundle+'/Contents/MacOS',{recursive:true});
 writeFileSync(bundle+'/Contents/Info.plist',`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string><key>CFBundleIdentifier</key><string>org.avtools.${name.toLowerCase()}</string><key>CFBundlePackageType</key><string>BNDL</string></dict></plist>`);
 execFileSync('clang++',['-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','-std=c++17','-O2','-bundle','-arch','arm64','-mmacosx-version-min=15.0','-I/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CHOP','-I'+resolve(root,'native/td'),'-DPROBE_LOG="'+out+'/'+name+'.jsonl"',resolve(root,'test/parameters/'+name+'.cpp'),'-o',bundle+'/Contents/MacOS/'+name],{stdio:'inherit'});
 execFileSync('codesign',['--force','--sign','-',bundle],{stdio:'inherit'});
}
