from pathlib import Path
import json
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/parameters'
b=op('/avtools_parameter_probe');n=b.op('probe');records=[]
def snapshot(label):
 n.cook(force=True)
 data={'stage':label,'channels':{c.name:float(c[0]) for c in n.chans()},'pars':{}}
 for name in ['Speed','Expr','Exportvalue','Boundvalue','Gone','Added','Typetest','Trigger']:
  p=getattr(n.par,name,None)
  if p is not None:data['pars'][name]={'value':p.eval(),'mode':str(p.mode),'style':p.style,'default':p.default,'expr':p.expr,'bindExpr':p.bindExpr,'exportSource':str(p.exportSource),'max':p.max,'normMax':p.normMax}
 records.append(data)
 (OUT/'lifecycle.json').write_text(json.dumps(records,indent=2,default=str))
 return data
snapshot('initial')
n.par.Speed=7;n.par.Expr.expr='2 + 3';n.par.Expr.mode=ParMode.EXPRESSION
page=b.appendCustomPage('Test');master=page.appendFloat('Master')[0];master.val=23
n.par.Boundvalue.bindExpr="parent().par.Master";n.par.Boundvalue.mode=ParMode.BIND
n.par.Typetest=42;n.par.Trigger.pulse()
e=b.create(constantCHOP,'exporter');e.par.name0='probe:Exportvalue';e.par.value0=13
menu=e.par.exportmethod
menu.val=next(name for name,label in zip(menu.menuNames,menu.menuLabels) if 'Path' in label)
e.export=True;e.cook(force=True)
snapshot('configured')
(OUT/'schema.txt').write_text('2\n');n.par.reinitpulse.pulse()
snapshot('schema2_reinit')
(OUT/'schema.txt').write_text('3\n');n.par.reinitpulse.pulse()
snapshot('schema3_typechange')
print('Lifecycle probe:',OUT/'lifecycle.json')
