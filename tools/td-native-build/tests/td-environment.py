"""Run from TD Textport after opening apps/td-projects/native/project.toe.
Exercises the real shared compiler and four TOP/CHOP instances using a temporary
copy. Restores every TypeScript File before completion; leaves the inactive test
DAT for inspection. Result: tools/td-native-build/tests/results/environment-td.json.
"""
root = op('/project1/native_build_test')
callback = root.op('environment_check') or root.create(executeDAT, 'environment_check')
callback.par.active = False
callback.par.framestart = True
callback.text = '''from pathlib import Path
import json,time,tempfile,shutil
root=parent()
nodes=[root.op(kind+str(i)) for kind in ('channels','background') for i in range(1,5)]
originals={n.name:n.par.Typescript.eval() for n in nodes}
original=Path(originals['channels1']).parents[2]
repo=next(p for p in (original,*original.parents) if (p/'tools/td-native-build').is_dir())
temporary=Path(tempfile.mkdtemp(prefix='avtools-environment-'))
shutil.copytree(original,temporary,dirs_exist_ok=True,ignore=shutil.ignore_patterns('.avtools','dist','node_modules','Backup','*.toe','*.tox'))
for name in ('earcut','@types/earcut'):
 shutil.copytree(repo/'packages/native-webgpu/node_modules'/name,temporary/'node_modules'/name)
source=temporary/'sketches/channels/math.ts'
saved=source.read_text()
for node in nodes:node.par.Typescript=str(temporary/Path(originals[node.name]).relative_to(original))
stage=0
started=time.perf_counter()
records=[]
def finish(error=None):
 for node in nodes:node.par.Typescript=originals[node.name]
 result={'passed':error is None,'error':error,'stages':records}
 (repo/'tools/td-native-build/tests/results/environment-td.json').write_text(json.dumps(result,indent=2))
 me.par.active=False
 # Keep temporary data for debugging failures; successful inputs are disposable.
 if error is None:shutil.rmtree(temporary)
 print('TD environment verification:',result)
def onFrameStart(frame):
 global stage,started
 try:
  values=[];errors=[];costs={}
  for node in nodes:
   node.cook(force=True);costs[node.name]=node.cpuCookTime
   if node.errors():errors.append([node.name,node.errors()])
   if node.name.startswith('channels'):values.append(float(node['value'][0]) if node.numChans else None)
  info=root.op('build_channels1');info.cook(force=True);text=info.text
  expected=[14,42,42,14,14][stage]
  state='error' if stage==2 else 'ready'
  ready=all(value==expected+(100 if i%2 else 0) for i,value in enumerate(values)) and ('build_state\\t'+state in text)
  if stage==2:ready=ready and 'fetch' in text
  if ready and not errors:
   records.append({'stage':['baseline','npm_import','type_error_last_good','repair','restore_project'][stage],'values':values,'cpu_ms':costs,'latency_ms':(time.perf_counter()-started)*1000,'info':text})
   stage+=1;started=time.perf_counter()
   if stage==1:source.write_text('import earcut from "earcut"; export const scale=(value:number):number=>value*earcut([0,0,1,0,1,1,0,1]).length;')
   elif stage==2:source.write_text('export const scale=(value:number):number=>{fetch("https://example.invalid");return value;};')
   elif stage==3:source.write_text(saved)
   elif stage==4:
    for node in nodes:node.par.Typescript=originals[node.name]
   else:finish()
  elif time.perf_counter()-started>20:finish({'stage':stage,'values':values,'errors':errors,'info':text})
 except Exception as error:finish(str(error))
'''
callback.par.active = True
print('Environment verification started; source project remains unchanged.')
