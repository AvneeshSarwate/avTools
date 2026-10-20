# Executed from TD Textport; creates a fixture-only Execute DAT.
from pathlib import Path
root=op('/native_build_test') or op('/project1/native_build_test')
callback=root.create(executeDAT,'benchmark')
callback.par.framestart=True
callback.par.active=False
callback.text='''from pathlib import Path
import json,time
root=parent()
projectdir=Path(root.op('channels1').par.Projectdir.eval())
repo=next(p for p in (projectdir,*projectdir.parents) if (p/'packages/native-webgpu/prebuilt').is_dir())
source=projectdir/'sketches/channels/math.ts'
original=source.read_text()
count=0
last=None
samples=[]
changes=[]
pending=None
stage='baseline'
def onFrameStart(frame):
 global count,last,stage,pending
 count+=1
 now=time.perf_counter()
 if count in (180,360,540,720):
  stage={180:'edit',360:'error',540:'recover',720:'restore'}[count]
  code={180:'export const scale = (value:number):number => value * 3;\\n',360:'export const scale = (value:number):number => "bad";\\n',540:'export const scale = (value:number):number => value * 4;\\n',720:original}[count]
  temporary=source.with_suffix('.save');temporary.write_text(code);temporary.replace(source)
  changes.append({'stage':stage,'start':now});pending=changes[-1]
 costs={};values=[];errors=[];infos=[]
 for kind in ('channels','background'):
  for i in range(1,5):
   node=root.op(kind+str(i));node.cook(force=True)
   costs[kind+str(i)]=node.cpuCookTime
   if node.errors():errors.append([node.name,node.errors()])
   if kind=='channels':values.append(float(node['value'][0]) if node.numChans else None)
 root.op('build_channels1').cook(force=True)
 infos=[root.op('build_channels1').text]
 if pending:
  expected={'edit':21,'error':21,'recover':28,'restore':14}[stage]
  acknowledged=all(v==expected for v in values) and (('build_state\\terror' in infos[0]) if stage=='error' else 'build_state\\tready' in infos[0])
  if acknowledged:pending['latency_ms']=(now-pending['start'])*1000;pending=None
 if count>60:samples.append({'frame':count,'stage':stage,'frame_ms':(now-last)*1000 if last else 0,'cpu_ms':costs,'values':values,'errors':errors})
 last=now
 if count>=900:
  source.write_text(original)
  (repo/'packages/native-webgpu/artifacts/native-build-benchmark.json').write_text(json.dumps({'changes':changes,'samples':samples},indent=2))
  me.par.active=False
 return
'''
callback.par.active=True
print('Benchmark started (900 frames)')
