"""Package a TD-saved Logging.tox as portable .tox and standalone .toe."""
from pathlib import Path
import shutil,subprocess,tempfile
example=Path(__file__).resolve().parent
name='logging_example'
def expand(path):
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(path)],capture_output=True)
    directory=Path(str(path)+'.dir');assert directory.is_dir();return directory
def collapse(path):
    path.unlink(missing_ok=True)
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(path)+'.toc'],check=True,capture_output=True)
def text_dat(path,code):
    data=code.encode();path.write_bytes(path.read_bytes()[:23]+len(data).to_bytes(4,'big')+data)
with tempfile.TemporaryDirectory(prefix='avtools-logging-') as temporary:
    temp=Path(temporary);tox=temp/'Logging.tox';shutil.copy2(example/tox.name,tox);fixture=expand(tox)
    for path in (fixture/name).glob('*.parm'):
        lines=[l for l in path.read_text().splitlines() if not l.startswith('plugin ')]
        path.write_text('\n'.join(lines)+'\n')
    text_dat(fixture/name/'startup.text',(example/'project_start.py').read_text())
    for node,file in [('sketch_source','sketch.js'),('channels_source','channels.js')]:
        text_dat(fixture/name/(node+'.text'),(example/file).read_text())
    text_dat(fixture/name/'README.text',(example/'README.md').read_text())
    collapse(tox);shutil.copy2(tox,example/tox.name)
    toe=temp/'Logging.toe';shutil.copy2(example.parent/'example/Sketch.toe',toe);directory=expand(toe)
    old='avtools_sketch_example'
    for path in (directory/'project1').glob(old+'*'):
        if path.is_dir():shutil.rmtree(path)
        else:path.unlink()
    for path in fixture.iterdir():
        if not path.name.startswith(name):continue
        dest=directory/'project1'/path.name
        if path.is_dir():shutil.copytree(path,dest)
        else:shutil.copy2(path,dest)
    text_dat(directory/'project1/bootstrap.text',"def onStart():\n    op('/project1/logging_example/startup').module.onStart()\n")
    toc=Path(str(toe)+'.toc');entries=[l for l in toc.read_text().splitlines() if not l.startswith('project1/'+old)]
    i=entries.index('perform.n');entries[i:i]=['project1/'+l for l in Path(str(tox)+'.toc').read_text().splitlines() if l.startswith(name)]
    toc.write_text('\n'.join(entries)+'\n')
    for path in directory.rglob('*'):
        if path.is_file() and path.suffix!='.text':
            try:value=path.read_text()
            except UnicodeDecodeError:continue
            if old in value:path.write_text(value.replace(old,name))
    collapse(toe);shutil.copy2(toe,example/toe.name)
print(example/'Logging.toe')
