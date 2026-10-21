// Developer validation; compiles a selected entry then exercises it in embedded V8.
// Usage: node native-runtime.mjs ENTRY.ts top|chop ["output channels"] [samples]
import {existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {checkProject} from '../../td-sketch-build/verify.mjs';
const file=process.argv[2],target=process.argv[3];
if(!file||!['top','chop'].includes(target))throw Error('Usage: native-runtime.mjs ENTRY.ts top|chop ["output channels"] [samples]');
const entry=resolve(file);let root=dirname(entry);
while(!existsSync(resolve(root,'tsconfig.json'))){const parent=dirname(root);if(parent===root)throw Error('No enclosing tsconfig.json');root=parent;}
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(import.meta.dirname,'../target/release/avtools-build');
execFileSync(binary,['build-file',entry,target],{stdio:'inherit'});
const key=createHash('sha256').update(relative(root,entry)+'\n'+target).digest('hex').slice(0,20);
await checkProject({root,outDir:resolve(root,'.avtools/entries',key),entries:[{name:'sketch',target,outputs:(process.argv[4]??'out').split(/\s+/),samples:Number(process.argv[5]??1)}]});
