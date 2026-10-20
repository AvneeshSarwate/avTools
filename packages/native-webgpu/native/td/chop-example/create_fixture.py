"""Run in TD Textport with runpy.run_path(__file__). Creates an isolated example.
Build apps/td-projects/channels first. Existing operators are never replaced.
"""
from pathlib import Path
import td

example = Path(__file__).resolve().parent
repo = example.parents[4]
project_dir = repo / 'apps/td-projects/channels'
prebuilt = repo / 'packages/native-webgpu/prebuilt/macos-arm64'
plugin = prebuilt / (prebuilt / 'current-chop.txt').read_text().strip()
root = td.op('/project1')
if root.op('avtools_channels_example'):
    raise RuntimeError('Example already exists; use it or rename it before creating another.')
component = root.create(td.baseCOMP, 'avtools_channels_example')
page = component.appendCustomPage('Channels')
page.appendStr('Pluginpath', label='Plugin Path')[0].val = str(plugin)
for name, value in [('Value', 1), ('Target', 0), ('Duration', 2)]:
    p = page.appendFloat(name)[0]; p.default = value; p.val = value
page.appendPulse('Trigger', label='Trigger ramp')
page.appendPulse('Reset', label='Reset scripts')
controls = component.create(td.constantCHOP, 'controls')
for i, name in enumerate(['value', 'target', 'duration']):
    getattr(controls.par, 'name'+str(i)).val = name
    getattr(controls.par, 'value'+str(i)).expr = 'parent().par.'+name.title()
controls.nodeX = -450; controls.nodeY = 100
counter = component.create(td.constantCHOP, 'counter')
counter.par.name0 = 'value'; counter.par.value0.expr = 'absTime.frame'
counter.nodeX = -450; counter.nodeY = -330
for name in ['animation', 'passthrough', 'points']:
    dat = component.create(td.textDAT, name+'_source')
    dat.text = (project_dir / 'dist' / (name+'.js')).read_text()
    dat.nodeX = -450; dat.nodeY = -550 if name == 'animation' else -720

def make(name, source, incoming, outputs, x, y):
    node = component.create(td.cplusplusCHOP, name)
    node.par.plugin.expr = 'parent().par.Pluginpath'
    node.cook(force=True)
    node.par.Outputchannels = outputs
    node.par.Outputsamples = 10000 if source == 'points' else 1
    node.par.Sketch = component.op(source+'_source')
    node.inputConnectors[0].connect(incoming)
    node.nodeX = x; node.nodeY = y
    node.cook(force=True)
    return node

for i in range(2):
    node = make('animation'+str(i+1), 'animation', controls, 'value gain ticks pulses', -150, 100-i*200)
    out = component.create(td.outCHOP, 'out'+str(i+1)); out.inputConnectors[0].connect(node); out.par.connectorder = i
    out.nodeX = 100; out.nodeY = node.nodeY
    info = component.create(td.infoCHOP, 'info'+str(i+1)); info.par.op = node
    info.nodeX = 350; info.nodeY = node.nodeY
points = make('points1', 'points', controls, 'x y', 100, -550)
points_out = component.create(td.outCHOP, 'out3'); points_out.inputConnectors[0].connect(points); points_out.par.connectorder = 2
points_out.nodeX = 350; points_out.nodeY = -550
previous = counter
for i in range(4):
    previous = make('pass'+str(i+1), 'passthrough', previous, 'value', -150+i*190, -330)
callbacks = component.create(td.parameterexecuteDAT, 'controls_callbacks')
callbacks.par.op = component; callbacks.par.pars = 'Trigger Reset'; callbacks.par.onpulse = True; callbacks.par.valuechange = False
callbacks.text = '''def onPulse(par):
    nodes = parent().ops('animation*', 'pass*')
    for node in nodes:
        if hasattr(node.par, 'Sendpulse'):
            getattr(node.par, 'Sendpulse' if par.name == 'Trigger' else 'Reset').pulse()
    return
'''
callbacks.nodeX = -450; callbacks.nodeY = 300
readme = component.create(td.textDAT, 'README')
readme.text = '''avTools Channels: V8 + TimeContext\n\nSelect the parent component to change Value / Target / Duration.\nPulse Trigger to ramp each instance's gain toward Target.\nvalue = current input value * animated gain in the same cook.\nReset restarts scripts and cancels their old tasks.\n\nThe lower chain passes absTime.frame through four CHOPs without buffering.\nThe two animation instances have independent persistent state.\nOpen animation_source to inspect the bundled script, or use the IDE project\nin apps/td-projects/channels. See the adjacent README.md for the host API.\n'''
readme.nodeX = -100; readme.nodeY = 300
component.op('out1').display = True
component.save(str(example / 'Channels.tox'))
print('CHOP fixture:', component.path)
print('Errors:', {n.name:n.errors() for n in component.children if n.family == 'CHOP'})
