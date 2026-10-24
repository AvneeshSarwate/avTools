"""Locate the enclosing checkout after moving the example within avTools."""
from pathlib import Path

def onStart():
    folder=Path(project.folder)
    repo=next((p for p in (folder,*folder.parents) if (p/'packages/native-webgpu/prebuilt/macos-arm64/current.txt').is_file()),None)
    if repo is None:raise RuntimeError('Keep Parameters.toe in avTools, or copy Plugins and generate a local template project.')
    pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
    sources=repo/'packages/native-webgpu/native/td/parameter-example'
    root=me.parent()
    for name,marker,file in [('picture','current.txt','picture.ts'),('channels','current-chop.txt','channels.ts')]:
        n=root.op(name);n.par.plugin=str(pre/(pre/marker).read_text(encoding='utf-8').strip());n.cook(force=True)
        n.par.Typescript=str(sources/file);n.par.Autoreload=True;n.cook(force=True)
    pane=ui.panes[0];kind=type(pane.type)
    if pane.type!=kind.NETWORKEDITOR:pane=pane.changeType(kind.NETWORKEDITOR)
    pane.owner=root;pane.showParameters=True;pane.showBackdropTOPs=False;pane.showBackdropCHOPs=False;pane.x=150;pane.y=0;pane.zoom=.55
    root.op('picture').current=True;root.op('picture').selected=True;select_controls(root.op('picture').id)
    root.op('picture').display=True


def select_controls(node_id, attempts=120):
    node=op(node_id)
    if node is None:return
    if getattr(node.par,'Size',None) is not None:
        node.currentPage='Controls'
    elif attempts:
        run('args[0](args[1],args[2])',select_controls,node_id,attempts-1,delayFrames=1)
