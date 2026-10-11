"""Run in TouchDesigner's Textport to create an isolated, additive test component.
No existing operators are removed or replaced. Saves only the generated .tox.
"""
from pathlib import Path
import time

output = Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu/artifacts/td')
output.mkdir(parents=True, exist_ok=True)
parent = op('/project1') or op('/')
fixture = globals().get('fixture')
if fixture is None or not fixture.name.startswith('avtools_dawn_verify_'):
    fixture = parent.create(baseCOMP, 'avtools_dawn_verify_' + str(int(time.time())))
page = fixture.appendCustomPage('Verification')
for index in range(3):
    parameter = getattr(fixture.par, 'Sender' + str(index + 1), None)
    if parameter is None:
        parameter = page.appendStr('Sender' + str(index + 1), label='Syphon sender ' + str(index + 1))[0]
    parameter.default = 'node:avTools TD ' + str(index)
    parameter.val = parameter.default
    source = fixture.op('receive' + str(index + 1)) or fixture.create(syphonspoutinTOP, 'receive' + str(index + 1))
    source.par.sendername.expr = "parent().par.Sender" + str(index + 1)
    source.nodeX = 0
    source.nodeY = -index * 160
    output_top = fixture.op('out' + str(index + 1)) or fixture.create(outTOP, 'out' + str(index + 1))
    output_top.inputConnectors[0].connect(source)
    output_top.nodeX = 200
    output_top.nodeY = source.nodeY
    output_top.par.connectorder = index
fixture.save(str(output / 'syphon-receivers.tox'))
(output / 'fixture-path.txt').write_text(fixture.path)
print('Created', fixture.path, 'and saved', output / 'syphon-receivers.tox')
