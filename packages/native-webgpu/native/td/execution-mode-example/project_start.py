from pathlib import Path

def onStart():
    folder=Path(project.folder)
    repo=next(p for p in [folder,*folder.parents] if (p/'packages/native-webgpu/prebuilt/macos-arm64').is_dir())
    prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
    root=me.parent()
    for node in root.findChildren(depth=1,type=cplusplusCHOP):
        node.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip())
    panes=list(ui.panes)
    if panes:
        pane=panes[0];kind=type(pane.type).NETWORKEDITOR
        if pane.type!=kind:pane=pane.changeType(kind)
        pane.owner=root;pane.showParameters=False;pane.showBackdropCHOPs=False
        pane.home()
    if len(panes)>1:
        pane=panes[1];kind=type(pane.type).PARAMETERS
        if pane.type!=kind:pane=pane.changeType(kind)
        pane.owner=root
        node=root.op('channels1')
        node.current=True;node.selected=True;node.currentPage='Script'
