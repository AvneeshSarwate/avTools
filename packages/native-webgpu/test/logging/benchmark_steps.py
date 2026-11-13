from pathlib import Path
import time,json,resource
root=parent();repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
cases=[('old_baseline','old',0,False,'info'),('no_messages','new',0,False,'info'),('off','new',1,False,'off'),('capture','new',1,False,'info'),('filtered_debug','new',2,False,'info'),('large_preview','new',3,False,'info'),('burst100','new',4,False,'info'),('info_dat_capture','new',1,True,'info'),('info_dat_large','new',3,True,'info')]*2
case_count=9
if root.op('old0') is None:cases=[c for c in cases if c[1]!='old'];case_count=8
samples=[];math_checks=[];stage=-1;count=0;last=None

def configure():
 global stage,count,last
 stage+=1;count=0;last=None
 if stage>=len(cases):
  result={'passed':not any(r['errors'] for s in samples for r in s['ops']),'td_build':app.build,'top_size':[1920,1080],'top_count':4,'xy_points':10000,'samples':samples,'cases':cases,'math_checks':math_checks}
  (repo/'packages/native-webgpu/test/logging/td-performance.json').write_text(json.dumps(result));me.par.active=False;print('LOGGING PERFORMANCE COMPLETE',result['passed']);return False
 name,group,mode,visible,level=cases[stage];root.op('controls').par.value0=mode
 (repo/'packages/native-webgpu/build/logging/progress.json').write_text(json.dumps({'stage':stage,'case':name}))
 for i in range(5):
  node=root.op('new'+str(i));node.par.Loglevel=level;node.par.Infoview='logs' if visible else 'diagnostics';node.par.Clearlogs.pulse();root.op(node.name+'_logs').viewer=visible
 return True

def onFrameStart(frame):
 global count,last
 if stage<0 and not configure():return
 count+=1;name,group,mode,visible,level=cases[stage];started=time.perf_counter();interval=(started-last)*1000 if last else None;last=started;operators=[]
 for i in range(5):
  n=root.op(group+str(i));n.cook(force=True)
  status=root.op(n.name+'_status');status.cook(force=True)
  def value(key):return float(status[key][0]) if status[key] is not None else None
  operators.append({'name':n.name,'cpu_ms':n.cpuCookTime,'worker_ms':value('worker_ms'),'draw_ms':value('draw_submit_ms' if i<4 else 'script_ms'),'upload_ms':value('upload_enqueue_ms') if i<4 else None,'errors':n.errors()})
 source_wall=(time.perf_counter()-started)*1000;info_cost=0
 if visible:
  for i in range(5):
   info=root.op('new'+str(i)+'_logs');info.cook(force=True);info_cost+=info.cpuCookTime
 if count>30:samples.append({'case':name,'repeat':stage//case_count,'frame':count,'interval_ms':interval,'source_wall_ms':source_wall,'source_cpu_ms':sum(r['cpu_ms'] for r in operators),'info_cpu_ms':info_cost,'ops':operators,'max_rss_mib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1048576})
 if count>=180:
  n=passive(root.op(group+'4'));t=float(n['x'][0]);x=float(n['x'][9999]);y=float(n['y'][9999]);ok=n.numSamples==10000 and abs(x-(.9999-.9998*t))<1e-5 and abs(y-(-.9999+2.9997*t))<1e-5
  math_checks.append({'case':name,'repeat':stage//case_count,'samples':n.numSamples,'x0':t,'x9999':x,'y9999':y,'passed':ok})
  assert ok,math_checks[-1]
  configure()
