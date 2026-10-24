from pathlib import Path
import json,time,traceback
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/parameters'
b=parent();records=[];stage=0;started=time.perf_counter();nodes=[]
(OUT/'schema.txt').write_text('1\n')
for name,typ,plugin in [('runtime_chop',cplusplusCHOP,'AvToolsChannels'),('runtime_top',cplusplusTOP,'AvToolsSketch')]:
 n=b.create(typ,name);n.par.plugin=str(OUT/(plugin+'.plugin'));n.cook(force=True)
 n.par.Templatedir=str(OUT/name);n.par.Createtemplate.pulse();n.cook(force=True)
 n.par.Probespeed=7;n.par.Probeexpr.expr='2 + 3';n.par.Probebind.bindExpr='parent().par.Master'
 e=b.create(constantCHOP,'export_'+name);e.par.name0=name+':Probeexport';e.par.value0=13
 menu=e.par.exportmethod;menu.val=next(v for v,label in zip(menu.menuNames,menu.menuLabels) if 'Path' in label);e.export=True;e.cook(force=True)
 if name=='runtime_top':n.par.Width=64;n.par.Height=64;n.par.Samecook=True
 else:n.par.Outputchannels='value ticks pulses'
 info=b.create(infoDAT,'info_'+name);info.par.op=n.name
 nodes.append(n)
chop,top=nodes
source=Path(chop.par.Typescript.eval());topSource=Path(top.par.Typescript.eval())
def code(version):
 return '''import {launch} from '@avtools/core-timing';
export const parameters = {Speed:{type:'float',default:%d}};
let ticks=0,pulses=0;
export function setup(h:any){launch(async c=>{while(true){h.outputs.set('ticks',++ticks);await c.waitSec(.01);}});}
export function onCook(h:any){h.outputs.set('value',parameters.Speed.default);h.outputs.set('pulses',pulses);}
export function onPulse(name:string,h:any){if(name==='Trigger')pulses++;}
'''%version
source.write_text(code(1))
def info(n):
 d=b.op('info_'+n.name);d.cook(force=True);return d.text

def values(n):
 return {name:{'value':getattr(n.par,name).eval(),'mode':str(getattr(n.par,name).mode)} for name in ['Probespeed','Probeexpr','Probeexport','Probebind']}
def check_values(n):
 assert [getattr(n.par,k).eval() for k in ['Probespeed','Probeexpr','Probeexport','Probebind']]==[7,5,13,23],values(n)
 assert str(n.par.Probeexport.mode)=='ParMode.EXPORT'
 assert str(n.par.Probebind.mode)=='ParMode.BIND'
 assert n.par.Probeexpr.expr=='2 + 3'
def value(name):return float(chop[name][0]) if chop.numChans and chop[name] is not None else -1

def finish(ok,error=''):
 me.par.active=False
 result={'passed':ok,'stage':stage,'error':error,'records':records,'scope':'Probe parameters read a schema file in setupParameters. TypeScript is compiled/reloaded by the real runtime. Exported TS declarations are not yet connected to C++ schema creation.'}
 (OUT/'runtime.json').write_text(json.dumps(result,indent=2,default=str))
 print('PARAMETER RUNTIME', 'PASS' if ok else 'FAIL',error)
 if ok:b.save(str(OUT/'Parameters.tox'))

def onFrameStart(frame):
 global stage,started
 try:
  for n in nodes:n.cook(force=True)
  state=info(chop);elapsed=time.perf_counter()-started
  ready='build_state\tready' in state
  good=False
  if stage==0:good=ready and value('value')==1 and value('ticks')>5 and not top.errors()
  elif stage==1:good=ready and value('value')==2
  elif stage==2:good=ready and value('value')==2 and value('ticks')>5
  elif stage==3:good='build_state\terror' in state and value('value')==2 and elapsed>.2
  elif stage==4:good=ready and 'Pending Reload' in state and value('value')==2
  elif stage==5:good=ready and value('value')==3
  elif stage==6:good=value('pulses')==1
  if good:
   for n in nodes:check_values(n)
   records.append({'stage':stage,'elapsed_ms':elapsed*1000,'value':value('value'),'ticks':value('ticks'),'pulses':value('pulses'),'parameters':{n.name:values(n) for n in nodes},'state':state})
   if stage==0:
    (OUT/'schema.txt').write_text('2\n');source.write_text(code(2));topSource.write_text(topSource.read_text().replace('255, 120, 60','40, 220, 120'))
   elif stage==1:
    # Ordinary JS reload must NOT rerun native setupParameters.
    assert all(getattr(n.par,'Probegone',None) is not None and getattr(n.par,'Probeadded',None) is None for n in nodes)
    durations=[]
    for n in nodes:
     start=time.perf_counter();n.par.reinitpulse.pulse();n.cook(force=True);durations.append((time.perf_counter()-start)*1000)
     check_values(n);assert getattr(n.par,'Probegone',None) is None;assert n.par.Probeadded.eval()==9
     assert n.par.Probespeed.normMax==100
    records[-1]['native_reinit_ms']=durations
   elif stage==2:source.write_text(code(3)+'\nmissingFunction();')
   elif stage==3:
    for n in nodes:assert n.par.Probeadded.eval()==9
    chop.par.Autoreload=False;source.write_text(code(3))
   elif stage==4:chop.par.Reload.pulse()
   elif stage==5:chop.par.Eventname='Trigger';chop.par.Sendpulse.pulse()
   else:finish(True);return
   stage+=1;started=time.perf_counter()
  elif elapsed>25:raise RuntimeError(str({'stage':stage,'state':state,'value':value('value'),'errors':[n.errors() for n in nodes]}))
 except Exception:finish(False,traceback.format_exc())
