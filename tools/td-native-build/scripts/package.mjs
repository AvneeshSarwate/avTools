import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..'),tool=resolve(root,'tools/td-native-build');
const profile=process.argv.includes('--dev')?'debug':'release';
const source=resolve(tool,'target',profile,'libavtools_build.dylib');
// CLI assets can change independently of the shared library (e.g. init templates).
const hash=createHash('sha256').update(readFileSync(source)).update(readFileSync(resolve(tool,'target',profile,'avtools-build'))).digest('hex').slice(0,12);
const dest=resolve(root,'packages/native-webgpu/prebuilt/macos-arm64/native-build',hash);mkdirSync(dest,{recursive:true});
for(const name of ['libavtools_build.dylib','avtools-build']){const target=resolve(dest,name);if(!existsSync(target)){copyFileSync(resolve(tool,'target',profile,name),target);execFileSync('codesign',['--force','--sign','-',target],{stdio:'inherit'});}}
copyFileSync(resolve(tool,'assets/THIRD_PARTY_NOTICES.txt'),resolve(dest,'THIRD_PARTY_NOTICES.txt'));
writeFileSync(resolve(dest,'VERSION'),`avtools-build 0.1.0\ntsrs 280b426b89cd4ecd6153cf48228826bd60a99c61\nrolldown 1.2.14\nprofile ${profile}\n`);
writeFileSync(resolve(root,'packages/native-webgpu/prebuilt/macos-arm64/native-build/current.txt'),hash+'\n');
console.log(dest);
