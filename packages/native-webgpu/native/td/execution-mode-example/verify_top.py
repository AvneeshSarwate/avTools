"""Run after benchmark.py while its TOP helpers still exist."""
import time,json
from pathlib import Path
root=op('/project1/execution_modes');node=root.op('bench_top1');script=root.op('benchmark_top_sketch')
repo=Path(__file__).resolve().parents[5]
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
node.par.plugin=str(prebuilt/(prebuilt/'current.txt').read_text().strip());node.cook(force=True)
node.par.Pretrigger=False;node.par.Samecook=True
script.text="let value=0;function onPulse(n){value=value*10+Number(n)}function draw(p){const until=performance.now()+50;while(performance.now()<until){};p.background(value,0,0)}"
node.par.Reset.pulse();node.cook(force=True)
node.par.Eventname='1';node.par.Sendpulse.pulse();node.par.Eventname='2';node.par.Sendpulse.pulse();node.par.Eventname='9'
node.par.Samecook=False;node.cook(force=True)
node.par.Samecook=True;t=time.perf_counter();node.cook(force=True);cost=(time.perf_counter()-t)*1000
info=root.op('top_status1');info.cook(force=True)
assert float(info['output_age_frames'][0])==0,'TOP blocking switch did not render current inputs'
assert cost>=40,'TOP blocking switch skipped in-flight work'
value=float(node.numpyArray(delayed=False)[0,0,0]);assert abs(value-12/255)<.005,(value,'TOP pulse capture')
node.par.Pretrigger=True;node.cook(force=True);info.cook(force=True)
assert float(info['effective_wait'][0])==0,'Pretrigger did not suppress blocking'
report=dict(checks=['TOP blocking switch waits then renders current frame','TOP FIFO captured pulse names','Pretrigger overrides requested wait'],switch_wait_ms=cost,pixel=value)
(repo/'packages/native-webgpu/artifacts/execution-top-verify.json').write_text(json.dumps(report,indent=2));print(report)
