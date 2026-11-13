"""Headless buffered TOP end-to-end probe; instruments a private bundle, never the installed one.

Run: python3 test/td/buffered_scaling.py [frames=150] [counts=1,2,4,8]
Requires the existing TD plugin and touchengine-probe builds, Metal access, and TD.
gpuReadyMs includes TD uploads and ownership fences; sample readback follows it.
"""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 150
COUNTS = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [1, 2, 4, 8]
assert FRAMES > 40 and all(0 < n <= 16 for n in COUNTS)
OUT = ROOT / 'artifacts/td' / ('buffered-scaling-' + str(time.time_ns()))
OUT.mkdir(parents=True)
print(OUT, flush=True)


def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)


original = Path(os.environ.get('AVTOOLS_BENCH_PLUGIN') or (ROOT / 'build/td-plugin-path.txt').read_text().strip())
bundle = OUT / 'TraceSketch.plugin'
shutil.copytree(original, bundle, symlinks=True)
sdk = subprocess.check_output(['xcrun', '--show-sdk-path'], text=True).strip()
mac = bundle / 'Contents/MacOS'
wrapper = OUT / 'TraceSketch.cpp'
# TouchEngine children do not inherit the probe's stderr. Capture in the private
# benchmark plugin only; shipped plugins keep their normal console behavior.
wrapper.write_text('#include <cstdio>\nstatic const bool capture = []{freopen(' + json.dumps(str(OUT/'runtime.log')) + ', "a", stderr); return true;}();\n#include ' + json.dumps(str(ROOT/'native/td/SketchTOP.cpp')) + '\n')
run(['clang++', '-isysroot', sdk, '-isystem', sdk + '/usr/include/c++/v1', '-std=c++17', '-O2', '-fvisibility=hidden', '-bundle', '-arch', 'arm64', '-mmacosx-version-min=15.0', '-I/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP', '-DAVTOOLS_TOP_TRACE_PATH="' + str(OUT/'trace.jsonl') + '"', wrapper, '-L'+str(mac), '-lavtools_runtime', '-o', mac/'AvToolsSketch'])
run(['codesign', '--force', '--sign', '-', bundle], capture_output=True)

# Reuse serialized parameter definitions; construct graphs without editor automation.
base = OUT / 'base.tox'
shutil.copy2(ROOT / 'native/td/example/Sketch.tox', base)
subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand', str(base)], capture_output=True)
basedir = OUT / 'base.tox.dir'
assert basedir.is_dir()
component = 'avtools_sketch_example'
cpp_pars = (basedir / component / 'sketch1.cparm').read_text()
if ' Samecook ' not in cpp_pars:
    cpp_pars = cpp_pars.rstrip().removesuffix('?') + '772804867 Samecook "Wait for Same Cook (Blocking)" 1 1 0 0 1 1 1 2 0 "" "" Output 12\n?\n'
cpp_pars = cpp_pars.encode()
sketch = OUT / 'sketch.js'
sketch.write_text("function setup(p){p.textSize(48);} function draw(p,f){p.background(f.frame%256,80,160);if(f.top(0))p.image(f.top(0),32,32,p.width-64,p.height-64);p.noStroke();p.fill(255);p.text('Dawn + Rust',100,100);p.circle(960+Math.sin(f.frame/20)*400,540,200);p.fill(f.frame%256,40,200);p.rect(0,0,16,16);}")

if os.environ.get('AVTOOLS_BENCH_COMPLEX'):
    sketch.write_text(sketch.read_text().replace("p.circle(960+Math.sin(f.frame/20)*400,540,200);", "for(let i=0;i<1000;i++){p.fill(i%256,(i*7)%256,(i*13)%256);p.circle(40+(i*37+f.frame*2)%1840,40+(i*53)%1000,12+i%24);}p.fill(255);for(let i=0;i<20;i++)p.text('Dawn + Rust '+i,100+(i%4)*420,150+Math.floor(i/4)*170);"))


