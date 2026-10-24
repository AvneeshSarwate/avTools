from pathlib import Path
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
b=op('/avtools_parameter_probe');d=b.create(executeDAT,'pending_reload_test');d.par.active=False;d.par.framestart=True
d.text='''from pathlib import Path
import json,time,traceback
OUT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu/artifacts/parameters')
n=parent().op('runtime_chop');n.par.Autoreload=False
source=Path(n.par.Typescript.eval());source.write_text(source.read_text().replace('default:3','default:4'))
started=time.perf_counter();stage=0;records=[]
def onFrameStart(frame):
 global stage,started
 try:
  n.cook(force=True);d=parent().op('info_runtime_chop');d.cook(force=True);value=float(n['value'][0])
  if stage==0 and 'Pending Reload' in d.text and 'build_state\\tready' in d.text:
   records.append({'stage':'pending','value':value,'autoreload':n.par.Autoreload.eval()});assert value==3
   n.par.reinitpulse.pulse();stage=1;started=time.perf_counter()
  elif stage==1 and value==4:
   records.append({'stage':'after_native_reinit','value':value,'autoreload':n.par.Autoreload.eval()})
   (OUT/'pending-reload.json').write_text(json.dumps({'confirmed_reinit_adopts_pending':True,'records':records},indent=2));me.par.active=False;print('PENDING RELOAD: native reinit adopts pending source even with Automatic Reload off')
  elif time.perf_counter()-started>20:raise RuntimeError(d.text)
 except Exception:
  (OUT/'pending-reload.json').write_text(json.dumps({'error':traceback.format_exc(),'records':records},indent=2));me.par.active=False
'''
d.par.active=True
