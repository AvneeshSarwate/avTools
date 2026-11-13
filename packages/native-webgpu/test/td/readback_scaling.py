"""Headless multi-TOP readback probe; instruments a private bundle, never the installed one.

Run: python3 test/td/readback_scaling.py [frames=150] [counts=1,2,4,8]
Historical test: requires the pre-buffering synchronous source and TD plugin and touchengine-probe builds, Metal access, and TD.
The host's verification readbacks occur outside each measured TOP execute interval.
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 150
COUNTS = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [1, 2, 4, 8]
assert FRAMES > 40 and all(0 < n <= 16 for n in COUNTS)
OUT = ROOT / 'artifacts/td' / ('readback-scaling-' + str(time.time_ns()))
OUT.mkdir(parents=True)
print(OUT, flush=True)


def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)


original = Path((ROOT / 'build/td-plugin-path.txt').read_text().strip())
bundle = OUT / 'TraceSketch.plugin'
shutil.copytree(original, bundle, symlinks=True)
source = (ROOT / 'native/td/SketchTOP.cpp').read_text()
if 'struct Job' in source:
    raise SystemExit('This historical probe requires the synchronous revision 063d02a. Use buffered_scaling.py for the current plugin.')
source = source.replace('#include "../embedded/Bridge.h"', '#include "' + str(ROOT / 'native/embedded/Bridge.h') + '"\n#include <cstdio>\n#include <pthread.h>')
source = source.replace('    try {\n      char detail', '''    const auto traceStart = std::chrono::steady_clock::now();
    uint64_t traceThread=0; pthread_threadid_np(nullptr,&traceThread);
    double traceFrame=inputs->getTimeInfo()->frame;
    int traceInputs=0,traceInputWidth=0,traceInputHeight=0,traceInputRed=-1;
    try {
      char detail''', 1)
source = source.replace('      inputDownloadMs=', '''      traceInputs=static_cast<int>(images.size());
      if(!images.empty()){traceInputWidth=images[0].width;traceInputHeight=images[0].height;traceInputRed=images[0].pixels[0];}
      inputDownloadMs=''', 1)
needle = '    }catch(const std::exception& e){error=e.what();}\n  }'
assert needle in source
source = source.replace(needle, '''    }catch(const std::exception& e){error=e.what();}
    const auto traceEnd = std::chrono::steady_clock::now();
    const auto startNs=std::chrono::duration_cast<std::chrono::nanoseconds>(traceStart.time_since_epoch()).count();
    const auto endNs=std::chrono::duration_cast<std::chrono::nanoseconds>(traceEnd.time_since_epoch()).count();
    fprintf(stderr,"AVTRACE {\\"instance\\":\\"%p\\",\\"thread\\":%llu,\\"frame\\":%.0f,\\"startNs\\":%lld,\\"endNs\\":%lld,\\"executeMs\\":%.6f,\\"inputDownloadMs\\":%.6f,\\"inputUploadMs\\":%.6f,\\"drawMs\\":%.6f,\\"readbackMs\\":%.6f,\\"runtimeMs\\":%.6f,\\"inputs\\":%d,\\"inputWidth\\":%d,\\"inputHeight\\":%d,\\"inputRed\\":%d,\\"error\\":%d}\\n",
      static_cast<void*>(this),(unsigned long long)traceThread,traceFrame,(long long)startNs,(long long)endNs,
      std::chrono::duration<double,std::milli>(traceEnd-traceStart).count(),inputDownloadMs,stats.inputMs,stats.drawMs,stats.readbackMs,stats.totalMs,traceInputs,traceInputWidth,traceInputHeight,traceInputRed,!error.empty());
  }''', 1)
source = source.replace('    fprintf(stderr,"AVTRACE ', '    FILE* traceLog=fopen("' + str(OUT / 'trace.jsonl') + '","a"); if(traceLog){fprintf(traceLog,"AVTRACE ' )
source = source.replace('traceInputRed,!error.empty());', 'traceInputRed,!error.empty());fclose(traceLog);}')
trace_source = OUT / 'TraceSketch.cpp'
trace_source.write_text(source)
sdk = subprocess.check_output(['xcrun', '--show-sdk-path'], text=True).strip()
mac = bundle / 'Contents/MacOS'
run(['clang++', '-isysroot', sdk, '-isystem', sdk + '/usr/include/c++/v1', '-std=c++17', '-O2', '-fvisibility=hidden', '-bundle', '-arch', 'arm64', '-mmacosx-version-min=15.0', '-I/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP', trace_source, '-L' + str(mac), '-lavtools_runtime', '-o', mac / 'AvToolsSketch'])
run(['codesign', '--force', '--sign', '-', bundle], capture_output=True)

# Reuse serialized parameter definitions; construct graphs without editor automation.
base = OUT / 'base.tox'
shutil.copy2(ROOT / 'native/td/example/Sketch.tox', base)
subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand', str(base)], capture_output=True)
basedir = OUT / 'base.tox.dir'
assert basedir.is_dir()
component = 'avtools_sketch_example'
cpp_pars = (basedir / component / 'sketch1.cparm').read_bytes()
sketch = OUT / 'sketch.js'
sketch.write_text("function setup(p){p.textSize(48);} function draw(p,f){p.background(f.frame%256,80,160);if(f.top(0))p.image(f.top(0),32,32,p.width-64,p.height-64);p.noStroke();p.fill(255);p.text('Dawn + Rust',100,100);p.circle(960+Math.sin(f.frame/20)*400,540,200);p.fill(f.frame%256,40,200);p.rect(0,0,16,16);}")


def fixture(count, mode):
    name = f'{mode}-{count}'
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
        put(renderer, '.parm', f'?\nplugin 0 {bundle}\nSourcefile 67108928 {sketch}\nWidth 67108928 1920\nHeight 67108928 1080\n?\n')
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
    return {'mean': sum(values)/len(values), 'p50': values[len(values)//2], 'p95': values[int(len(values)*.95)], 'max': values[-1]}


results = []
for mode in ['no-input', 'shared-input', 'independent-input']:
    for count in COUNTS:
        path = fixture(count, mode)
        (OUT/'trace.jsonl').write_text('')
        with path.with_suffix('.jsonl').open('w') as stdout, path.with_suffix('.log').open('w') as stderr:
            run([ROOT / 'build/touchengine-probe', path, FRAMES], stdout=stdout, stderr=stderr, timeout=120)
        outputs = [json.loads(line) for line in path.with_suffix('.jsonl').read_text().splitlines()]
        assert len(outputs) == FRAMES*count, (len(outputs), count)
        for output in outputs[30*count:]:
            assert (output['width'],output['height']) == (1920,1080)
            top = output['visualTop']
            if output['pixelFormat'] == 80: top = [top[2],top[1],top[0],top[3]]
            assert top == [(output['frame']+1)%256,40,200,255], output
        traces = [json.loads(s) for s in re.findall(r'AVTRACE (\{[^\n]+\})', (OUT/'trace.jsonl').read_text())]
        shutil.copy2(OUT/'trace.jsonl', path.with_suffix('.trace.jsonl'))
        traces = [t for t in traces if 31 <= t['frame'] <= FRAMES]
        assert len(traces) == (FRAMES-30)*count, (len(traces),count)
        assert all(not t['error'] for t in traces)
        assert all(t['inputs'] == (0 if mode == 'no-input' else 1) for t in traces)
        if mode != 'no-input':
            assert all((t['inputWidth'],t['inputHeight']) == (1920,1080) for t in traces)
            assert len(set(t['inputRed'] for t in traces)) > 10, 'Input failed to animate'
        groups = [[t for t in traces if t['frame'] == f] for f in range(31,FRAMES+1)]
        overlaps = sum(a['endNs'] > b['startNs'] for group in groups for a,b in zip(sorted(group,key=lambda t:t['startNs']),sorted(group,key=lambda t:t['startNs'])[1:]))
        metrics = {key:summarize([sum(t[key] for t in group) for group in groups]) for key in ['executeMs','inputDownloadMs','inputUploadMs','drawMs','readbackMs','runtimeMs']}
        result = {'mode':mode,'instances':count,'frames':FRAMES-30,'overlappingAdjacentCooks':overlaps,'cookThreads':len(set(t['thread'] for t in traces)),'metricsSumPerFrameMs':metrics}
        results.append(result)
        (OUT/'results.json').write_text(json.dumps(results,indent=2))
        print(json.dumps(result),flush=True)
print('PASS:',OUT/'results.json',flush=True)
