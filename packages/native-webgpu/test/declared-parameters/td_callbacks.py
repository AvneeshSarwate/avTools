from pathlib import Path
import json,time,traceback
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
OUT=ROOT/'artifacts/declared-parameters';PROJECT=OUT/'project'
(OUT/'td-results.json').unlink(missing_ok=True)
(OUT/'progress.txt').write_text('starting\n')
b=parent();records=[];stage=0;started=time.perf_counter();nodes=[];clones=[]
b.appendCustomPage('Test').appendFloat('Master')[0].val=23

def schema(version):
 d={'Speed':{'type':'float','default':1,'min':0,'max':10},'Expr':{'type':'float'},'Exported':{'type':'float'},'Bound':{'type':'float'},'Enabled':{'type':'toggle','default':True},'Title':{'type':'string','default':'hello'},'Mode':{'type':'menu','options':['first','second'],'default':'first'},'Point':{'type':'xy','default':[2,3]},'Color':{'type':'rgb','default':[1,0,0]},'Count':{'type':'int','default':3},'Space':{'type':'xyz','default':[1,2,3]},'Tint':{'type':'rgba','default':[1,0,0,1]},'Trigger':{'type':'pulse'}}
 if version==1:d['Gone']={'type':'float','default':8}
 if version>=2:d['Added']={'type':'float','default':9};d['Speed'].update(default=4,max=20)
 if version>=4:d['Later']={'type':'float','default':11}
 return d

def source(kind,version,invalid=False):
 d=schema(version)
 if invalid:d['Speed']={'type':'string','default':'oops'}
 header="import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';\nexport const parameters = "+json.dumps(d)+" as const satisfies ParameterDefinitions;\n"
 if kind=='chop':
  # Invalid-schema version still typechecks: no dependency on Speed's numeric type.
  return header+"import type {ChopHost} from '@avtools/native-webgpu/td-chop';\ntype Host=ChopHost<typeof parameters>;\nlet pulses=0;\nexport function onPulse(name:string,h:Host){if(name==='Trigger')pulses++;}\nexport function onCook(h:Host){const p=h.params;h.outputs.set('version',%d);h.outputs.set('speed',Number(p.Speed));h.outputs.set('expr',p.Expr);h.outputs.set('exported',p.Exported);h.outputs.set('bound',p.Bound);h.outputs.set('pulses',pulses);h.outputs.set('enabled',p.Enabled?1:0);h.outputs.set('mode',p.Mode==='second'?2:1);h.outputs.set('text',p.Title.length);h.outputs.set('point',p.Point[0]+p.Point[1]);h.outputs.set('color',p.Color[0]);if(!Object.isFrozen(p)||!Object.isFrozen(p.Point))throw Error('mutable params');}\n"%version
 return header+"import type {Draw,OnPulse} from '@avtools/native-webgpu/td-sketch';\nlet pulses=0;\nexport const onPulse:OnPulse<typeof parameters>=(name)=>{if(name==='Trigger')pulses++;};\nexport const draw:Draw<typeof parameters>=(p,f)=>{p.background(Number(f.params.Speed)*10,%d,pulses);if(!Object.isFrozen(f.params)||!Object.isFrozen(f.params.Point))throw Error('mutable params');};\n"%version

def write(version,invalid=False):
 for kind in ['chop','top']:(PROJECT/(kind+'.ts')).write_text(source(kind,version,invalid))
write(1)
for name,typ,kind,marker in [('channels',cplusplusCHOP,'chop','current-chop.txt'),('buffered',cplusplusCHOP,'chop','current-chop.txt'),('picture',cplusplusTOP,'top','current.txt')]:
 n=b.create(typ,name);n.par.plugin=str(ROOT/'prebuilt/macos-arm64'/(ROOT/'prebuilt/macos-arm64'/marker).read_text().strip());n.cook(force=True)
 n.par.Typescript=str(PROJECT/(kind+'.ts'))
 if kind=='top':n.par.Width=64;n.par.Height=64;n.par.Samecook=True
 else:n.par.Outputchannels='version speed expr exported bound pulses enabled mode text point color';n.par.Samecook=name!='buffered'
 n.cook(force=True);nodes.append(n)
 info=b.create(infoDAT,'info_'+name);info.par.op=n.name
chop,buffered,top=nodes

def info(n):
 d=b.op('info_'+n.name);d.cook(force=True);return d.text

def val(n,name):return float(n[name][0]) if n.numChans and n[name] is not None else -999

def pixel():
 image=top.numpyArray(delayed=False)
 return [round(float(x)*255) for x in image[0,0,:3]] if image is not None else [-1]*3

def controls(n):
 return {name:{'value':getattr(n.par,name).eval(),'mode':str(getattr(n.par,name).mode)} for name in ['Speed','Expr','Exported','Bound'] if getattr(n.par,name,None) is not None}

def preserved():
 for n in nodes:
  assert [getattr(n.par,k).eval() for k in ['Speed','Expr','Exported','Bound']]==[7,5,13,23],controls(n)
  assert str(n.par.Exported.mode)=='ParMode.EXPORT',controls(n)
  assert str(n.par.Bound.mode)=='ParMode.BIND',controls(n)
  assert n.par.Expr.expr=='2 + 3'

