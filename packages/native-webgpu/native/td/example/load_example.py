"""Run inside TD: import runpy; runpy.run_path('/path/to/this/load_example.py')."""
from pathlib import Path
import time

example_dir = Path(__file__).resolve().parent
package_dir = example_dir.parents[2]
plugin_marker = package_dir / 'build/td-plugin-path.txt'
if not plugin_marker.is_file():
    raise RuntimeError('Build the TD plugin first; see packages/native-webgpu/TOUCHDESIGNER.md')
plugin = Path(plugin_marker.read_text().strip())
if not plugin.is_dir():
    raise RuntimeError('The built plugin is missing: ' + str(plugin))

# TouchDesigner supplies these through its td module, including under runpy.
import td
parent = td.op('/project1') or td.op('/')
component = parent.loadTox(str(example_dir / 'Sketch.tox'))
component.name = 'avtools_sketch_example_' + str(time.time_ns())
component.par.Pluginpath = str(plugin)
for name in ('sketch1', 'sketch2'):
    node = component.op(name)
    node.cook(force=True)
    # Initialize the plugin before binding OP references when the initial path
    # was unavailable in the user's current project.
    node.par.Sketch = component.op('sketch')
    node.par.Controls = component.op('controls')
    node.cook(force=True)
    # Buffered rendering finishes on a worker; inspect the Info DAT after cooking.
print('Loaded avTools example:', component.path)
