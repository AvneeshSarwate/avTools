"""Creates /project1/io_example; never saves the current user's project."""
from pathlib import Path
folder=Path(__file__).resolve().parent
repo=folder.parents[4];pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
assert op('/project1/io_example') is None,'Example already exists'
root=op('/project1').create(baseCOMP,'io_example');root.nodeX=2200
for name,kind,marker,x in [('picture',cplusplusTOP,'current.txt',0),('channels',cplusplusCHOP,'current-chop.txt',500)]:
    n=root.create(kind,name);n.par.plugin=str(pre/(pre/marker).read_text(encoding='utf-8').strip());n.cook(force=True)
    if name=='channels':n.par.Outputchannels='value target messages port'
    else:n.par.Width=640;n.par.Height=360
    n.par.Typescript=str(folder/(name+'.ts'));n.nodeX=x;n.nodeY=100;n.viewer=True
    info=root.create(infoDAT,name+'_info');info.par.op=n.name;info.nodeX=x;info.nodeY=-160
    sender=root.create(oscoutDAT,'send_'+name);sender.nodeX=x;sender.nodeY=320;sender.viewer=True
readme=root.create(textDAT,'README');readme.text=(folder/'README.md').read_text(encoding='utf-8');readme.nodeX=-400;readme.nodeY=100
startup=root.create(executeDAT,'startup');startup.par.start=False;startup.text=(folder/'project_start.py').read_text(encoding='utf-8');startup.nodeX=-400;startup.nodeY=-160
# The source script's repo is known even when the current user project lives elsewhere.
def configure():
    startup.module.configure(root.id)
run('args[0]()',configure,delayFrames=10)
print('Created',root.path)
