"""Resolve the repo and assign available local OSC ports after native builds finish."""
from pathlib import Path
import socket

def onStart():
    folder=Path(project.folder)
    repo=next((p for p in (folder,*folder.parents) if (p/'packages/native-webgpu/prebuilt/macos-arm64/current.txt').is_file()),None)
    if repo is None:raise RuntimeError('Keep IO.toe in avTools, or generate a local template project from a copied plugin.')
    root=me.parent();pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
    sources=repo/'packages/native-webgpu/native/td/io-example'
    for name,marker in [('picture','current.txt'),('channels','current-chop.txt')]:
        n=root.op(name);n.par.plugin=str(pre/(pre/marker).read_text(encoding='utf-8').strip());n.cook(force=True)
        n.par.Typescript=str(sources/(name+'.ts'));n.par.Autoreload=True;n.cook(force=True)
    configure(root.id)

def configure(root_id, attempts=1800):
    root=op(root_id)
    if root is None:return
    nodes=[root.op('picture'),root.op('channels')]
    for n in nodes:
        n.cook(force=True);root.op(n.name+'_info').cook(force=True)
    # Saved custom parameters can exist before the new native build is ready.
    ready=all('build_state\tready' in root.op(n.name+'_info').text for n in nodes)
    if ready and all(getattr(n.par,'Port',None) is not None for n in nodes):
        for n in nodes:
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as probe:
                probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
            previous=n.par.Samecook.eval();n.par.Samecook=True
            n.par.Port=port;n.par.Reset.pulse();n.cook(force=True);n.par.Samecook=previous
            sender=root.op('send_'+n.name);sender.par.address='127.0.0.1';sender.par.port=port
        print('OSC example ready:',[(n.name,n.par.Port.eval()) for n in nodes])
    elif attempts:run('args[0](args[1],args[2])',configure,root_id,attempts-1,delayFrames=1)
    else:raise RuntimeError('OSC example build timed out; inspect picture_info and channels_info')