if os.environ.get('AVTOOLS_BENCH_TIMING_HZ'):
    hz=int(os.environ['AVTOOLS_BENCH_TIMING_HZ'])
    source=sketch.read_text().replace('function setup(p){', 'function setup(p,h){')
    timing=f"""h.timing.launch(async c=>{{const start=performance.now();let samples=[],n=0;while(true){{await c.waitSec(1/{hz});samples.push(performance.now()-start-c.time*1000);if(++n%{hz}===0){{console.log(JSON.stringify({{suite:'td-timer-lateness',hz:{hz},raw:samples}}));samples=[];}}}}}},{{seed:'benchmark'}});"""
    sketch.write_text(source.replace('p.textSize(48);','p.textSize(48);'+timing))


def fixture(count, mode, same_cook=False):
    name = f'{mode}-{count}-' + ('same' if same_cook else 'buffered')
    directory = OUT / (name + '.tox.dir')
    directory.mkdir()
    (directory / component).mkdir()
    for suffix in ['.n', '.cparm', '.parm']:
        shutil.copy2(basedir / (component + suffix), directory / (component + suffix))
    shutil.copy2(basedir / '.build', directory / '.build')
    def put(node, suffix, data):
        target = directory / component / (node + suffix)
        target.write_bytes(data if isinstance(data, bytes) else data.encode())
    def node(kind, input_name=None):
        connections = 'inputs\n{\n0 \t' + input_name + '\n}\n' if input_name else ''
        return kind + '\ntile 0 0 160 110\nflags = parlanguage 0\n' + connections + 'color 0.67 0.67 0.67\nend\n'
    for i in range(count):
        renderer = 'renderer' + str(i)
        input_name = 'input' + str(i) if mode == 'independent-input' else 'input0'
        if mode != 'no-input' and (i == 0 or mode == 'independent-input'):
            put(input_name, '.n', node('TOP:constant'))
            put(input_name, '.parm', '?\ncolorr 17 0 "absTime.frame % 256 / 255.0"\ncolorg 0 0.5\ncolorb 0 0.75\noutputresolution 0 custom\nresolutionw 0 1920\nresolutionh 0 1080\n?\n')
        put(renderer, '.n', node('TOP:cplusplus', input_name if mode != 'no-input' else None))
        put(renderer, '.cparm', cpp_pars)
        put(renderer, '.parm', f'?\nplugin 0 {bundle}\nSourcefile 67108928 {sketch}\nWidth 67108928 1920\nHeight 67108928 1080\nSamecook 67108928 {int(same_cook)}\n?\n')
        put('out' + str(i+1), '.n', node('TOP:out', renderer))
        put('out' + str(i+1), '.parm', f'?\nconnectorder 0 {i}\n?\n')
    toc = OUT / (name + '.tox.toc')
    # Parent nodes must precede their children and parameter definitions precede values.
    files = ['.build'] + [component+s for s in ['.n','.cparm','.parm']]
    files += [str(f.relative_to(directory)) for f in sorted((directory / component).iterdir(), key=lambda p:(p.stem,{'.n':0,'.cparm':1,'.parm':2}[p.suffix]))]
    toc.write_text('# 4 0 0 0 1\n' + '\n'.join(files) + '\n')
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse', str(toc)], capture_output=True)
    result = OUT / (name + '.tox')
    assert result.is_file(), result
    return result


