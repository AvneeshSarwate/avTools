"""Summarize completed TD measurements and native test logs into checked-in evidence."""
import json,statistics,re
from pathlib import Path
repo=Path(__file__).resolve().parents[5]
artifacts=repo/'packages/native-webgpu/artifacts'
results=repo/'packages/native-webgpu/test/chop/results'
results.mkdir(exist_ok=True)
data=json.loads((artifacts/'execution-benchmark.json').read_text())
def distribution(values):
    if not values:return None
    a=sorted(values)
    return {name:a[min(len(a)-1,int(len(a)*q))] for name,q in [('p50',.5),('p95',.95),('p99',.99),('max',1)]}
reports=[]
for r in data['reports']:
    samples=r['samples'];n=r['stage']['instances']
    summary=dict(stage=r['stage'],sample_frames=len(samples),cpu_percent_one_core=r['cpu_percent_one_core'],
        total_cook_ms=distribution([sum(s['cook_ms']) for s in samples]),
        per_instance_cook_ms=distribution([v for s in samples for v in s['cook_ms']]),
        td_frame_ms=distribution([s['frame_ms'] for s in samples]),
        age_ms=distribution([v for s in samples for v in s['age_ms'] if v>=0]),
        total_upload_ms=distribution([sum(s['upload_ms']) for s in samples]) if r['stage']['kind']=='top' else None,
        errors=[e for s in samples for e in s['errors']])
    if r['stage']['kind']=='chop':
        first,last=samples[0],samples[-1]
        summary['reused_percent']=100*sum(b-a for a,b in zip(first['reused'],last['reused']))/(n*(len(samples)-1))
        summary['coalesced_per_cook']=sum(b-a for a,b in zip(first['coalesced'],last['coalesced']))/(n*(len(samples)-1))
        summary['worker_ms']=distribution([v for s in samples for v in s['worker_ms']])
    reports.append(summary)
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
report=dict(hardware='Apple M1 Max, 32 GiB RAM',td_build=data['td_build'],date='2026-10-20',
    measured_plugins={k:Path(v).name for k,v in data['plugins'].items()},
    shipping_plugins={marker:(prebuilt/marker).read_text().strip() for marker in ['current.txt','current-chop.txt']},
    measured_age='CHOP input age; TOP time since worker completion',reports=reports,
    verification=json.loads((artifacts/'execution-verify.json').read_text()),top_verification=json.loads((artifacts/'execution-top-verify.json').read_text()))
(results/'2026-10-20-execution-td.json').write_text(json.dumps(report,indent=2)+'\n')
log=Path('/private/tmp/avtools-execution-final.log').read_text()
native=[json.loads(line[6:]) for line in log.splitlines() if line.startswith('BENCH ')]
soak=Path('/private/tmp/avtools-execution-soak.log').read_text()
(results/'2026-10-20-execution-native.json').write_text(json.dumps(dict(benchmarks=native,soak=[line for line in soak.splitlines() if line.startswith('SOAK ')],exchange_tsan=Path('/private/tmp/avtools-exchange-tsan.log').read_text().strip()),indent=2)+'\n')
for r in reports:
    if r['stage'].get('instances')==4:print(r['stage'],r['total_cook_ms'],'age',r['age_ms'],'reuse',r.get('reused_percent'),'errors',len(r['errors']))
