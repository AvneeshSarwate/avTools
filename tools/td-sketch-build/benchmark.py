"""Benchmark the built starter bundles in real TouchEngine at 1080p.
python3 tools/td-sketch-build/benchmark.py [frames=360] [counts=2,4]
Requires the existing native plugin, touchengine-probe and Metal access.
"""
from pathlib import Path
import importlib.util
import json
import shutil
import subprocess
import sys

repo = Path(__file__).resolve().parents[2]
native = repo / 'packages/native-webgpu'
starter = repo / 'apps/td-projects/starter'
# Reuse the established upload/fence benchmark and its private tracing plugin.
frames = int(sys.argv[1]) if len(sys.argv) > 1 else 360
counts = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [2, 4]
assert frames > 61, 'At least 62 frames are needed after warmup/export exclusions'
sys.argv = [sys.argv[0], str(frames), ','.join(map(str, counts))]
spec = importlib.util.spec_from_file_location('scaling', native / 'test/td/buffered_scaling.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
results = []
for count in counts:
    path = b.fixture(count, 'no-input')
    directory = path.with_suffix('.tox.dir')
    component = directory / b.component
    output = b.OUT / f'operator-{count}.json'
    for i in range(count):
        name = 'particles' if i % 2 == 0 else 'background'
        parm = component / f'renderer{i}.parm'
        parm.write_text(parm.read_text().replace(str(b.sketch), str(starter / 'dist' / (name + '.js'))).replace('Width ', 'Controls 67108928 controls\nWidth '))
        (component / f'metrics{i}.n').write_text('CHOP:info\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
        (component / f'metrics{i}.parm').write_text(f'?\nop 0 renderer{i}\n?\n')
    (component / 'controls.n').write_text('CHOP:constant\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
    (component / 'controls.parm').write_text('?\nconst0name 0 amount\nconst0value 0 40\n?\n')
    (component / 'measure.n').write_text('DAT:execute\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
    (component / 'measure.parm').write_text('?\nframestart 0 0\nframeend 0 1\n?\n')
    code = f'''import json
from pathlib import Path
rows = []
def onFrameEnd(frame):
    for i in range({count}):
        n = parent().op('renderer'+str(i))
        metrics = parent().op('metrics'+str(i))
        values = {{c.name: float(c[0]) for c in metrics.chans()}}
        rows.append(dict(frame=int(frame), node=n.name, cpuCookMs=n.cpuCookTime, error=n.errors(), metrics=values))
    if len(rows) == {count}*{frames}:
        Path({str(output)!r}).write_text(json.dumps(rows))
    return
'''.encode()
    header = (b.basedir / b.component / 'sketch.text').read_bytes()[:23]
    (component / 'measure.text').write_bytes(header + len(code).to_bytes(4, 'big') + code)
    toc = path.with_suffix('.tox.toc')
    additions = [str(p.relative_to(directory)) for p in sorted(component.iterdir()) if p.stem.startswith(('metrics', 'measure', 'controls'))]
    toc.write_text(toc.read_text().rstrip() + '\n' + '\n'.join(additions) + '\n')
    path.unlink()
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse', str(toc)], capture_output=True)
    assert path.is_file()
    (b.OUT / 'trace.jsonl').write_text('')
    with path.with_suffix('.jsonl').open('w') as out, path.with_suffix('.log').open('w') as log:
        b.run([native / 'build/touchengine-probe', path, frames, '--buffered-bench'], stdout=out, stderr=log, timeout=120)
    rows = json.loads(output.read_text())
    assert len(rows) == frames*count, (len(rows), frames, count)
    # Exclude warmup and the final frame, which serializes the metrics to disk.
    # TD's timeline may loop; use capture order instead of timeline frame numbers.
    rows = rows[60*count:-count]
    assert len(rows) == (frames-61)*count, (len(rows), frames, count)
    assert all(not row['error'] for row in rows), [row for row in rows if row['error']][:2]
    outputs = [json.loads(line) for line in path.with_suffix('.jsonl').read_text().splitlines()]
    outputs = [row for row in outputs if 60 <= row['frame'] < frames - 1]
    assert len(outputs) == (frames-61)*count
    assert all((row['width'],row['height']) == (1920,1080) for row in outputs)
    assert all(row['top'][3] == 255 for row in outputs)
    assert all(row['fences'] == count for row in outputs)
    host = {row['frame']: row for row in outputs}
    operators = {}
    for i in range(count):
        samples = [row for row in rows if row['node'] == f'renderer{i}']
        keys = ['cook_ms','draw_submit_ms','readback_wait_ms','worker_ms','upload_enqueue_ms','output_age_frames']
        operators[f'{i}-'+('particles' if i%2==0 else 'background')] = {
            'tdCpuCookMs': b.summarize([row['cpuCookMs'] for row in samples]),
            **{key: b.summarize([row['metrics'][key] for row in samples]) for key in keys}}
    result = {'instances': count, 'size': [1920,1080], 'frames': frames-61, 'plugin': str(b.original), 'operators': operators,
              'tdCpuCookSumMs': b.summarize([sum(row['cpuCookMs'] for row in rows[i:i+count]) for i in range(0,len(rows),count)]),
              'olderThanOneFrameOutputs': sum(row['metrics']['output_age_frames'] > 1 for row in rows),
              'hostMs': {key: b.summarize([row[key] for row in host.values()]) for key in ['cookMs','gpuReadyMs','scheduleSlipMs']},
              'missedDeadlines': sum(row['gpuReadyMs']+row['scheduleSlipMs'] > 1000/60 for row in host.values())}
    shutil.copy2(b.OUT / 'trace.jsonl', b.OUT / f'trace-{count}.jsonl')
    results.append(result)
    (b.OUT / 'starter-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(result),flush=True)
print(b.OUT / 'starter-results.json')
