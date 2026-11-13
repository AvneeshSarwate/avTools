"""Run in the same Textport namespace as create_sketch_fixture.py; modifies only that fixture."""
import numpy as np
import json
import time
nodes = [sketch_fixture.op('sketch1'), sketch_fixture.op('sketch2')]
source = sketch_fixture.op('sketch')
original = source.text
results = {}
def pixels(node):
    node.cook(force=True)
    data = node.numpyArray(delayed=False)
    if data is None:
        raise RuntimeError(node.errors() or 'No TOP pixels')
    return np.rint(data*255).astype(np.uint8)
for index, n in enumerate(nodes):
    data = pixels(n)
    assert not n.errors(), n.errors()
    assert data.shape == (79+index*8,191+index*16,4), data.shape
    assert list(data[data.shape[0]//2,data.shape[1]//2,:2]) == [40,80], data[data.shape[0]//2,data.shape[1]//2]
    white = int(np.count_nonzero(np.all(data[:,:,:3]>240,axis=2)))
    assert white>20, white
    results[n.name] = {'shape':list(data.shape),'whiteTextPixels':white,'first':data[1,1].tolist(),'last':data[-2,1].tolist()}
sketch_fixture.par.Amount = 90
for n in nodes:
    data = pixels(n)
    assert data[data.shape[0]//2,data.shape[1]//2,0]==90
results['chopChange'] = True
source.text = "let level=0;function onPulse(name,p,f){if(name==='Trigger')level+=f.chop('amount')+f.chop('missing');}function draw(p){p.background(level,0,0);}"
for n in nodes:
    pixels(n)
n = nodes[0]
n.par.Eventname = 'Trigger'
n.par.Sendpulse.pulse()
n.par.Sendpulse.pulse()
data = pixels(n)
assert int(data[0,0,0]) == 180, data[0,0]
assert int(pixels(n)[0,0,0]) == 180
assert int(pixels(nodes[1])[0,0,0]) == 0
results['pulsesAndIsolation'] = True
n.par.Reset.pulse()
assert int(pixels(n)[0,0,0]) == 0
source.text = 'function draw( broken'
pixels(n)
assert 'SyntaxError' in n.errors(), n.errors()
results['compileError'] = n.errors()
source.text = "function draw(){throw new Error('expected draw failure')}"
pixels(n)
assert 'expected draw failure' in n.errors(), n.errors()
results['drawError'] = n.errors()
source.text = 'function draw(){while(true){}}'
started = time.perf_counter()
pixels(n)
assert 'budget' in n.errors(), n.errors()
results['runawaySeconds'] = time.perf_counter()-started
assert results['runawaySeconds']<3
source.text = original
n.par.Reset.pulse()
n.par.Width = 199
n.par.Height = 83
data = pixels(n)
assert not n.errors(), n.errors()
assert data.shape == (83,199,4)
results['resetAndResize'] = True
n.par.Width = 191
n.par.Height = 79
sketch_fixture.par.Amount = 40
for n in nodes:
    pixels(n)
sketch_fixture.save(str(output / 'sketch-operators.tox'))
(output / 'sketch-editor-verification.json').write_text(json.dumps(results,indent=2))
print('Custom TOP verification passed:',json.dumps(results))
