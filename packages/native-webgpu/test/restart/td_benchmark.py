"""Run in native/project.toe after reloading it. Measures TD CPU including upload calls."""
from pathlib import Path
root=op('/project1/native_build_test')
runner=root.create(executeDAT,'reload_benchmark');runner.par.active=False;runner.par.framestart=True
runner.text='''from pathlib import Path
import time,json
root=parent();samples=[];count=0;last=None
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
def onFrameStart(frame):
 global count,last
 count+=1;start=time.perf_counter();rows=[]
 for kind in ('background','channels'):
  for i in range(1,5):
   n=root.op(kind+str(i))
   if count==90:n.par.Reload.pulse()
   n.cook(force=True)
   rows.append({'name':n.name,'cpu_ms':n.cpuCookTime,'errors':n.errors(),'width':n.width if kind=='background' else None,'height':n.height if kind=='background' else None})
 if count>30:samples.append({'frame':count,'cpu_sum_ms':sum(x['cpu_ms'] for x in rows),'wall_ms':(time.perf_counter()-start)*1000,'rows':rows})
 if count>=240:
  result={'passed':not any(row['errors'] for s in samples for row in s['rows']),'samples':samples}
  (repo/'packages/native-webgpu/test/restart/td-performance.json').write_text(json.dumps(result,indent=2));me.par.active=False;print('PASS TD four-1080p restart/steady timing' if result['passed'] else 'FAIL TD benchmark')
'''
runner.par.active=True
