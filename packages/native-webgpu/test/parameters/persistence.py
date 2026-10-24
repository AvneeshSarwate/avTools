from pathlib import Path
import json,time,traceback
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/parameters'
b=op('/avtools_parameter_probe');callback=b.op('runtime_tests')
if callback:callback.destroy()
b.save(str(OUT/'Parameters.tox'))
copy=op('/').loadTox(str(OUT/'Parameters.tox'))
r={'loaded':copy.path,'nodes':{},'passed':False}
try:
 for parentNode in [b,copy]:
  for name in ['runtime_chop','runtime_top']:
   n=parentNode.op(name);parentNode.op('export_'+name).cook(force=True);n.cook(force=True)
   vals={k:{'value':getattr(n.par,k).eval(),'mode':str(getattr(n.par,k).mode)} for k in ['Probespeed','Probeexpr','Probeexport','Probebind']}
   assert [x['value'] for x in vals.values()]==[7,5,13,23],vals
   assert 'EXPORT' in vals['Probeexport']['mode'] and 'BIND' in vals['Probebind']['mode']
   assert n.par.Probeadded.eval()==9
   r['nodes'][n.path]={'values':vals,'entry':n.par.Typescript.eval(),'errors':n.errors()}
 copy.par.Master=31
 assert copy.op('runtime_chop').par.Probebind.eval()==31
 assert b.op('runtime_chop').par.Probebind.eval()==23
 copy.op('runtime_chop').par.Probespeed=19
 assert b.op('runtime_chop').par.Probespeed.eval()==7
 r['independent_instances']=True;r['passed']=True
except Exception:r['error']=traceback.format_exc()
(OUT/'persistence.json').write_text(json.dumps(r,indent=2))
copy.destroy()
print('PERSISTENCE',r['passed'])
