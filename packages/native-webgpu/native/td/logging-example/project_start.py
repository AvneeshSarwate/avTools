"""Resolve checked-in plugin paths after moving this example within avTools."""
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
    root=op('/project1/logging_example')
    for name,marker in [('sketch','current.txt'),('channels','current-chop.txt')]:
        node=root.op(name);node.par.plugin=str(find_plugin(folder,'AvToolsSketch' if marker=='current.txt' else 'AvToolsChannels',marker));node.cook(force=True)
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
