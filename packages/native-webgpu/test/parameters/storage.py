from pathlib import Path
import json
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu');OUT=ROOT/'artifacts/parameters'
b=op('/avtools_parameter_probe');n=b.create(cplusplusCHOP,'storageprobe');n.par.plugin=str(OUT/'StorageProbe.plugin');n.cook(force=True)
r={'initial':{'entry':n.par.Entryfile.eval(),'schema':float(n['schema'][0])}}
n.par.Entryfile='schema2';n.store('declaredSchema',2);n.par.reinitpulse.pulse();n.cook(force=True);n.par.Second=17
r['reinit']={'entry':n.par.Entryfile.eval(),'schema':float(n['schema'][0]),'value':n.par.Second.eval()}
b.save(str(OUT/'Parameters.tox'));copy=op('/').loadTox(str(OUT/'Parameters.tox'));c=copy.op('storageprobe');c.cook(force=True)
r['loaded']={'entry':c.par.Entryfile.eval(),'schema':float(c['schema'][0]),'second':getattr(c.par,'Second',None).eval() if getattr(c.par,'Second',None) is not None else None}
r['metadata_changes']={}
for field,value in [('label','Edited label'),('normMax',100),('default',5)]:
 try:setattr(n.par.Second,field,value);r['metadata_changes'][field]={'success':True,'value':getattr(n.par.Second,field)}
 except Exception as e:r['metadata_changes'][field]={'error':str(e)}
try:n.par.Second.destroy();r['destroy']={'remaining':getattr(n.par,'Second',None) is not None}
except Exception as e:r['destroy']={'error':str(e)}
(OUT/'storage-result.json').write_text(json.dumps(r,indent=2));copy.destroy();print('STORAGE',r)
