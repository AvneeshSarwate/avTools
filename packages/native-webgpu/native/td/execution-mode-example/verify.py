"""Synchronous API assertions; intentionally pauses briefly to let workers run."""
import time,json
from pathlib import Path
root=op('/project1/execution_modes');node=root.op('channels1');controls=root.op('controls')
repo=Path(__file__).resolve().parents[5]
checks=[]
def verify(ok,message):
    if not ok: raise AssertionError(message)
    checks.append(message)
controls.par.value1=0;node.par.Samecook=True;node.par.Reset.pulse();node.cook(force=True)
node.par.Eventname='1';node.par.Sendpulse.pulse()
node.par.Eventname='2';node.par.Sendpulse.pulse()
node.par.Eventname='9';node.cook(force=True)
verify(float(node['pulses'][0])==12,'Pulse names captured at press, FIFO, no intervening cook')
previous=float(node['cooks'][0]);node.par.Samecook=False;node.cook(force=True);time.sleep(.04);node.par.Samecook=True;node.cook(force=True)
verify(float(node['cooks'][0])>=previous+2,'Toggle preserves JS state')
playing=op('/').time.play;op('/').time.play=False
before=float(node['ticks'][0]);time.sleep(.08);node.cook(force=True)
verify(float(node['ticks'][0])>before+3,'Independent timers advance while timeline paused')
op('/').time.play=playing
controls.par.value1=50;node.par.Samecook=False
costs=[]
for i in range(20):
    controls.par.value0=i+100
    start=time.perf_counter();node.cook(force=True);costs.append((time.perf_counter()-start)*1000)
verify(max(costs)<30,'Buffered TD cooks do not wait for 50ms JS')
controls.par.value0=777;node.par.Samecook=True;node.cook(force=True)
verify(float(node['value'][0])==1554,'Blocking after overload consumes fresh inputs')
verify(float(node['opposite'][0])==-1554,'Coherent multichannel publication')
controls.par.value1=0;controls.par.value0=7
for i in range(1,5):
    n=root.op('channels'+str(i));n.par.Samecook=(i==1);n.par.Reset.pulse();n.cook(force=True)
report={'checks':checks,'buffered_cook_max_ms':max(costs),'td_version':str(app.version),'td_build':str(app.build)}
(repo/'packages/native-webgpu/artifacts/execution-verify.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
