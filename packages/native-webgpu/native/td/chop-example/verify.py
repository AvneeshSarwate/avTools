"""Run in TD after create_fixture.py. Writes ignored artifacts/chop-td.json.
Exercises current inputs, independent tasks, pulses, reload/errors and four-node
same-frame chaining, then collects 1000 actual TD frame/cook timings.
"""
from pathlib import Path
import json
import time
import td

example = Path(__file__).resolve().parent
report = example.parents[2] / 'artifacts/chop-td.json'
report.parent.mkdir(parents=True, exist_ok=True)
c = td.op('/project1/avtools_channels_example')
a, b = c.op('animation1'), c.op('animation2')
for node in [a, b]:
    node.par.Reset.pulse(); node.cook(force=True)
assert not a.errors() and not b.errors(), (a.errors(), b.errors())
# Input changes and channel state are visible in the same call, even on one TD frame.
c.par.Value = 3.25; a.cook(force=True)
assert abs(float(a['value'][0]) - 3.25) < 1e-5
# TD is blocked during this sleep, so no TD cooks can happen. Native timers must run.
ticks = float(a['ticks'][0]); time.sleep(.16); a.cook(force=True)
assert float(a['ticks'][0]) >= ticks + 8, 'timers stopped between cooks'
c.par.Target = .25; c.par.Duration = .08; a.par.Sendpulse.pulse(); a.cook(force=True)
assert float(a['pulses'][0]) == 1
assert float(b['pulses'][0]) == 0, 'instances shared state'
time.sleep(.14); a.cook(force=True)
assert abs(float(a['gain'][0])-.25)<1e-4
assert abs(float(a['value'][0])-3.25*.25)<1e-4
# Exercise error recovery and last-good setup using an isolated test DAT.
test_source = c.create(td.textDAT, 'verification_source')
a.par.Sketch = test_source
test_source.text = "function setup(){throw Error('expected bad setup')}"
a.cook(force=True)
assert 'expected bad setup' in a.warnings() and not a.errors()
assert abs(float(a['gain'][0])-.25)<1e-4, 'failed setup discarded active state'
test_source.text = "function onCook(h){h.outputs.set('value',NaN)}"
a.cook(force=True)
assert 'finite' in a.errors()
# Successful reset clears error and restores initial gain.
a.par.Sketch = c.op('animation_source'); a.par.Reset.pulse(); a.cook(force=True)
assert not a.errors() and float(a['gain'][0]) == 1
# Two actual input connections with duplicate channel names remain distinguishable.
test_source.text = "function onCook(h){h.outputs.set('value',h.inputs.get('value',0)+h.inputs.get('value',1)+h.inputs.get('absent'));}"
a.par.Sketch = test_source; a.inputConnectors[1].connect(c.op('counter')); a.cook(force=True)
assert float(a['value'][0]) == 3.25+float(c.op('counter')['value'][0])
a.inputConnectors[1].disconnect(); a.par.Sketch = c.op('animation_source'); a.par.Reset.pulse(); a.cook(force=True)
test_source.destroy()
c.par.Value = 1; c.par.Target = 0; c.par.Duration = 2
for n in [a,b]: n.par.Reset.pulse(); n.cook(force=True)
# Test the example's parent pulse controls too.
c.par.Trigger.pulse()

probe = c.create(td.executeDAT, 'verification')
probe.par.framestart = False; probe.par.frameend = True
probe.text = '''from pathlib import Path
import json
rows = []
failures = []
names = ['pass1','pass2','pass3','pass4','animation1','animation2']
def onFrameEnd(frame):
    c = parent()
    c.op('pass4').cook(force=True)
    for name in ['animation1','animation2']: c.op(name).cook(force=True)
    if len(rows) == 2 and any(float(c.op(name)['pulses'][0]) < 1 for name in ['animation1','animation2']):
        failures.append('parent Trigger callback failed')
    expected = float(c.op('counter')['value'][0])
    values = [float(c.op(name)['value'][0]) for name in names[:4]]
    if any(value != expected for value in values): failures.append([absTime.frame,expected,values])
    errors = {name:c.op(name).errors() for name in names if c.op(name).errors()}
    if errors: failures.append(errors)
    rows.append({name:float(c.op(name).cpuCookTime) for name in names})
    if len(rows) >= 1050:
        measured = rows[50:]
        def summary(values):
            values=sorted(values)
            return {'median':values[len(values)//2], 'p95':values[int(len(values)*.95)], 'max':max(values)}
        result={'frames':len(measured), 'same_frame_checks':len(rows)*4, 'failures':failures,
                'cpu_cook_ms':{name:summary([r[name] for r in measured]) for name in names},
                'sum_six_cpu_cook_ms':summary([sum(r.values()) for r in measured]),
                'unit_checks':'input freshness, timers without cooks, ramp, pulses, isolation, failed setup, NaN, reset, multi-input'}
        Path(REPORT).write_text(json.dumps(result,indent=2))
        me.par.active=False
        print('CHOP TD verification:',result)
    return
'''.replace('REPORT', repr(str(report)))
print('Immediate checks passed; collecting 1050 frames:', report)
