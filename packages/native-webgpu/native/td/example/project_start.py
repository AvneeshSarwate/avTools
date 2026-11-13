"""Embedded in Sketch.toe's Execute DAT; no external Python file is needed to open it."""
from pathlib import Path


def onStart():
    folder = Path(project.folder)
    plugin = folder / 'Plugins/AvToolsSketch.plugin'
    if not plugin.is_dir():
        prebuilt = folder / '../../../prebuilt/macos-arm64'
        plugin = prebuilt / (prebuilt / 'current.txt').read_text().strip()
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
        # Buffered rendering finishes on a worker; inspect the Info DAT after cooking.
    return
