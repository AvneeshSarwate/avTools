"""Resolve the prebuilt plugins and editable project after moving this example."""
import sys as _avtools_sys
# Plugin lookup is per platform: .plugin bundles on macOS, .dll files on Windows.
PLATFORM = 'windows-x64' if _avtools_sys.platform == 'win32' else 'macos-arm64'
PLUGIN = '.dll' if _avtools_sys.platform == 'win32' else '.plugin'


def find_plugin(folder, name, marker):
    """Plugins/<name> beside or above the project (release ZIP, copied project), else
    this checkout's local build/fetch (prebuilt/<platform>/<marker>, gitignored)."""
    for directory in [folder, *folder.parents]:
        candidate = directory / 'Plugins' / (name + PLUGIN)
        if candidate.exists():
            return candidate
    for directory in [folder, *folder.parents]:
        prebuilt = directory / 'packages/native-webgpu/prebuilt' / PLATFORM
        if (prebuilt / marker).is_file():
            return prebuilt / (prebuilt / marker).read_text().strip()
    raise RuntimeError('avTools ' + name + ' plugin not found: put the Plugins folder beside or above this project (see Plugins/README.md).')
from pathlib import Path

def onStart():
    folder=Path(project.folder)
    # Self-contained: this folder holds tsconfig.json, sdk/ and sketches/.
    sources=folder
    component=op('/project1/native_build_test')
    for kind,marker,entry in [('channels','current-chop.txt','channels'),('background','current.txt','background')]:
        for i in range(1,5):
            node=component.op(kind+str(i))
            node.par.plugin=str(find_plugin(folder,'AvToolsChannels' if kind=='channels' else 'AvToolsSketch',marker))
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
