"""Embedded in project.toe. Finds the plugin and connects both file-backed sketches."""
import sys as _avtools_sys
# Plugin lookup is per platform: .plugin bundles on macOS, .dll files on Windows.
PLATFORM = 'windows-x64' if _avtools_sys.platform == 'win32' else 'macos-arm64'
PLUGIN = '.dll' if _avtools_sys.platform == 'win32' else '.plugin'
from pathlib import Path


def onStart():
    folder = Path(project.folder)
    plugin = folder / ('Plugins/AvToolsSketch'+PLUGIN)
    if not plugin.exists():
        prebuilt = folder / ('../../../packages/native-webgpu/prebuilt/'+PLATFORM)
        plugin = prebuilt / (prebuilt / 'current.txt').read_text().strip()
    if not plugin.exists():
        raise RuntimeError('The prebuilt TD plugin is missing; see this project\'s README.md.')
    component = op('/project1/avtools_sketch_example')
    component.par.Pluginpath = str(plugin.resolve())
    for node_name, sketch_name in [('sketch1', 'particles'), ('sketch2', 'background')]:
        node = component.op(node_name)
        node.cook(force=True)
        node.par.Sketch = ''
        node.par.Sourcefile = str(folder / 'dist' / (sketch_name + '.js'))
        node.par.Controls = component.op('controls')
        node.cook(force=True)
    return
