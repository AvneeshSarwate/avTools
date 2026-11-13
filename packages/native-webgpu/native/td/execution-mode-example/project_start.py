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
    plugin=find_plugin(folder,'AvToolsChannels','current-chop.txt')
    root=me.parent()
    for node in root.findChildren(depth=1,type=cplusplusCHOP):
        node.par.plugin=str(plugin)
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