def summarize(values):
    values = sorted(values)
    return {'count':len(values),'mean': sum(values)/len(values), 'p50': values[len(values)//2], 'p95': values[int(len(values)*.95)], 'p99': values[min(len(values)-1,int(len(values)*.99))], 'max': values[-1]}


if __name__ == '__main__':
    results = []
    for same_cook,mode in [(False,'no-input'),(True,'no-input'),(False,'independent-input')]:
        if os.environ.get('AVTOOLS_BENCH_MODE') and os.environ['AVTOOLS_BENCH_MODE'] != ('same' if same_cook else mode): continue
        for count in COUNTS:
            path = fixture(count, mode, same_cook)
            (OUT/'trace.jsonl').write_text('')
            with path.with_suffix('.jsonl').open('w') as stdout, path.with_suffix('.log').open('w') as stderr:
                run([ROOT/'build/touchengine-probe',path,FRAMES,'--buffered-bench'],stdout=stdout,stderr=stderr,timeout=max(120,FRAMES/30))
            outputs = [json.loads(line) for line in path.with_suffix('.jsonl').read_text().splitlines()]
            assert len(outputs)==FRAMES*count,(len(outputs),count)
            samples=[o for o in outputs if o['frame']>=30]
            for o in samples:
                assert (o['width'],o['height'])==(1920,1080),o
                assert o['top'][1:]==[40,200,255],o
                assert o['fences']==count,o
                if mode!='no-input': assert o['inputSample'][1:]==[128,191,255],o
                o['age']=next((age for age in range(30) if ((o['frame']-age)%600+1)%256==o['top'][0]),999)
                assert o['age']<30,o
                if same_cook: assert o['age']==0,o
                assert o['bottom']==[o['top'][0],80,160,255],o
            traces=[json.loads(line) for line in (OUT/'trace.jsonl').read_text().splitlines()]
            shutil.copy2(OUT/'trace.jsonl',path.with_suffix('.trace.jsonl'))
            base_frame=min(t['frame'] for t in traces)
            traces=[t for t in traces if base_frame+30<=t['frame']<base_frame+FRAMES]
            assert all(not t['error'] for t in traces),[t for t in traces if t['error']][:3]
            frames={o['frame']:o for o in samples}
            groups=[[t for t in traces if t['frame']==f] for f in range(base_frame+30,base_frame+FRAMES)]
            assert all(len(group)==count for group in groups), 'Missing TD trace rows'
            # Mach monotonic clocks share the same epoch across the host and TD
            # processes. Each trace holds the start of its displayed result.
            image_latency=[(frames[i+30]['gpuReadyNs']-t['workerStartNs'])/1e6 for i,group in enumerate(groups) for t in group]
            assert min(image_latency)>0
            repeats=sum(a['top'][0]==b['top'][0] for i in range(count) for a,b in zip([o for o in samples if o['output']==i],[o for o in samples if o['output']==i][1:]))
            jobs={ (t['instance'],t['workerStartNs']):t for t in traces if t['workerStartNs'] }
            overlap=sum(a['workerStartNs']<b['workerEndNs'] and b['workerStartNs']<a['workerEndNs'] for a in jobs.values() for b in jobs.values() if a['instance']<b['instance'])
            result={'mode':mode,'sameCook':same_cook,'complex':bool(os.environ.get('AVTOOLS_BENCH_COMPLEX')),'timingHz':int(os.environ.get('AVTOOLS_BENCH_TIMING_HZ') or '0'),'plugin':str(original),'instances':count,'frames':FRAMES-30,'repeatedOutputs':repeats,'ageFrames':summarize([o['age'] for o in samples]),'overlappingWorkerPairs':overlap,
                'hostMs':{key:summarize([o[key] for o in frames.values()]) for key in ['cookMs','gpuReadyMs','validationMs','scheduleSlipMs']},
                'renderStartToUploadedImageMs':summarize(image_latency),
                'missedDeadlines':sum(o['gpuReadyMs']+o['scheduleSlipMs']>1000/60 for o in frames.values()),
                'pluginSumMs':{key:summarize([sum(t[key] for t in group) for group in groups]) for key in ['cookMs','uploadMs']},
                'workerMs':{key:summarize([t[key] for t in jobs.values()]) for key in ['workerMs','inputDownloadMs','inputUploadMs','drawMs','readbackMs']}}
            results.append(result)
            (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(result),flush=True)
    print('PASS:',OUT/'results.json',flush=True)
