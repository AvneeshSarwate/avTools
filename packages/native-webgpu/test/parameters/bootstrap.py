from pathlib import Path
import json
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/parameters'
b=op('/avtools_parameter_probe')
if b.op('bootstrap'):b.op('bootstrap').destroy()
n=b.create(cplusplusCHOP,'bootstrap');n.par.plugin=str(OUT/'BootstrapProbe.plugin');n.cook(force=True)
r={'initial':{'entry':n.par.Entryfile.eval(),'schema':float(n['schema'][0])}}
n.par.Entryfile='schema2';n.par.reinitpulse.pulse();n.cook(force=True)
r['reinit']={'entry':n.par.Entryfile.eval(),'schema':float(n['schema'][0]),'second_present':getattr(n.par,'Second',None) is not None}
b.save(str(OUT/'Parameters.tox'));copy=op('/').loadTox(str(OUT/'Parameters.tox'));c=copy.op('bootstrap');c.cook(force=True)
r['loaded']={'entry':c.par.Entryfile.eval(),'schema':float(c['schema'][0]),'second_present':getattr(c.par,'Second',None) is not None}
r['confirmed_unavailable_during_setup']=r['reinit']['schema']==1 and r['loaded']['schema']==1
(OUT/'bootstrap-result.json').write_text(json.dumps(r,indent=2));copy.destroy();print('BOOTSTRAP',r)
