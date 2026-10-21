"""Execute from TD Textport. Creates an isolated test component and temporary sources.
Run after opening apps/td-projects/native/project.toe; writes results beside this script.
"""
from pathlib import Path
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=op('/project1').create(baseCOMP,'reload_test');root.nodeX=1800
runner=root.create(executeDAT,'verify');runner.par.active=False;runner.par.framestart=True
runner.text=(repo/'packages/native-webgpu/test/restart/td_callbacks.py').read_text()
runner.par.active=True
print('Started reload controls fixture',root.path)
