"""Execute in TD Textport with __file__ set. Creates a new isolated component."""
from pathlib import Path
folder=Path(__file__).resolve().parent
repo=folder.parents[4];pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
assert op('/project1/logging_example') is None,'Fixture exists; reopen a clean project before regenerating.'
root=op('/project1').create(baseCOMP,'logging_example');root.nodeX=1600
for name,kind,source,marker,x in [('sketch',cplusplusTOP,'sketch.js','current.txt',0),('channels',cplusplusCHOP,'channels.js','current-chop.txt',500)]:
    dat=root.create(textDAT,name+'_source');dat.text=(folder/source).read_text(encoding='utf-8');dat.nodeX=x;dat.nodeY=260
    node=root.create(kind,name);node.par.plugin=str(pre/(pre/marker).read_text(encoding='utf-8').strip());node.cook(force=True)
    if name=='channels':node.par.Outputchannels='ticks frames'
    node.par.Sketch=dat.name;node.par.Infoview='logs';node.par.Loglevel='debug';node.nodeX=x;node.nodeY=80;node.viewer=True
    node.cook(force=True)
    for suffix,y in [('_logs',-140),('_observer',-340)]:
        info=root.create(infoDAT,name+suffix);info.par.op=node.name;info.par.passive=True;info.nodeX=x;info.nodeY=y;info.viewer=True
readme=root.create(textDAT,'README');readme.nodeX=-380;readme.nodeY=50
readme.text='''JavaScript console -> per-operator Info DAT
Diagnostics page: Info DAT View / Log Level / Clear Logs / Refresh Logs.
Debug shows independent timer messages (even while playback is paused).
Paused/idle: use Refresh Logs (No Script) to refresh TD metadata, holding outputs.
Two observers of each source read the same retained history.
Event Name = Trigger or ErrorMessage, then Send Pulse. ErrorMessage keeps running.
Event Name = Throw tests real runtime errors. Reset starts a new generation.
History survives Reset/Reload; Clear Logs doesn't restart script state.
No stderr/Console mirroring. Read logging-example/README.md for limits.
'''
startup=root.create(executeDAT,'startup');startup.par.start=False;startup.text=(folder/'project_start.py').read_text(encoding='utf-8');startup.nodeX=-380;startup.nodeY=-200
ui.panes[0].owner=root
root.save(str(folder/'Logging.tox'))
print('Created and saved',root.path)
