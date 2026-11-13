from pathlib import Path
import json,time,statistics
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/declared-parameters'
b=op('/project1/parameter_example');top=b.op('picture');chop=b.op('channels')
for n in [top,chop]:n.cook(force=True);assert not n.errors(),n.errors();assert n.currentPage is not None
assert top.par.Size.eval()==70 and top.par.Shape.eval()=='circle'
assert chop.par.Gain.eval()==1 and chop.par.Duration.eval()==1
# Same-cook reads of edits: no frame advancement or asynchronous yield.
n=op('/avtools_declared_parameters/channels');samples=[]
for i in range(300):
 value=(i%15)+1;n.par.Speed=value;start=time.perf_counter();n.cook(force=True);samples.append((time.perf_counter()-start)*1000);assert float(n['speed'][0])==value
n.par.Speed=6
samples.sort()
# Persist an operator with an unavailable source. Its stored controls must restore.
c=op('/').loadTox(str(OUT/'Parameters.tox'));c.name='avtools_parameters_missing_source'
for node in [c.op('channels'),c.op('buffered'),c.op('picture')]:node.par.Typescript=str(OUT/'missing.ts');node.cook(force=True)
c.save(str(OUT/'Missing.tox'))
r=op('/').loadTox(str(OUT/'Missing.tox'));r.name='avtools_parameters_missing_reopened'
assert r.op('channels').par.Speed.eval()==7 and r.op('picture').par.Later.eval()==11
# Save the useful example with compiled controls present; pulse/timer test follows.
b.save(str(ROOT/'native/td/parameter-example/Parameters.tox'))
chop.par.Trigger.pulse();chop.cook(force=True)
result={'schema_loaded':True,'saved':True,'missing_source_controls_restored':True,'same_cook_edits':300,'cook_ms_median':statistics.median(samples),'cook_ms_p95':samples[int(len(samples)*.95)]}
def verify_missing_later():
 for node in [r.op('channels'),r.op('buffered'),r.op('picture')]:
  node.cook(force=True)
  assert node.par.Speed.eval()==7 and node.par.Later.eval()==11
 result['missing_source_after_30_frames']=True
 (OUT/'example-results.json').write_text(json.dumps(result,indent=2))
 print('DELAYED MISSING-SOURCE CHECK PASSED')
run('args[0]()',verify_missing_later,delayFrames=30)
print('EXAMPLE SAVED; SAME-COOK EDITS PASS',statistics.median(samples),samples[int(len(samples)*.95)])
