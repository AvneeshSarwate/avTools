"""Resolve checked-in plugin paths after moving this example within avTools."""
from pathlib import Path

def onStart():
    folder=Path(project.folder)
    repo=next((p for p in (folder,*folder.parents) if (p/'packages/native-webgpu/prebuilt/macos-arm64/current.txt').is_file()),None)
    if repo is None:raise RuntimeError('Keep Logging.toe in avTools or point the operators at copied plugins.')
    pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
    root=op('/project1/logging_example')
    for name,marker in [('sketch','current.txt'),('channels','current-chop.txt')]:
        node=root.op(name);node.par.plugin=str(pre/(pre/marker).read_text().strip());node.cook(force=True)
        node.par.Infoview='logs';node.par.Loglevel='debug';node.cook(force=True)
    pane=ui.panes[0];kind=type(pane.type)
    if pane.type!=kind.NETWORKEDITOR:pane=pane.changeType(kind.NETWORKEDITOR)
    pane.owner=root;pane.showParameters=True;pane.showBackdropTOPs=False;pane.showBackdropCHOPs=False;pane.x=180;pane.y=0;pane.zoom=.65
    root.op('sketch').current=True;root.op('sketch').selected=True;root.op('sketch').currentPage='Diagnostics'

    root.op('sketch').display=True
    if len(ui.panes)>1:
        viewer=ui.panes[1]
        if viewer.type!=kind.TOPVIEWER:viewer=viewer.changeType(kind.TOPVIEWER)
        viewer.owner=root
