"""Embedded in project.toe. Finds the plugin and connects both file-backed sketches."""
from pathlib import Path


def onStart():
    folder = Path(project.folder)
    plugin = folder / 'Plugins/AvToolsSketch.plugin'
    if not plugin.is_dir():
        prebuilt = folder / '../../../packages/native-webgpu/prebuilt/macos-arm64'
        plugin = prebuilt / (prebuilt / 'current.txt').read_text().strip()
    if not plugin.is_dir():
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
