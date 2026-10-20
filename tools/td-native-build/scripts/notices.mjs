import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const tool=resolve(import.meta.dirname,'..');
const metadata=JSON.parse(execFileSync('cargo',['+1.99.1','metadata','--locked','--format-version','1','--manifest-path',resolve(tool,'Cargo.toml')],{encoding:'utf8',maxBuffer:32*1024*1024}));
const blocks=['avTools native build service third-party notices.\nDependency versions are locked in Cargo.lock.\n'];
for(const p of metadata.packages.sort((a,b)=>a.name.localeCompare(b.name))){
 if(p.name==='avtools-build')continue;
 blocks.push(`\n===== ${p.name} ${p.version} (${p.license??'see license file'}) =====\n${p.repository??''}\n`);
 const folder=dirname(p.manifest_path);let found=false;
 for(const name of readdirSync(folder)){if(/^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(name)){try{blocks.push(readFileSync(resolve(folder,name),'utf8'));found=true;}catch{}}}
 if(!found&&p.name.startsWith('tsrs_'))blocks.push(readFileSync(resolve(tool,'vendor/tsrs/LICENSE'),'utf8'));
 if(!found&&p.license_file)blocks.push(readFileSync(resolve(folder,p.license_file),'utf8'));
}
blocks.push('\n===== TypeScript standard library attribution =====\n',readFileSync(resolve(tool,'vendor/tsrs/NOTICE'),'utf8'));
blocks.push('\n===== wgsl_reflect (embedded shader generators) =====\n',readFileSync(resolve(tool,'../td-sketch-build/node_modules/wgsl_reflect/LICENSE.md'),'utf8'));
writeFileSync(resolve(tool,'assets/THIRD_PARTY_NOTICES.txt'),blocks.join('\n'));
