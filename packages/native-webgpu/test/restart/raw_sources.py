from pathlib import Path
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=op('/project1').create(baseCOMP,'reload_raw_test');root.nodeX=2000
runner=root.create(executeDAT,'verify');runner.par.active=False;runner.par.framestart=True
runner.text='''from pathlib import Path
import tempfile,time,json
root=parent();repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir());pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
folder=Path(tempfile.mkdtemp(prefix='avtools-raw-'));file=folder/'source.js'
def code(v):return "function onCook(h){h.outputs.set('out',%d)}"%v
file.write_text(code(1));node=root.create(cplusplusCHOP,'file');node.par.plugin=str(pre/(pre/'current-chop.txt').read_text().strip());node.cook(force=True);node.par.Sourcefile=str(file);node.par.Autoreload=False
info=root.create(infoDAT,'info');info.par.op=node.name
dat=root.create(textDAT,'source');dat.text="function draw(p){p.background(255,0,0)}"
top=root.create(cplusplusTOP,'top');top.par.plugin=str(pre/(pre/'current.txt').read_text().strip());top.cook(force=True);top.par.Sketch=dat.path;top.par.Samecook=True;top.par.Autoreload=False
stage=0;started=time.perf_counter();records=[]
def onFrameStart(frame):
 global stage,started,file
 try:
  node.cook(force=True);top.cook(force=True);info.cook(force=True);v=float(node['out'][0]) if node['out'] is not None else -1;elapsed=time.perf_counter()-started
  expected=[1,1,2,2,2,4,4,4,None,5][min(stage,9)]
  ok=elapsed>.2 and (v==expected if expected is not None else bool(node.errors()))
  if stage in (1,3,4):ok=ok and 'Pending Reload' in info.text
  if stage==6:ok=ok and bool(node.warnings())
  if stage==8:ok=ok and 'SyntaxError' in node.errors() and bool(top.errors())
  if ok:
   records.append({'stage':stage,'value':v,'errors':node.errors(),'state':info.text})
   stage+=1;started=time.perf_counter()
   if stage==1:file.write_text(code(2))
   elif stage==2:node.par.Reload.pulse()
   elif stage==3:file.write_text(code(3));node.par.Reset.pulse()
   elif stage==4:
    other=folder/'other.js';other.write_text(code(4));node.par.Sourcefile=str(other);file=other
   elif stage==5:node.par.Reload.pulse()
   elif stage==6:file.unlink()
   elif stage==7:file.write_text(code(4));node.par.Autoreload=True
   elif stage==8:
    file.write_text('function onCook( broken');dat.text='function draw( broken';top.par.Reload.pulse()
   elif stage==9:
    file.write_text(code(5));dat.text='function draw(p){p.background(0,0,255)}';top.par.Autoreload=True
   else:
    pixel=top.numpyArray(delayed=False)[0,0].tolist();assert pixel[2]>.99 and pixel[0]<.01,pixel
    (repo/'packages/native-webgpu/test/restart/raw-result.json').write_text(json.dumps({'passed':True,'records':records,'final_pixel':pixel},indent=2));me.par.active=False;print('PASS raw file and DAT reload/error/recovery controls')
  elif elapsed>15:raise RuntimeError(str({'stage':stage,'value':v,'state':info.text,'error':node.errors(),'warnings':node.warnings(),'top':top.errors()}))
 except Exception as e:
  (repo/'packages/native-webgpu/test/restart/raw-result.json').write_text(json.dumps({'passed':False,'stage':stage,'records':records,'error':str(e)},indent=2));me.par.active=False;print('FAIL raw sources',str(e))
'''
runner.par.active=True
