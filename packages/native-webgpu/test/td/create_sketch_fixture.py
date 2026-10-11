"""Run through TD Textport after explicit UI permission. Adds only a new test component."""
from pathlib import Path
import time
import json
root = Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
output = root / 'artifacts/td'
output.mkdir(parents=True, exist_ok=True)
sketch_fixture = (op('/project1') or op('/')).create(baseCOMP, 'avtools_sketch_verify_' + str(int(time.time())))
page = sketch_fixture.appendCustomPage('Verification')
amount = page.appendFloat('Amount', label='Amount')[0]
amount.default = 40
amount.val = 40
source = sketch_fixture.create(textDAT, 'sketch')
source.text = '''let count = 0;
async function setup(p, host) { await host.device.queue.onSubmittedWorkDone(); p.textSize(18); }
function draw(p, frame) {
  count++;
  p.background(frame.chop('amount'), 80, count % 256);
  if (frame.top(0)) p.image(frame.top(0), 0, 0, 32, 32);
  p.noStroke(); p.fill(255); p.text('Dawn + Rust', 36, 28);
  p.fill(frame.frame % 256, 0, 0); p.rect(p.width - 4, p.height - 4, 4, 4);
}'''
controls = sketch_fixture.create(constantCHOP, 'controls')
controls.par.name0 = 'amount'
controls.par.value0.expr = 'parent().par.Amount'
input_top = sketch_fixture.create(constantTOP, 'image')
input_top.par.colorr = 0.25
input_top.par.colorg = 0.5
input_top.par.colorb = 0.75
for i in range(2):
    node = sketch_fixture.create(cplusplusTOP, 'sketch' + str(i+1))
    library = next((p for p in node.pars() if p.name.lower() in ('dll', 'plugin', 'library')), None)
    if library is None:
        raise RuntimeError('Library parameter unavailable: ' + str([(p.name,p.label) for p in node.pars()]))
    library.val = (root / 'build/td-plugin-path.txt').read_text().strip()
    node.cook(force=True)
    node.par.Sketch = source
    node.par.Controls = controls
    node.par.Width = 191 + i*16
    node.par.Height = 79 + i*8
    node.inputConnectors[0].connect(input_top)
    node.nodeX = 200
    node.nodeY = -i*180
    out = sketch_fixture.create(outTOP, 'out'+str(i+1))
    out.par.connectorder = i
    out.inputConnectors[0].connect(node)
    out.nodeX = 420
    out.nodeY = node.nodeY
    info = sketch_fixture.create(infoDAT, 'info'+str(i+1))
    info.par.op = node
sketch_fixture.save(str(output / 'sketch-operators.tox'))
(output / 'sketch-fixture-path.txt').write_text(sketch_fixture.path)
print('Custom TOP fixture:', sketch_fixture.path)
print('Errors:', [n.errors() for n in sketch_fixture.findChildren(type=TOP, depth=1)])
