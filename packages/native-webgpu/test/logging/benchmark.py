"""Create isolated 4x1080p + 10k XY benchmark in TD; run onFrameStart."""
from pathlib import Path
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
folder=repo/'packages/native-webgpu/test/logging';pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
root=op('/project1').create(baseCOMP,'logging_benchmark');root.time.play=True
if len(ui.panes)>1:ui.panes[1].owner=root
controls=root.create(constantCHOP,'controls');controls.par.name0='mode';controls.par.value0=0
callbacks=root.create(textDAT,'input_callbacks');callbacks.text='''import numpy as np
def onCook(op):
 op.clear();op.numSamples=10000
 a=np.arange(10000,dtype=np.float32)/10000
 for name,values in [('ax',a),('ay',-a),('bx',1-a),('by',a*2)]:op.appendChan(name).copyNumpyArray(values)
'''
source=root.create(scriptCHOP,'points');source.par.callbacks=callbacks;source.cook(force=True);source.lock=True
common="""let frames=0;const data=new Float32Array(20000);
function log(mode){if(mode===1)console.info('frame',frames);else if(mode===2)console.debug('filtered',data);else if(mode===3)console.log('buffer',data);else if(mode===4)for(let i=0;i<100;i++)console.info('burst',frames,i);}
"""
top_source=root.create(textDAT,'top_source');top_source.text=common+"function draw(p,f){frames++;log(f.chop('mode'));p.background(10,20,30);p.noStroke();p.fill(255,160,20);p.circle(960+Math.sin(frames/40)*400,540,300)}"
chop_source=root.create(textDAT,'chop_source');chop_source.text=common+"""function onCook(h){frames++;log(h.inputs.get('mode',1));const a=h.inputs.samples('ax'),b=h.inputs.samples('bx'),y=h.inputs.samples('ay'),z=h.inputs.samples('by');const t=.5+.5*Math.sin(frames/60);for(let i=0;i<a.length;i++){a[i]+=(b[i]-a[i])*t;y[i]+=(z[i]-y[i])*t;}h.outputs.setSamples('x',a);h.outputs.setSamples('y',y)}"""
oldtop='AvToolsSketch-fb99bddcf431.plugin';oldchop='AvToolsChannels-ab5e3d6d5fef.plugin'
baseline=repo/'packages/native-webgpu/build/logging-baseline'
if not (baseline/oldtop).is_dir():baseline=pre
groups=[('new',str(pre/(pre/'current.txt').read_text().strip()),str(pre/(pre/'current-chop.txt').read_text().strip()))]
if (baseline/oldtop).is_dir() and (baseline/oldchop).is_dir():groups.insert(0,('old',str(baseline/oldtop),str(baseline/oldchop)))
for group,top,chop in groups:
    for i in range(5):
        name=group+str(i);node=root.create(cplusplusTOP if i<4 else cplusplusCHOP,name);node.par.plugin=str(top if i<4 else chop);node.cook(force=True);node.par.Sketch=top_source if i<4 else chop_source;node.viewer=False;node.nodeX=i*200;node.nodeY=150 if group=='new' else 400
        if i<4:node.par.Width=1920;node.par.Height=1080;node.par.Controls=controls;node.par.Samecook=False
        else:node.par.Outputchannels='x y';node.par.Outputsamples=10000;node.inputConnectors[0].connect(source);node.inputConnectors[1].connect(controls)
        info=root.create(infoCHOP,name+'_status');info.par.op=name;info.par.passive=True;info.viewer=False
        if group=='new':
            node.par.Infoview='logs';node.par.Loglevel='info'
            dat=root.create(infoDAT,name+'_logs');dat.par.op=name;dat.par.passive=True;dat.viewer=False;dat.nodeX=i*200;dat.nodeY=-100
        node.cook(force=True)
runner=root.create(executeDAT,'benchmark');runner.par.active=False;runner.par.framestart=True;runner.text=(folder/'benchmark_steps.py').read_text(encoding='utf-8');runner.par.active=True
ui.panes[0].owner=root
