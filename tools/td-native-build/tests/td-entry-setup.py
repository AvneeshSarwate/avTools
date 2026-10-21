"""Run from Textport after opening apps/td-projects/native/project.toe.
Tests template pulses on fresh operators, repeated creation, different entry files,
shared helpers, independent build errors and restoration. Only temporary sources
are edited; saved fixtures are not changed. Leaves an inactive test component.
"""
from pathlib import Path
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=op('/project1').create(baseCOMP,'entry_setup_test')
root.nodeX=1200
callback=root.create(executeDAT,'test')
callback.par.active=False
callback.par.framestart=True
callback.text='''from pathlib import Path
import json,tempfile,time,os
root=parent()
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
temporary=Path(tempfile.mkdtemp(prefix='avtools-setup-'))
records=[]
controls=root.create(constantCHOP,'controls');controls.par.name0='value';controls.par.value0=7
nodes=[]
for kind,marker,typ in [('top','current.txt',cplusplusTOP),('chop','current-chop.txt',cplusplusCHOP)]:
 node=root.create(typ,kind);node.par.plugin=str(prebuilt/(prebuilt/marker).read_text().strip());node.cook(force=True)
 folder=temporary/kind;folder.mkdir();(folder/'show.toe').write_text('existing TD project')
 node.par.Templatedir=os.path.relpath(folder,project.folder) # Exercise TD relative-path expansion too.
 node.par.Createtemplate.pulse();node.cook(force=True)
 assert (folder/'tsconfig.json').exists(),node.warnings()
 assert not (folder/'avtools.json').exists()
 assert Path(node.par.Typescript.eval()).is_file(),node.par.Typescript.eval()
 assert (folder/'show.toe').read_text()=='existing TD project'
 if kind=='chop':
  assert node.par.Outputchannels.eval()=='value ticks'
  assert node.par.Outputsamples.eval()==1
  node.inputConnectors[0].connect(controls)
 snapshot={str(p.relative_to(folder)):p.read_bytes() for p in folder.rglob('*') if p.is_file() and '.avtools' not in p.parts}
 node.par.Createtemplate.pulse();node.cook(force=True)
 assert 'replace' in node.warnings(),node.warnings()
 assert all((folder/p).read_bytes()==data for p,data in snapshot.items())
 node.par.Buildproject.pulse()
 info=root.create(infoDAT,'info_'+kind);info.par.op=node.name
 nodes.append(node)
 records.append({'template':kind,'relative_directory':True,'selected':str(Path(node.par.Typescript.eval()).relative_to(folder)),'preserved_existing_files':True})
# Another entry under the CHOP's tsconfig; use the same helper but different output.
other=temporary/'chop/sketches/other.ts'
other.write_text('import {scale} from "./channels/math.ts";export function onCook(h:any){h.outputs.set("value",scale(h.inputs.get("value"))+100);}')
second=root.create(cplusplusCHOP,'second');second.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip());second.cook(force=True)
second.par.Typescript=os.path.relpath(other,project.folder);second.par.Outputchannels='value ticks';second.inputConnectors[0].connect(controls)
info=root.create(infoDAT,'info_second');info.par.op=second.name
nodes.append(second)
source=temporary/'chop/sketches/channels/main.ts';saved=source.read_text()
helper=temporary/'chop/sketches/channels/math.ts';original_helper=helper.read_text()
started=time.perf_counter();stage=0
def onFrameStart(frame):
 global stage,started
 try:
  values=[];errors=[];states=[]
  for node in nodes:
   node.cook(force=True)
   info=root.op('info_'+node.name);info.cook(force=True);states.append(info.text)
   if node.errors():errors.append([node.name,node.errors()])
   if node.name!='top':values.append(float(node['value'][0]) if node.numChans else None)
  expected=[[14,114],[14,114],[14,121],[21,121],[14,114],[14,114],[14,114]][stage]
  ok=values==expected and not errors
  ok=ok and all(('build_state\\terror' if ((stage in (1,2) and i==1) or (stage==5 and i==2)) else 'build_state\\tready') in text for i,text in enumerate(states))
  if ok:
   records.append({'stage':['ready','isolated_error','shared_helper_edit','repair','restore','relative_entry_missing','relative_entry_repaired'][stage],'values':values,'latency_ms':(time.perf_counter()-started)*1000})
   stage+=1;started=time.perf_counter()
   if stage==1:source.write_text(saved+'\\nmissingFunction();')
   elif stage==2:helper.write_text('export const scale=(v:number)=>v*3;')
   elif stage==3:source.write_text(saved)
   elif stage==4:helper.write_text(original_helper)
   elif stage==5:other.rename(other.with_suffix('.save'))
   elif stage==6:other.with_suffix('.save').rename(other)
   else:
    fixture=op('/project1/native_build_test');checks=[]
    for kind in ('channels','background'):
     for i in range(1,5):
      node=fixture.op(kind+str(i));node.cook(force=True)
      info=fixture.op('build_'+node.name);info.cook(force=True)
      checks.append({'name':node.name,'entry':str(Path(node.par.Typescript.eval()).relative_to(repo/'apps/td-projects/native')),'errors':node.errors(),'state':info.text,'value':float(node['value'][0]) if kind=='channels' else None})
    assert all(not r['errors'] and 'build_state\\tready' in r['state'] for r in checks),checks
    assert [r['value'] for r in checks[:4]]==[14,114,14,114]
    (repo/'tools/td-native-build/tests/results/entry-setup-td.json').write_text(json.dumps({'passed':True,'records':records,'fixture':checks},indent=2))
    me.par.active=False
    print('PASS template buttons, repeated creation, independent entries/shared helpers, and saved multi-entry fixture')
  elif time.perf_counter()-started>20:raise RuntimeError(str({'stage':stage,'values':values,'states':states,'errors':errors}))
 except Exception as e:
  (repo/'tools/td-native-build/tests/results/entry-setup-td.json').write_text(json.dumps({'passed':False,'error':str(e),'records':records},indent=2));me.par.active=False;print('FAIL',str(e))
'''
callback.par.active=True
print('Started template/entry setup verification')
