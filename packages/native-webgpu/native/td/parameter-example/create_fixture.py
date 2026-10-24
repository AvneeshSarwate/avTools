"""Run in TD with __file__ set. Creates only /project1/parameter_example."""
from pathlib import Path
folder=Path(__file__).resolve().parent
repo=folder.parents[4];pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
assert op('/project1/parameter_example') is None,'Example already exists'
root=op('/project1').create(baseCOMP,'parameter_example');root.nodeX=1800
for name,kind,file,marker,x in [('picture',cplusplusTOP,'picture.ts','current.txt',0),('channels',cplusplusCHOP,'channels.ts','current-chop.txt',500)]:
    node=root.create(kind,name);node.par.plugin=str(pre/(pre/marker).read_text(encoding='utf-8').strip());node.cook(force=True)
    if name=='channels':node.par.Outputchannels='value'
    node.par.Typescript=str(folder/file);node.nodeX=x;node.nodeY=80;node.viewer=True;node.cook(force=True)
    info=root.create(infoDAT,name+'_info');info.par.op=node.name;info.nodeX=x;info.nodeY=-160;info.viewer=True
readme=root.create(textDAT,'README');readme.text=(folder/'README.md').read_text(encoding='utf-8');readme.nodeX=-380;readme.nodeY=80
startup=root.create(executeDAT,'startup');startup.par.start=False;startup.text=(folder/'project_start.py').read_text(encoding='utf-8');startup.nodeX=-380;startup.nodeY=-160
ui.panes[0].owner=root;root.op('picture').display=True
print('Created',root.path,'; cook, verify Controls, then save Parameters.tox')
