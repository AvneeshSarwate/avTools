from pathlib import Path
import json,statistics
folder=Path(__file__).resolve().parent
data=json.loads((folder/'td-performance.json').read_text())
def q(values):
    values=sorted(x for x in values if x is not None)
    return {name:values[min(len(values)-1,int(len(values)*pct))] for name,pct in [('p50',.5),('p95',.95),('p99',.99)]}
result={'passed':data['passed'],'conditions':{k:data[k] for k in ['td_build','top_size','top_count','xy_points']},'cases':{}}
for case in dict.fromkeys(s['case'] for s in data['samples']):
    rows=[s for s in data['samples'] if s['case']==case]
    result['cases'][case]={'frames':len(rows),'top_cpu_ms':q(r['cpu_ms'] for s in rows for r in s['ops'][:4]),'chop_cpu_ms':q(s['ops'][4]['cpu_ms'] for s in rows),'top_worker_ms':q(r['worker_ms'] for s in rows for r in s['ops'][:4]),'top_upload_enqueue_ms':q(r['upload_ms'] for s in rows for r in s['ops'][:4]),'chop_script_ms':q(s['ops'][4]['draw_ms'] for s in rows),'total_source_cpu_ms':q(s['source_cpu_ms'] for s in rows),'combined_cpu_ms':q(s['source_cpu_ms']+s['info_cpu_ms'] for s in rows),'source_wall_ms':q(s['source_wall_ms'] for s in rows),'info_dat_cpu_ms':q(s['info_cpu_ms'] for s in rows),'frame_interval_ms':q(s['interval_ms'] for s in rows),'peak_rss_mib':max(s['max_rss_mib'] for s in rows)}
(folder/'td-performance-summary.json').write_text(json.dumps(result,indent=2)+'\n')
print('Passed:',data['passed'])
for name,r in result['cases'].items():print(name,'TOP',r['top_cpu_ms'],'CHOP',r['chop_cpu_ms'],'total',r['total_source_cpu_ms'],'info',r['info_dat_cpu_ms'],'interval',r['frame_interval_ms'])
print('errors',list(dict.fromkeys(r['errors'] for s in data['samples'] for r in s['ops'] if r['errors'])))
