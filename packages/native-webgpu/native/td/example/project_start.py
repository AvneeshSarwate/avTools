"""Embedded in Sketch.toe's Execute DAT; no external Python file is needed to open it."""
from pathlib import Path


def onStart():
    folder = Path(project.folder)
    plugin = folder / 'Plugins/AvToolsSketch.plugin'
    if not plugin.is_dir():
        marker = folder / '../../../build/td-plugin-path.txt'
        if not marker.is_file():
            raise RuntimeError('Build the avTools TD plugin first, or use the release ZIP with its Plugins folder. See README.md.')
        plugin = Path(marker.read_text().strip())
    if not plugin.is_dir():
        raise RuntimeError('avTools plugin is missing: ' + str(plugin))
    component = op('/project1/avtools_sketch_example')
    component.par.Pluginpath = str(plugin.resolve())
    for name in ('sketch1', 'sketch2'):
        node = component.op(name)
        node.cook(force=True)
        node.par.Sketch = component.op('sketch')
        node.par.Controls = component.op('controls')
        node.cook(force=True)
        if node.errors():
            raise RuntimeError(node.errors())
    return
