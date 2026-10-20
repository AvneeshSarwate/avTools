"""Live TD XY stress: four operators, 10k/100k points, same-cook correctness.
Run via runpy in Textport. Saves an openable component and an ignored JSON report.
"""
from pathlib import Path
import td
example = Path(__file__).resolve().parent
report = example.parents[2] / 'artifacts/chop-stress-td.json'
root = td.op('/project1')
if root.op('avtools_channels_stress'):
    raise RuntimeError('Stress fixture exists; use its Restart pulse or rename it first.')
c = root.create(td.baseCOMP, 'avtools_channels_stress')
page = c.appendCustomPage('Stress')
page.appendStr('Pluginpath')[0].val = td.op('/project1/avtools_channels_example').par.Pluginpath.eval()
page.appendInt('Points')[0].val = 10000
page.appendPulse('Restart')
source = c.create(td.textDAT,'transform_source')
source.text = '''function onCook(h) {
  for (const name of ['x','y']) {
    const values = h.inputs.samples(name);
    for (let i=0;i<values.length;i++) values[i] = values[i]*2+1;
    h.outputs.setSamples(name,values);
  }
}'''
generate = c.create(td.textDAT,'generate_source')
generate.text = '''let x,y;
function setup(h){x=new Float32Array(h.outputs.sampleCount);y=new Float32Array(x.length);}
function onCook(h,f){
  for(let i=0;i<x.length;i++){x[i]=i/x.length;y[i]=-x[i];}
  h.outputs.setSamples('x',x);h.outputs.setSamples('y',y);
}'''
lerp = c.create(td.textDAT,'lerp_source')
lerp.text = '''function onCook(h) {
  const mix = h.inputs.get('mix',2);
  for (const name of ['x','y']) {
    const a = h.inputs.samples(name,0), b = h.inputs.samples(name,1);
    for (let i=0;i<a.length;i++) a[i] = a[i]+(b[i]-a[i])*mix;
    h.outputs.setSamples(name,a);
  }
}'''
input_callbacks=c.create(td.textDAT,'input_callbacks')
input_callbacks.text='''import numpy as np
def onCook(scriptOp):
    count=int(parent().par.Points)
    scriptOp.clear(); scriptOp.numSamples=count
    x=np.arange(count,dtype=np.float32)/count+absTime.frame
    y=-x
    if scriptOp.name=='inputB':
        x=(absTime.frame%127)*.25-np.arange(count,dtype=np.float32)/count
        y=x*.5+3
    scriptOp.appendChan('x').copyNumpyArray(x.astype(np.float32))
    scriptOp.appendChan('y').copyNumpyArray(y.astype(np.float32))
    return
'''
incoming=c.create(td.scriptCHOP,'input');incoming.par.callbacks=input_callbacks
incoming.nodeX=-300
incoming_b=c.create(td.scriptCHOP,'inputB');incoming_b.par.callbacks=input_callbacks;incoming_b.nodeX=-300;incoming_b.nodeY=-200
mix=c.create(td.constantCHOP,'mix');mix.par.name0='mix';mix.par.value0.expr='(absTime.frame % 101) / 100';mix.nodeX=-300;mix.nodeY=-400
for i in range(4):
    node=c.create(td.cplusplusCHOP,'points'+str(i+1));node.par.plugin.expr='parent().par.Pluginpath';node.cook(force=True)
    node.par.Outputchannels='x y';node.par.Outputsamples.expr='parent().par.Points';node.par.Sketch=source
    node.inputConnectors[0].connect(incoming);node.nodeX=i*200;node.nodeY=-200
    node.cook(force=True)
