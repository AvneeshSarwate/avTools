"""Embedded in Sketch.toe's Execute DAT; no external Python file is needed to open it."""
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
    folder = Path(project.folder)
    plugin = find_plugin(folder, 'AvToolsSketch', 'current.txt')
    component = op('/project1/avtools_sketch_example')
    component.par.Pluginpath = str(plugin.resolve())
    for name in ('sketch1', 'sketch2'):
        node = component.op(name)
        node.cook(force=True)
        node.par.Sketch = component.op('sketch')
        node.par.Controls = component.op('controls')
        node.cook(force=True)
        # Buffered rendering finishes on a worker; inspect the Info DAT after cooking.
    return
