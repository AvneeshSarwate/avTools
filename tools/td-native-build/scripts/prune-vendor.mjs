// Retain only compiler crates reachable from this tool's pinned Cargo graph.
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
const tool=resolve(import.meta.dirname,'..'),vendor=resolve(tool,'vendor/tsrs');
const data=JSON.parse(execFileSync('cargo',['+1.99.1','metadata','--locked','--format-version','1','--manifest-path',resolve(tool,'Cargo.toml')],{encoding:'utf8',maxBuffer:32*1024*1024}));
const crates=new Set(data.packages.filter(p=>p.manifest_path.startsWith(vendor+'/crates/')).map(p=>basename(dirname(p.manifest_path))));
for(const dir of readdirSync(resolve(vendor,'crates')))if(!crates.has(dir))rmSync(resolve(vendor,'crates',dir),{recursive:true,force:true});
for(const name of readdirSync(vendor))if(!['crates','assets','Cargo.toml','Cargo.lock','rust-toolchain.toml','LICENSE','NOTICE'].includes(name))rmSync(resolve(vendor,name),{recursive:true,force:true});
const cargo=resolve(vendor,'Cargo.toml');writeFileSync(cargo,readFileSync(cargo,'utf8').replace('members = ["crates/*", "tasks/*"]','members = ["crates/*"]'));
console.log(`Retained ${crates.size} compiler crates`);
