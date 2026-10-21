from pathlib import Path
import json,time,platform,resource
root=parent()
repo=Path(root.fetch('benchmark_repo'))
stages=[dict(kind='chop',instances=n,points=p,work_ms=w,blocking=b) for n in (1,4) for p in (1,10000) for w in (0,10,50) for b in (False,True)]
stages.insert(0,dict(kind='baseline',instances=0))
stages += [dict(kind='top',instances=4,mode=m) for m in ('buffered','blocking','pretrigger')]
index=-1;frame=0;last=None;samples=[];reports=[];before_cpu=0;before_wall=0;submit_ms={}

def configure(stage):
    global before_cpu,before_wall
    if stage['kind']=='chop':
        root.store('points',stage['points']);root.op('controls').par.value1=stage['work_ms']
        for i in range(1,5):
            n=root.op('channels'+str(i));n.par.Samecook=stage['blocking'];n.par.Outputsamples=stage['points']
    elif stage['kind']=='top':
        for i in range(1,5):
            n=root.op('bench_top'+str(i));n.par.Samecook=stage['mode']=='blocking';n.par.Pretrigger=stage['mode']=='pretrigger'
    before_cpu=time.process_time();before_wall=time.perf_counter()

def onFrameStart(_):
    global index,frame,last,samples,submit_ms
    if index<0:index=0;configure(stages[index])
    frame+=1;submit_ms={}
    stage=stages[index]
    if stage['kind']=='top' and stage['mode']=='pretrigger':
        for i in range(1,5):
            n=root.op('bench_top'+str(i));n.par.Pretriggerpulse.pulse();n.cook(force=True);submit_ms[n.name]=n.cpuCookTime

def onFrameEnd(_):
    global index,frame,last,samples
    stage=stages[index];now=time.perf_counter();costs=[];ages=[];reuse=[];coalesced=[];errors=[];upload=[];reused=[];worker=[];sequences=[]
    for i in range(1,stage['instances']+1):
        node=root.op(('channels' if stage['kind']=='chop' else 'bench_top')+str(i))
        node.cook(force=True);costs.append(node.cpuCookTime+submit_ms.get(node.name,0))
        if node.errors():errors.append(node.errors())
        if stage['kind']=='chop':
            info=root.op('status'+str(i));info.cook(force=True)
            ages.append(float(info['input_age_ms'][0]));reuse.append(float(info['repeated_percent_120'][0]));coalesced.append(float(info['coalesced_inputs'][0]));reused.append(float(info['reused_cooks'][0]));worker.append(float(info['worker_ms'][0]));sequences.append(float(info['consumed_sequence'][0]))
            if frame>20 and float(info['ready'][0]):
                for sample in (0,node.numSamples-1):
                    if abs(float(node['x'][sample])+float(node['y'][sample])-2)>.01:errors.append('Incoherent XY transform')
        else:
            info=root.op('top_status'+str(i)) or root.create(infoCHOP,'top_status'+str(i));info.par.op=node.name;info.cook(force=True)
            ages.append(float(info['publication_age_ms'][0]));upload.append(float(info['upload_enqueue_ms'][0]))
    if frame>20:samples.append(dict(cook_ms=costs,frame_ms=(now-last)*1000 if last else 0,age_ms=ages,repeated_percent=reuse,coalesced=coalesced,upload_ms=upload,reused=reused,worker_ms=worker,sequences=sequences,errors=errors))
    last=now
    if frame>=100:
        duration=time.perf_counter()-before_wall
        reports.append(dict(stage=stage,cpu_percent_one_core=100*(time.process_time()-before_cpu)/duration,samples=samples))
        index+=1;frame=0;samples=[];last=None
        if index==len(stages):
            data=dict(hardware=platform.machine(),td_build=str(app.build),max_rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,reports=reports,plugins={name:str(root.op(name).par.plugin.eval()) for name in ('channels1','bench_top1')})
            (repo/'packages/native-webgpu/artifacts/execution-benchmark.json').write_text(json.dumps(data,indent=2))
            me.par.active=False;print('Execution benchmark complete')
            return
        configure(stages[index])
