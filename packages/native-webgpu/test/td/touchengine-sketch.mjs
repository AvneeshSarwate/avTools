import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function run(index){const child=spawn(resolve(root,'build/touchengine-probe'),[resolve(root,'artifacts/td/sketch-operators.tox'),'90','--sketch'],{cwd:root});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>child.kill('SIGTERM'),60000);const [code]=await once(child,'exit');clearTimeout(timer);writeFileSync(resolve(root,`artifacts/td/sketch-engine-${index}.log`),stderr);writeFileSync(resolve(root,`artifacts/td/sketch-engine-${index}.jsonl`),stdout);assert.equal(code,0,stderr);const records=stdout.trim().split('\n').map(JSON.parse);const counts=[];for(let i=0;i<2;i++){const samples=records.filter(r=>r.output===`op/out${i+1}`&&r.width===191+i*16&&r.height===79+i*8);assert(samples.length>60);for(const r of samples){const rgba=r.pixelFormat===80?[r.center[2],r.center[1],r.center[0],r.center[3]]:r.center;assert.equal(rgba[0],r.frame<45?40:90,JSON.stringify(r));assert.equal(rgba[1],80);assert.equal(rgba[3],255);}counts.push(samples.length);}return {instance:index,validFrames:counts};}
const results=await Promise.all([run('a'),run('b')]);results.push(await run('reload'));writeFileSync(resolve(root,'artifacts/td/sketch-engine-result.json'),JSON.stringify({passed:true,results},null,2));console.log(results);
