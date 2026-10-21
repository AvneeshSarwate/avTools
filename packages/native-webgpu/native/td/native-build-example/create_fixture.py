# Run this file from TouchDesigner's Textport. Only creates its named test component.
from pathlib import Path
import json
# Set __file__ when executing from Textport; see README.
repo=Path(__file__).resolve().parents[5]
root=op('/').create(baseCOMP,'native_build_test')
root.nodeX=600
root.nodeY=-500
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
projectdir=repo/'apps/td-projects/native'
controls=root.create(constantCHOP,'controls')
controls.par.name0='value'
controls.par.value0=7
controls.nodeX=-400
controls.nodeY=0
for i in range(4):
    chop=root.create(cplusplusCHOP,'channels'+str(i+1))
    chop.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip())
    chop.cook(force=True)
    chop.inputConnectors[0].connect(controls)
    chop.par.Outputchannels='value ticks'
    chop.par.Typescript=str(projectdir/'sketches'/('channels' if i % 2 == 0 else 'offset')/'main.ts')
    chop.nodeX=-100+i*230
    chop.nodeY=0
    out=root.create(nullCHOP,'out_channels'+str(i+1))
    out.inputConnectors[0].connect(chop)
    out.nodeX=chop.nodeX
    out.nodeY=-140
    out.viewer=True
    info=root.create(infoDAT,'build_channels'+str(i+1))
    info.par.op=chop.name
    info.nodeX=chop.nodeX
    info.nodeY=-280
    top=root.create(cplusplusTOP,'background'+str(i+1))
    top.par.plugin=str(prebuilt/(prebuilt/'current.txt').read_text().strip())
    top.cook(force=True)
    top.par.Typescript=str(projectdir/'sketches'/('background' if i % 2 == 0 else 'orbit')/'main.ts')
    top.par.Width=1920
    top.par.Height=1080
    top.nodeX=chop.nodeX
    top.nodeY=250
    top.viewer=True
    outtop=root.create(nullTOP,'out_background'+str(i+1))
    outtop.inputConnectors[0].connect(top)
    outtop.nodeX=top.nodeX
    outtop.nodeY=400
    info=root.create(infoDAT,'build_background'+str(i+1))
    info.par.op=top.name
    info.nodeX=top.nodeX
    info.nodeY=550
ui.panes[0].owner=root
print('Created',root.path)
