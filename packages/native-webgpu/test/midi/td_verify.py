"""Run after td_setup.py through the TD Textport; writes assertion results."""
from pathlib import Path
import json, traceback
ROOT = Path('/Users/avneeshsarwate/agentCombine/avTools')
PACKAGE = ROOT / 'packages/native-webgpu'
fixture = op('/project1/avtools_midi_test')
nodes = [fixture.op(name) for name in ('channels1','channels2','picture1','picture2')]
devices = json.loads((PACKAGE/'build/midi-test/devices.json').read_text())
records = []
for node in nodes:
    marker = 'current-chop.txt' if node.name.startswith('channels') else 'current.txt'
    pre = PACKAGE/'prebuilt/macos-arm64'
    node.par.plugin = str(pre/(pre/marker).read_text().strip())
    node.cook(force=True)
    node.par.Samecook = True
    node.par.Typescript = str(PACKAGE/'native/td/midi-example'/('channels.ts' if node.name.startswith('channels') else 'picture.ts'))
    node.cook(force=True)

def later(fn, frames=90):
    run('args[0]()',fn,delayFrames=frames)

def values():
    for node in nodes: node.cook(force=True)
    values = [float(node['value'][0]) for node in nodes[:2]]
    pixels = []
    for node in nodes[2:]:
        a = node.numpyArray(delayed=False)
        assert a is not None
        xs = (a[:,:,2] > 0.5).nonzero()[1]
        assert len(xs)
        pixels.append(float(xs.mean())/node.width)
    assert not any(node.errors() for node in nodes), [node.errors() for node in nodes]
    return values, pixels

def check(expected, tag):
    v,p = values()
    assert all(abs(x-expected)<0.02 for x in v+p), (tag,v,p,expected)
    records.append({'stage':tag,'channels':v,'circle_positions':p})

def select(value):
    for node in nodes:
        node.par.Controller = value
        node.cook(force=True)

def guard(fn):
    def wrapped():
        try: fn()
        except Exception:
            (PACKAGE/'test/midi/results/td.json').write_text(json.dumps({'passed':False,'records':records,'error':traceback.format_exc()},indent=2))
            raise
    return wrapped

@guard
def start():
    for node in nodes: node.cook(force=True)
    ready = True
    for node in nodes:
        info = fixture.op(node.name+'_info') or fixture.create(infoDAT,node.name+'_info')
        info.par.op=node.name
        info.cook(force=True)
        ready = ready and 'build_state\tready' in info.text
    if not ready or not all(getattr(node.par,'Controller',None) is not None for node in nodes):
        later(start,10);return
    select(devices['a'])
    later(shared)

@guard
def shared():
    check(25/127,'four instances share source A')
    nodes[0].par.Reset.pulse();nodes[0].cook(force=True)
    later(reloaded)

@guard
def reloaded():
    check(25/127,'one instance reset; peers keep source A')
    select(devices['b'])
    later(switched)

@guard
def switched():
    check(100/127,'all switched to source B')
    select('__avtools_none__')
    later(disconnected)

@guard
def disconnected():
    check(100/127,'None closes without resetting script state')
    select('missing-test-device')
    later(missing)

@guard
def missing():
    assert all(node.par.Controller.eval()=='missing-test-device' for node in nodes)
    assert not any(node.errors() for node in nodes)
    records.append({'stage':'missing device preserved without runtime error'})
    select(devices['a'])
    later(reconnected)

@guard
def reconnected():
    check(25/127,'reselect source A')
    result={'passed':True,'td_build':str(app.build),'records':records}
    (PACKAGE/'test/midi/results/td.json').write_text(json.dumps(result,indent=2)+'\n')
    print('PASS MIDI TD:',result)

later(start,60)
