"""Wrap an early_submit.py .tox in an openable .toe without editor automation.

python3 test/td/make_early_project.py /absolute/path/to/early-4-work60000.tox
Keeps the fixture's absolute private-plugin/sketch paths; this is a local test
project, not a redistributable example. The production Sketch.toe is unchanged.
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
fixture=Path(sys.argv[1]).resolve()
assert fixture.is_file() and fixture.suffix=='.tox'
project=fixture.with_suffix('.toe')
assert not project.exists(),project
expand='/Applications/TouchDesigner.app/Contents/MacOS/toeexpand'
collapse='/Applications/TouchDesigner.app/Contents/MacOS/toecollapse'
shutil.copy2(root/'native/td/example/Sketch.toe',project)
subprocess.run([expand,str(project)],capture_output=True)
subprocess.run([expand,str(fixture)],capture_output=True)
directory=Path(str(project)+'.dir');source=Path(str(fixture)+'.dir')
component='avtools_sketch_example';prefix='project1/'+component
assert directory.is_dir() and (source/component).is_dir()
shutil.rmtree(directory/prefix)
shutil.copytree(source/component,directory/prefix)
for suffix in ['.n','.cparm','.parm']:
    shutil.copy2(source/(component+suffix),directory/(prefix+suffix))
for node in (directory/prefix).glob('*.n'):
    match=re.fullmatch(r'(renderer|out)(\d+)',node.stem)
    if match:
        family,index=match[1],int(match[2])
        x=(index if family=='renderer' else index-1)*240
        y=0 if family=='renderer' else -180
    else:x,y=-240,0
    node.write_text(re.sub(r'^tile .*$',f'tile {x} {y} 160 110',node.read_text(),flags=re.M))
original=Path(str(project)+'.toc').read_text().splitlines()
entries=[line for line in original if not line.startswith(prefix) and not line.startswith('project1/bootstrap')]
incoming=Path(str(fixture)+'.toc').read_text().splitlines()
position=entries.index('project1.panel')+1
entries[position:position] = ['project1/'+line for line in incoming if line.startswith(component)]
Path(str(project)+'.toc').write_text('\n'.join(entries)+'\n')
project.unlink();subprocess.run([collapse,str(project)+'.toc'],capture_output=True)
assert project.is_file() and project.stat().st_size>1000
print(project)
