"""Create a finite Execute DAT benchmark (about two minutes). No polling threads."""
from pathlib import Path
root=op('/project1/execution_modes')
folder=Path(__file__).resolve().parent
repo=folder.parents[4]
root.store('benchmark_repo',str(repo))
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
for node in root.children: node.viewer=False
if root.op('benchmark'):root.op('benchmark').par.active=False
# Reuse helpers: deleting DATs with queued UI notifications can crash this TD build.
for i in range(1,5):
    node=root.op('channels'+str(i));node.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip());node.cook(force=True)
xy=(root.op('xy_input') or root.create(scriptCHOP,'xy_input'))
cb=(root.op('xy_callbacks') or root.create(textDAT,'xy_callbacks'))
cb.text='''import numpy as np
def onCook(scriptOp):
 scriptOp.clear();scriptOp.numSamples=int(parent().fetch('points',1))
 a=np.arange(scriptOp.numSamples,dtype=np.float32)*.001+float(absTime.frame)
 scriptOp.appendChan('x').vals=a;scriptOp.appendChan('y').vals=-a
'''
xy.par.callbacks=cb
code=(root.op('benchmark_sketch') or root.create(textDAT,'benchmark_sketch'))
code.text="""function onCook(h){const until=performance.now()+h.inputs.get('work_ms',1);while(performance.now()<until){};for(const name of ['x','y']){const a=h.inputs.samples(name);for(let j=0;j<a.length;j++)a[j]=a[j]*.75+1;h.outputs.setSamples(name,a)}}"""
topcode=(root.op('benchmark_top_sketch') or root.create(textDAT,'benchmark_top_sketch'))
topcode.text="function draw(p,f){p.background(20,30,40);p.noStroke();p.fill(250,120,60);p.circle(960+Math.sin(f.absFrame*.04)*500,540,100)}"
for i in range(1,5):
    node=root.op('channels'+str(i));node.inputConnectors[0].connect(xy);node.inputConnectors[1].connect(root.op('controls'));node.par.Sketch=code;node.par.Outputchannels='x y'
    top=(root.op('bench_top'+str(i)) or root.create(cplusplusTOP,'bench_top'+str(i)));top.par.plugin=str(prebuilt/(prebuilt/'current.txt').read_text().strip());top.cook(force=True)
    top.par.Sketch=topcode;top.par.Width=1920;top.par.Height=1080
callback=(root.op('benchmark') or root.create(executeDAT,'benchmark'))
callback.par.active=False;callback.par.framestart=True;callback.par.frameend=True
callback.text=(folder/'benchmark_callbacks.py').read_text()
callback.par.active=True
print('Started execution-mode benchmark')
