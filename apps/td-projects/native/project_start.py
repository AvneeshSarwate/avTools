"""Resolve the prebuilt plugins and editable project after moving this example."""
from pathlib import Path

def onStart():
    folder=Path(project.folder)
    repository=None
    for ancestor in [folder,*folder.parents]:
        if (ancestor/'packages/native-webgpu/prebuilt/macos-arm64/current.txt').is_file():
            repository=ancestor;break
    if repository is None:
        raise RuntimeError('Keep this example in avTools, or set the plugin paths to your copied distribution.')
    prebuilt=repository/'packages/native-webgpu/prebuilt/macos-arm64'
    sources=folder if (folder/'tsconfig.json').is_file() else repository/'apps/td-projects/native'
    component=op('/project1/native_build_test')
    for kind,marker,entry in [('channels','current-chop.txt','channels'),('background','current.txt','background')]:
        for i in range(1,5):
            node=component.op(kind+str(i))
            node.par.plugin=str(prebuilt/(prebuilt/marker).read_text().strip())
            node.cook(force=True)
            node.par.Projectdir=''
            selected=entry if i % 2 else ('offset' if kind=='channels' else 'orbit')
            node.par.Typescript=str(sources/'sketches'/selected/'main.ts')
            node.par.Autobuild=True
            node.par.Autoreload=True
            component.op('build_'+node.name).par.op=node.name
            node.cook(force=True)
    panes=list(ui.panes)
    if panes:
        pane_type=type(panes[0].type)
        pane=panes[0]
        if pane.type!=pane_type.NETWORKEDITOR:
            pane=pane.changeType(pane_type.NETWORKEDITOR)
        pane.owner=component;pane.showParameters=True
        pane.showBackdropTOPs=False;pane.showBackdropCHOPs=False
        pane.x=250;pane.y=100;pane.zoom=.6

        component.op('background1').display=True
        component.op('background1').current=True
        component.op('background1').selected=True
        component.op('background1').currentPage='Build'
        if len(panes)>1:
            viewer=panes[1]
            if viewer.type!=pane_type.TOPVIEWER:
                viewer=viewer.changeType(pane_type.TOPVIEWER)
            viewer.owner=component
