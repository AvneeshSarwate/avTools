"""Embedded in Channels.toe; resolves the checked-in plugin after a fresh clone."""
from pathlib import Path
FILE_BACKED = False


def layout(c, display):
    # Headless TouchEngine has no editor panes.
    panes = list(ui.panes)
    if not panes: return
    pane_type = type(panes[0].type)
    network = panes[0].changeType(pane_type.NETWORKEDITOR)
    network.owner = c
    network.showParameters = False
    network.showBackdropTOPs = False
    network.showBackdropCHOPs = False
    network.x = 50; network.y = -200; network.zoom = .8
    c.op(display).display = True
    if len(panes) > 1:
        viewer = panes[1].changeType(pane_type.CHOPVIEWER)
        viewer.owner = c


def onStart():
    folder = Path(project.folder)
    plugin = folder / 'Plugins/AvToolsChannels.plugin'
    if not plugin.is_dir():
        for ancestor in [folder, *folder.parents]:
            prebuilt = ancestor / 'packages/native-webgpu/prebuilt/macos-arm64'
            if (prebuilt / 'current-chop.txt').is_file():
                plugin = prebuilt / (prebuilt / 'current-chop.txt').read_text().strip()
                break
    if not plugin.is_dir():
        raise RuntimeError('Missing avTools Channels plugin; see the adjacent README.md.')
    c = op('/project1/avtools_channels_example')
    c.par.Pluginpath = str(plugin.resolve())
    for name in ['animation1','animation2','pass1','pass2','pass3','pass4','points1']:
        node = c.op(name)
        node.cook(force=True)
        source = 'points' if name == 'points1' else ('animation' if name.startswith('animation') else 'passthrough')
        if FILE_BACKED:
            node.par.Sketch = ''
            node.par.Sourcefile = str(folder / 'dist' / (source+'.js'))
        else:
            node.par.Sketch = c.op(source+'_source')
            node.par.Sourcefile = ''
        node.par.Reset.pulse()
        node.cook(force=True)
    layout(c, 'out3')
    return
