from pathlib import Path
import tempfile,time,json
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=parent();pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
folder=Path(tempfile.mkdtemp(prefix='avtools-reload-'))
records=[];nodes=[]
def make(name,typ,marker):
 n=root.create(typ,name);n.par.plugin=str(pre/(pre/marker).read_text().strip());n.cook(force=True)
 info=root.create(infoDAT,'info_'+name);info.par.op=name
 return n
first=make('first',cplusplusCHOP,'current-chop.txt');first.par.Templatedir=str(folder);first.par.Createtemplate.pulse();first.par.Autoreload=False
second=make('second',cplusplusCHOP,'current-chop.txt');second.par.Outputchannels='value ticks';second.par.Typescript=first.par.Typescript.eval()
source=Path(first.par.Typescript.eval())
def code(version,fail=False):
 return '''import {launch} from '@avtools/core-timing';
let ticks=0;
export function setup(h:any){%s launch(async c=>{while(true){h.outputs.set('ticks',++ticks);await c.waitSec(.01);}}).catch(console.error);}
export function onCook(h:any){h.outputs.set('value',%s);}
''' % ("throw Error('intentional activation failure');" if fail else '',version)
source.write_text(code(1));nodes=[first,second]
dat=root.create(textDAT,'top_source');dat.text="if(globalThis.old)throw Error('stale global');globalThis.old=1;function draw(p){p.background(255,0,0)}"
top=make('top',cplusplusTOP,'current.txt');top.par.Sketch=dat.path;top.par.Autoreload=False;top.par.Width=1920;top.par.Height=1080
early=make('early',cplusplusTOP,'current.txt');early.par.Sketch=dat.path;early.par.Pretrigger=True;early.par.Width=1920;early.par.Height=1080
stage=0;started=time.perf_counter();last_ticks=0;bad_generations=None

def state(n):
 info=root.op('info_'+n.name);info.cook(force=True);return info.text

def value(n,c):return float(n[c][0]) if n.numChans else -1

def finish(passed,error=''):
 me.par.active=False
 result={'passed':passed,'stage':stage,'error':error,'records':records,'plugins':[(pre/m).read_text().strip() for m in ['current.txt','current-chop.txt']]}
 (repo/'packages/native-webgpu/test/restart/td-result.json').write_text(json.dumps(result,indent=2));print('PASS' if passed else 'FAIL','reload verification',error)

def onFrameStart(frame):
 global stage,started,last_ticks,bad_generations
 try:
  for n in nodes:n.cook(force=True)
  top.cook(force=True);early.par.Pretriggerpulse.pulse();early.cook(force=True);early.cook(force=True)
  texts=[state(n) for n in nodes];values=[value(n,'value') for n in nodes];ticks=[value(n,'ticks') for n in nodes];elapsed=time.perf_counter()-started
  ready=all('build_state\tready' in t for t in texts)
  ok=False
  if stage==0:ok=ready and values==[1,1] and min(ticks)>20 and not top.errors() and not early.errors()
  elif stage==1:ok=ready and values==[1,2] and 'Pending Reload' in texts[0] and ticks[0]>last_ticks
  elif stage==2:ok=values==[1,2] and ticks[0]>=3
  elif stage==3:ok=ready and values==[2,2]
  elif stage==4:ok=all('build_state\terror' in t for t in texts) and values==[2,2] and min(ticks)>last_ticks
  elif stage==5:ok='intentional activation failure' in second.errors() and values[0]==2
  elif stage==6:ok='intentional activation failure' in first.errors() and 'intentional activation failure' in second.errors() and elapsed>.3
  elif stage==7:ok=ready and values==[4,4] and not any(n.errors() for n in nodes)
  elif stage==8:ok=elapsed>.8 and values==[4,4]
  elif stage==9:ok=ready and values==[5,5]
  elif stage==10:ok=values==[5,5] and 'Pending Reload' in texts[0] and elapsed>.3
  elif stage==11:ok=values==[9,5]
  elif stage==12:ok=elapsed>.4 and not top.errors() and not early.errors()
  if ok:
   records.append({'stage':stage,'values':values,'ticks':ticks,'elapsed_ms':elapsed*1000,'states':texts,'errors':[n.errors() for n in nodes]})
   stage+=1;started=time.perf_counter()
   if stage==1:last_ticks=ticks[0];source.write_text(code(2))
   elif stage==2:
    first.par.Reset.pulse();first.cook(force=True);assert value(first,'value')==1 and value(first,'ticks')<=2,'Reset adopted new source or kept old timers'
   elif stage==3:first.par.Reload.pulse()
   elif stage==4:
    first.par.Reload.pulse();first.cook(force=True);assert value(first,'ticks')<=2,'Unchanged Reload did not restart';last_ticks=min(value(first,'ticks'),ticks[1]);source.write_text(code(2)+'missingFunction();')
   elif stage==5:source.write_text(code(3,True))
   elif stage==6:first.par.Reload.pulse()
   elif stage==7:source.write_text(code(4));first.par.Autoreload=True
   elif stage==8:
    for n in nodes:n.par.Autobuild=False;n.cook(force=True)
    source.write_text(code(5))
   elif stage==9:first.par.Buildproject.pulse()
   elif stage==10:
    other=folder/'sketches/other.ts';other.write_text(code(9));first.par.Autoreload=False;first.par.Typescript=str(other)
   elif stage==11:first.par.Reload.pulse()
   elif stage==12:
    dat.text="if(globalThis.old)throw Error('stale global');globalThis.old=1;function draw(p){p.background(0,0,255)}"
    top.cook(force=True);assert 'Pending Reload' in state(top);top.par.Reset.pulse();top.cook(force=True);top.par.Reload.pulse()
   else:finish(True)
  elif elapsed>20:raise RuntimeError(str({'stage':stage,'values':values,'states':texts,'errors':[n.errors() for n in nodes],'tops':[top.errors(),early.errors()]}))
 except Exception as e:finish(False,str(e))