def finish(ok,error=''):
 me.par.active=False
 result={'passed':ok,'stage':stage,'error':error,'records':records,'states':{n.name:info(n) for n in nodes},'warnings':{n.name:n.warnings() for n in nodes},'errors':{n.name:n.errors() for n in nodes},'controls':{n.name:controls(n) for n in nodes},'pixel':pixel()}
 (OUT/'td-results.json').write_text(json.dumps(result,indent=2,default=str));print('DECLARED PARAMETERS', 'PASS' if ok else 'FAIL',error)

def onFrameStart(frame):
 global stage,started
 try:
  for n in nodes:n.cook(force=True)
  for n in clones:n.cook(force=True)
  elapsed=time.perf_counter()-started
  states=[info(n) for n in nodes]
  ready=all('build_state\tready' in x for x in states)
  versions=[val(n,'version') for n in [chop,buffered]]
  pix=pixel()
  good=False
  if stage==0:good=ready and versions==[1,1] and all(getattr(n.par,'Speed',None) is not None for n in nodes) and pix==[10,1,0]
  elif stage==1:good=val(chop,'speed')==7 and val(buffered,'speed')==7 and all(val(n,'pulses')==1 for n in [chop,buffered]) and pix==[70,1,1]
  elif stage==2:good=ready and versions==[2,2] and all(getattr(n.par,'Added',None) is not None for n in nodes) and pix==[70,2,0]
  elif stage==3:good=ready and versions==[3,3] and pix==[70,3,0]
  elif stage==4:good=all('build_state\terror' in x for x in states) and versions==[3,3] and elapsed>.2
  elif stage==5:good=ready and all('changing parameter type' in n.warnings() for n in nodes) and versions==[3,3]
  elif stage==6:good=ready and all('Pending Reload' in x for x in states) and versions==[3,3] and elapsed>.3
  elif stage==7:good=versions==[3,3] and all('Pending Reload' in x for x in states) and elapsed>.3
  elif stage==8:good=ready and versions==[4,4] and all(getattr(n.par,'Later',None) is not None for n in nodes) and pix==[70,4,1] and all(val(n,'pulses')==1 for n in [chop,buffered])
  elif stage==9:good=elapsed>.5 and len(clones)==3 and all(getattr(n.par,'Later',None) is not None for n in clones) and val(clones[0],'version')==4
  elif stage==10:good=elapsed>.5 and val(chop,'speed')==6 and val(clones[0],'speed')==7
  if good:
   if stage>0:preserved() if stage<10 else None
   with (OUT/'progress.txt').open('a') as log:log.write('passed stage '+str(stage)+'\n')
   records.append({'stage':stage,'elapsed_ms':elapsed*1000,'versions':versions,'pixel':pix,'controls':{n.name:controls(n) for n in nodes}})
   if stage==0:
    for n in nodes:
     n.par.Speed=7;n.par.Expr.expr='2 + 3';n.par.Bound.bindExpr='parent().par.Master';n.par.Bound.mode=ParMode.BIND
     e=b.create(constantCHOP,'export_'+n.name);e.par.name0=n.name+':Exported';e.par.value0=13
     e.par.exportmethod=next(v for v,label in zip(e.par.exportmethod.menuNames,e.par.exportmethod.menuLabels) if 'Path' in label);e.export=True;e.cook(force=True)
     n.par.Enabled=False;n.par.Mode='second';n.par.Title='test text';n.par.Pointx=4;n.par.Pointy=5;n.par.Trigger.pulse()
   elif stage==1:
    for n in [chop,buffered]:assert [val(n,k) for k in ['expr','exported','bound','enabled','mode','text','point','color']]==[5,13,23,0,2,9,9,1]
    write(2)
   elif stage==2:
    for n in nodes:assert getattr(n.par,'Gone',None) is None and n.par.Added.eval()==9 and n.par.Speed.default==4 and n.par.Speed.normMax==20
    write(3)
   elif stage==3:
    for kind in ['chop','top']:(PROJECT/(kind+'.ts')).write_text('export const broken: number = "wrong";')
   elif stage==4:write(3,True)
   elif stage==5:
    for n in nodes:n.par.Autoreload=False
    write(4)
   elif stage==6:
    for n in nodes:assert getattr(n.par,'Later',None) is None;n.par.Reset.pulse()
   elif stage==7:
    for n in nodes:n.par.Reload.pulse();n.par.Trigger.pulse()
   elif stage==8:
    # Save only fixture nodes, never the user's current .toe or test callback.
    saved=op('/').create(baseCOMP,'avtools_parameters_saved');saved.appendCustomPage('Test').appendFloat('Master')[0].val=23
    saved.copyOPs([n for n in b.children if n!=me]);saved.save(str(OUT/'Parameters.tox'));saved.destroy()
    clone=op('/').loadTox(str(OUT/'Parameters.tox'));clones.extend([clone.op(n.name) for n in nodes])
   elif stage==9:
    for n in clones:
     assert n.par.Speed.eval()==7 and n.par.Expr.expr=='2 + 3' and n.par.Bound.eval()==23
    chop.par.Speed=6
   elif stage==10:finish(True);return
   stage+=1;started=time.perf_counter()
  elif elapsed>40:finish(False,'timeout stage '+str(stage)+' versions '+str(versions))
 except Exception:finish(False,traceback.format_exc())