probe=c.create(td.executeDAT,'benchmark');probe.par.framestart=False;probe.par.frameend=True
probe.text='''from pathlib import Path
import numpy as np
import json,time
cases=[(10000,'output'),(10000,'transform'),(10000,'lerp'),(100000,'lerp')]
case=0; rows=[];results=[];failures=[];initialized=False

def configure():
    global initialized
    points,mode=cases[case];c=parent();c.par.Points=points
    for n in c.ops('points*'):
        for connector in n.inputConnectors: connector.disconnect()
        if mode=='output':
            n.par.Sketch=c.op('generate_source')
        else:
            n.inputConnectors[0].connect(c.op('input'));n.par.Sketch=c.op('transform_source')
            if mode=='lerp':
                n.par.Sketch=c.op('lerp_source');n.inputConnectors[1].connect(c.op('inputB'));n.inputConnectors[2].connect(c.op('mix'))
        n.par.Reset.pulse()
    initialized=True

def onFrameEnd(frame):
    global case,rows,initialized
    if not initialized: configure()
    c=parent();points,mode=cases[case];nodes=[c.op('points'+str(i+1)) for i in range(4)]
    c.op('input').cook(force=True)
    expected=c.op('input').numpyArray()
    if mode=='output':
        x=(np.arange(points,dtype=np.float64)/points).astype(np.float32);expected=np.stack((x,-x))
    if mode=='transform':expected=expected*2+1
    if mode=='lerp':
        c.op('inputB').cook(force=True);c.op('mix').cook(force=True)
        b=c.op('inputB').numpyArray().astype(np.float64);a=expected.astype(np.float64)
        expected=(a+(b-a)*float(c.op('mix')['mix'][0])).astype(np.float32)
    start=time.perf_counter()
    for n in nodes:n.cook(force=True)
    wall_ms=(time.perf_counter()-start)*1000
    for n in nodes:
        if n.errors():failures.append({'node':n.name,'error':n.errors()});me.par.active=False;raise RuntimeError(n.errors())
        actual=n.numpyArray()
        if not np.array_equal(actual,expected):
            failures.append({'frame':int(absTime.frame),'node':n.name,'points':points,'mode':mode,'max_error':float(np.max(np.abs(actual-expected)))})
    rows.append({'wall':wall_ms,'cpu':[float(n.cpuCookTime) for n in nodes], 'input_cpu':float(c.op('input').cpuCookTime)+(float(c.op('inputB').cpuCookTime)+float(c.op('mix').cpuCookTime) if mode=='lerp' else 0)})
    if len(rows)>=550:
        def stats(a):
            a=sorted(a);return {'median':a[len(a)//2],'p95':a[int(len(a)*.95)],'max':max(a)}
        measured=rows[50:]
        results.append({'points':points,'mode':mode,'instances':4,'frames':len(measured),
          'four_cooks_wall_ms':stats([r['wall'] for r in measured]),
          'per_operator_cpu_ms':[stats([r['cpu'][i] for r in measured]) for i in range(4)],
          'input_generator_cpu_ms':stats([r['input_cpu'] for r in measured])})
        case+=1;rows=[];initialized=False
        if case==len(cases):
            Path(REPORT).write_text(json.dumps({'results':results,'failures':failures},indent=2))
            me.par.active=False;print('XY stress complete:',results,'failures:',len(failures))
    return
'''.replace('REPORT',repr(str(report)))
restart=c.create(td.parameterexecuteDAT,'restart');restart.par.op=c;restart.par.pars='Restart';restart.par.onpulse=True;restart.par.valuechange=False
restart.text="def onPulse(par):\n    parent().op('benchmark').par.active=False\n    parent().op('benchmark').text=parent().op('benchmark').text+'\\n'\n    parent().op('benchmark').par.active=True\n"
readme=c.create(td.textDAT,'README');readme.text='Four instances: 10k XY output, affine transform, and two-buffer interpolation at 10k/100k points.\nRestart runs four 550-frame cases. First 50 frames excluded from timing.\nEvery sample checked against the current frame. Output report path is in benchmark DAT.\n'
print('XY stress running:',c.path,report)

# Arrange the example so its sources and controls remain easy to inspect.
for i,name in enumerate(['generate_source','transform_source','lerp_source','input_callbacks']):
    c.op(name).nodeX=-650+i*250;c.op(name).nodeY=500
for i,name in enumerate(['benchmark','restart','README']):
    c.op(name).nodeX=-650+i*250;c.op(name).nodeY=300
for i,name in enumerate(['input','inputB','mix']):
    c.op(name).nodeX=-450;c.op(name).nodeY=-i*200
for i in range(4):
    c.op('points'+str(i+1)).nodeX=0;c.op('points'+str(i+1)).nodeY=-i*200
