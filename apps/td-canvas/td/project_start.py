"""Resolve current plugins and sources when opening Canvas.toe from the checkout."""
import sys as _avtools_sys
# Plugin lookup is per platform: .plugin bundles on macOS, .dll files on Windows.
PLATFORM = 'windows-x64' if _avtools_sys.platform == 'win32' else 'macos-arm64'
PLUGIN = '.dll' if _avtools_sys.platform == 'win32' else '.plugin'
from pathlib import Path

def onStart():
    folder = Path(project.folder)
    repo = next((p for p in (folder, *folder.parents)
                 if (p/('packages/native-webgpu/prebuilt/'+PLATFORM)/'current.txt').is_file()), None)
    if repo is None:
        raise RuntimeError('Keep Canvas.toe in the avTools checkout.')
    pre = repo/('packages/native-webgpu/prebuilt/'+PLATFORM)
    for name in ('picture1', 'picture2', 'channels1', 'channels2'):
        node = me.parent().op(name)
        chop = name.startswith('channels')
        marker = 'current-chop.txt' if chop else 'current.txt'
        node.par.plugin = str(pre/(pre/marker).read_text().strip())
        node.cook(force=True)
        node.par.Typescript = str(repo/'apps/td-canvas/td'/('channels.ts' if chop else 'picture.ts'))
        node.par.Autoreload = True
        node.viewer = True
        node.cook(force=True)
