"""Measure production pre-trigger mode using a private instrumented plugin copy.

python3 test/td/early_submit.py [frames=150] [counts=1,2,4,8]
The production plugin/example are not modified. Requires buffered_scaling's builds.
The shipped pretrigger.py Execute DAT submits enabled sketches, then forces their
collection phase later in that callback, with no GPU wait or retry. Just dirtying
the parameter did not reliably cause a second ordinary pull cook in this TD build.
Optional synthetic Python arithmetic models other CPU work between these phases;
it is deliberately counted in the TD frame budget, not a recommended delay.
"""
import json
import os
import shutil
import subprocess
import buffered_scaling as b

results=[]
workloads=[int(x) for x in os.environ.get('AVTOOLS_EARLY_WORK','0,20000,60000').split(',')]
for count in b.COUNTS:
    for iterations in workloads:
        for early in [False,True]:
            base=b.fixture(count,'no-input')
            name=f'{"early" if early else "baseline"}-{count}-work{iterations}'
            directory=base.with_suffix('.tox.dir');component=directory/b.component
            callbacks=b.OUT/(name+'.callbacks.jsonl')
            for i in range(count):
                p=component/f'renderer{i}.parm'
                p.write_text(p.read_text().rstrip().removesuffix('?')+f'Pretrigger 67108928 {int(early)}\n?\n')
            code=(b.ROOT/'native/td/example/pretrigger.py').read_text()+f'''
import json, math, time
_coordinate=onFrameStart
_started=0

def between_passes(nodes):
    submitted=time.perf_counter_ns()
    value=sum(math.sin(i*.001) for i in range({iterations}))
    finished=time.perf_counter_ns()
    parent().store('probe',dict(submitMs=(submitted-_started)/1e6,workMs=(finished-submitted)/1e6,checksum=value))

def onFrameStart(frame):
    global _started
    _started=time.perf_counter_ns()
    _coordinate(frame)
    parent().fetch('probe')['frame']=int(frame)

def onFrameEnd(frame):
    value=parent().fetch('probe',{{}})
    value['errors']=[n.errors() for n in parent().ops('renderer*')]
    with open({str(callbacks)!r},'a') as f: f.write(json.dumps(value)+'\\n')
'''
            (component/'driver.n').write_text('DAT:execute\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
            (component/'driver.parm').write_text('?\nframestart 0 1\nframeend 0 1\n?\n')
            header=(b.basedir/b.component/'sketch.text').read_bytes()[:23]
            encoded=code.encode();(component/'driver.text').write_bytes(header+len(encoded).to_bytes(4,'big')+encoded)
            toc=base.with_suffix('.tox.toc')
            toc.write_text(toc.read_text()+'\n'.join(f'{b.component}/driver{s}' for s in ['.n','.parm','.text'])+'\n')
            base.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(toc)],capture_output=True)
            path=b.OUT/(name+'.tox');shutil.copy2(base,path)
            (b.OUT/'trace.jsonl').write_text('')
            with path.with_suffix('.jsonl').open('w') as out,path.with_suffix('.log').open('w') as err:
                b.run([b.ROOT/'build/touchengine-probe',path,b.FRAMES,'--buffered-bench'],stdout=out,stderr=err,timeout=max(120,b.FRAMES/30))
            rows=[json.loads(l) for l in path.with_suffix('.jsonl').read_text().splitlines()]
            assert len(rows)==b.FRAMES*count
            previous_ready={r['frame']:max((q['gpuReadyNs'] for q in rows if q['frame']==r['frame']-1),default=0) for r in rows}
            rows=[r for r in rows if r['frame']>=30]
            for r in rows:
                assert (r['width'],r['height'])==(1920,1080),r
                assert r['top'][1:]==[40,200,255] and r['bottom']==[r['top'][0],80,160,255],r
                assert r['fences']==count,r
                r['age']=next((age for age in range(30) if ((r['frame']-age)%600+1)%256==r['top'][0]),999)
                assert r['age']<30,r
            traces=[json.loads(l) for l in (b.OUT/'trace.jsonl').read_text().splitlines()]
            shutil.copy2(b.OUT/'trace.jsonl',path.with_suffix('.trace.jsonl'))
            frames={r['frame']:r for r in rows}
            # Loading the component can cook before the first externally driven
            # frame. Align by shared monotonic timestamps, not minimum absFrame.
            collections=[t for t in traces if t['phase']!=1]
            groups=[]
            for r in frames.values():
                last=max((t for t in collections if t['cookStartNs']<r['gpuReadyNs']),key=lambda t:t['cookStartNs'])
                groups.append([t for t in traces if t['frame']==last['frame'] and previous_ready[r['frame']]<t['cookStartNs']<r['gpuReadyNs']])
            assert len({g[0]['frame'] for g in groups})==len(frames)
            traces=[t for g in groups for t in g]
            expected=[1,2] if early else [0]
            for group in groups:
                assert len(group)==count*len(expected),(name,group)
                assert all(not t['error'] for t in group),group
                for instance in {t['instance'] for t in group}:
                    assert [t['phase'] for t in group if t['instance']==instance]==expected,group
                if early: assert [t['phase'] for t in group]==[1]*count+[2]*count,group
            collected=[t for t in traces if t['phase']!=1]
            for r,g in zip(frames.values(),groups):
                assert sorted(int(t['frame']-t['outputFrame']) for t in g if t['phase']!=1)==sorted(o['age'] for o in rows if o['frame']==r['frame']), 'Pixel and trace ages disagree'
            cb=[json.loads(l) for l in callbacks.read_text().splitlines()][30:b.FRAMES]
            assert len(cb)==b.FRAMES-30 and all(not any(c['errors']) for c in cb),cb[-1:]
            repeat=sum(a['top'][0]==c['top'][0] for i in range(count) for a,c in zip([r for r in rows if r['output']==i],[r for r in rows if r['output']==i][1:]))
            result=dict(early=early,instances=count,iterations=iterations,complex=bool(os.environ.get('AVTOOLS_BENCH_COMPLEX')),frames=len(frames),sameFramePercent=100*sum(r['age']==0 for r in rows)/len(rows),allCurrentPercent=100*sum(all(r['age']==0 for r in rows if r['frame']==f) for f in frames)/len(frames),ageHistogram={str(age):sum(r['age']==age for r in rows) for age in sorted({r['age'] for r in rows})},repeatedImages=repeat,
                gpuReadyMs=b.summarize([r['gpuReadyMs'] for r in frames.values()]),pluginSumMs=b.summarize([sum(t['cookMs'] for t in g) for g in groups]),callbackSubmitMs=b.summarize([c['submitMs'] for c in cb]),syntheticWorkMs=b.summarize([c['workMs'] for c in cb]),
                imageLatencyMs=b.summarize([(r['gpuReadyNs']-t['workerStartNs'])/1e6 for r,g in zip(frames.values(),groups) for t in g if t['phase']!=1]),missedDeadlines=sum(r['gpuReadyMs']+r['scheduleSlipMs']>1000/60 for r in frames.values()))
            if early:
                result['submitToCollectMs']=b.summarize([(c['cookStartNs']-a['cookStartNs'])/1e6 for g in groups for a in g[:count] for c in g[count:] if a['instance']==c['instance']])
            results.append(result);(b.OUT/'early-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(result),flush=True)
            shutil.rmtree(directory)
    print('PASS:',b.OUT/'early-results.json',flush=True)
