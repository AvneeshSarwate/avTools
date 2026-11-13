// Real TouchEngine process, no editor or preview window. Requires paid TD license.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const sender=spawn(process.execPath,['test/td/sender.mjs'],{cwd:root,stdio:['ignore','ignore','inherit']});
const deadline=setTimeout(()=>{sender.kill();throw new Error('TouchEngine test timeout');},90000);
async function run(index) {
  const child=spawn(`${root}/build/touchengine-probe`,[`${root}/artifacts/td/syphon-receivers.tox`,'180'],{cwd:root});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const [code]=await once(child,'exit');
  await writeFile(`${root}/artifacts/touchengine-${index}.log`,stderr);
  await writeFile(`${root}/artifacts/touchengine-${index}.jsonl`,stdout);
  assert.equal(code,0,stderr);
  const samples=stdout.trim().split('\n').map(JSON.parse);
  const counts=[];
  for(let i=0;i<3;i++) {
    const frames=samples.filter(s=>s.output===`op/out${i+1}`&&s.width===320+i*80&&s.height===240+i*40);
    assert(frames.length>=60,`Receiver ${i} has only ${frames.length} valid frames`);
    for(const s of frames) {
      const rgba=s.pixelFormat===80?[s.corner[2],s.corner[1],s.corner[0],s.corner[3]]:s.corner;
      assert.deepEqual(rgba,[20+i*50,30,70,255]);
    }
    counts.push(frames.length);
  }
  return {instance:index,validFrames:counts};
}
try {
  // Start receivers after the initial server announcement to exercise discovery.
  await delay(1000);
  const results=await Promise.all([run('a'),run('b')]);
  results.push(await run('reconnected'));
  console.log(JSON.stringify({passed:true,results}));
  await writeFile(`${root}/artifacts/touchengine-result.json`,JSON.stringify({passed:true,results},null,2));
} finally {clearTimeout(deadline);sender.kill('SIGTERM');await once(sender,'exit');}
