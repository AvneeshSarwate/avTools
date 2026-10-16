import {runPortableSpecification} from '../../../core-timing/spec/runner.ts';
import {runFrameSpecification} from '../../../core-timing/spec/frames.ts';
import {runAllTimingTests, runAllInvariantTests} from '../../../core-timing/timing_tests.ts';
const g = globalThis as any;
g.done = false;
(async () => {
  const start = performance.now();
  const traces=await runPortableSpecification();
  await runFrameSpecification();
  console.log(JSON.stringify({suite:"portable-traces",traces}));
  const timing = await runAllTimingTests();
  await runAllInvariantTests();
  console.log(JSON.stringify({suite:'timecontext',host:g.Deno?.version?.deno ?? g.process?.version ?? g.navigator?.userAgent ?? 'embedded V8 (native-manifest.json)',cases:timing.map(x=>x.name),elapsedMs:performance.now()-start,pass:true}));
})().catch(error=>{g.failure=String(error?.stack??error);console.error(g.failure);if(g.process)g.process.exitCode=1;}).finally(()=>{g.done=true;});
