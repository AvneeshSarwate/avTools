"""Four 1080p TOPs, including TD upload/fences, with raw per-worker timer lateness."""
from pathlib import Path
import json,os,subprocess,time
root=Path(__file__).resolve().parents[2]
output=root/'artifacts/timing'/('td-comparison-'+str(time.time_ns()));output.mkdir()
current=Path((root/'build/td-plugin-path.txt').read_text().strip())
baseline=Path(os.environ.get('AVTOOLS_TIMING_BASELINE') or root/'build/AvToolsSketch-ff53beb1bfa2.plugin')
assert baseline.is_dir(), 'Supply the pre-TimeContext baseline plugin before comparing'
results=[]
frames=os.environ.get('AVTOOLS_TIMING_FRAMES','240')
cases= [('baseline',baseline,0),('current',current,0),('timing240',current,240),('timing1000',current,1000),('baseline-repeat',baseline,0),('current-repeat',current,0)]
if os.environ.get('AVTOOLS_TIMING_COMPARE_ONLY'):
 cases=[('baseline',baseline,0),('current',current,0),('current-repeat',current,0),('baseline-repeat',baseline,0)]
for name,plugin,hz in cases:
 env={**os.environ,'AVTOOLS_BENCH_MODE':'no-input','AVTOOLS_BENCH_PLUGIN':str(plugin),'AVTOOLS_BENCH_TIMING_HZ':str(hz) if hz else ''}
 with (output/(name+'.log')).open('w') as log:
  subprocess.run(['python3',root/'test/td/buffered_scaling.py',frames,'4'],env=env,stdout=log,stderr=log,check=True,timeout=180)
 text=(output/(name+'.log')).read_text();directory=Path(next(line for line in text.splitlines() if line.startswith(str(root/'artifacts/td'))))
 report=json.loads((directory/'results.json').read_text())[0]
 raw=[]
 for path in directory.glob('runtime.log'):
  for line in path.read_text().splitlines():
   if line.startswith('{"suite":"td-timer-lateness"'):
    raw.extend(json.loads(line)['raw'])
 if hz:
  assert len(raw)>=hz*4, (name,len(raw))
  ordered=sorted(raw)
  report['timerLatenessMs']={'count':len(raw),'p50':ordered[len(raw)//2],'p95':ordered[int(len(raw)*.95)],'p99':ordered[int(len(raw)*.99)],'max':ordered[-1]}
  (output/(name+'-timer-raw.json')).write_text(json.dumps(raw))
 results.append({'case':name,'artifacts':str(directory),**report});(output/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results[-1]),flush=True)
print(output,flush=True)
