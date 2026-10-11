"""Run with runpy inside TD's empty Base/NewProject.toe to rebuild Sketch.toe."""
from pathlib import Path
import shutil
import td

example = Path(__file__).resolve().parent
root = td.op('/project1')
if root.children:
    raise RuntimeError('Use an empty project; this builder will not replace existing operators.')

component = root.loadTox(str(example / 'Sketch.tox'))
component.name = 'avtools_sketch_example'
component.nodeX = 0
component.nodeY = 0
startup = root.create(td.executeDAT, 'bootstrap')
startup.text = (example / 'project_start.py').read_text()
startup.par.start = True
startup.par.create = False
startup.par.framestart = False
startup.par.frameend = False
startup.nodeX = -250
startup.nodeY = -250

pane = td.ui.panes[0]
pane.owner = component
pane.showBackdropTOPs = False
pane.showParameters = False
component.op('out1').display = True
preview = pane.splitRight().changeType(td.PaneType.TOPVIEWER)
preview.owner = component
# Explicit framing avoids saving an in-progress animated home/zoom transition.
pane.x = 145
pane.y = -5
pane.zoom = 0.8
# Keep the .toe portable; startup resolves the checkout or release plugin.
component.par.Pluginpath = 'Plugins/AvToolsSketch.plugin'
if not td.project.save(str(example / 'Sketch.toe')):
    raise RuntimeError('Project save was cancelled.')
# TD may append a revision number according to the user's save preferences.
saved = Path(td.project.folder) / td.project.name
if saved != example / 'Sketch.toe':
    shutil.copy2(saved, example / 'Sketch.toe')
print('Saved standalone project:', example / 'Sketch.toe')
