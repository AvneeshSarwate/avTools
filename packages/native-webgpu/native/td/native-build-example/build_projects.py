"""Package a TD-saved fixture using Derivative's serialization tools."""
from pathlib import Path
import tempfile,shutil,subprocess
example=Path(__file__).resolve().parent
repo=example.parents[4]
name='native_build_test'

def expand(file):
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(file)],capture_output=True)
    result=Path(str(file)+'.dir');assert result.is_dir();return result

def collapse(file):
    file.unlink()
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(file)+'.toc'],check=True,capture_output=True)

with tempfile.TemporaryDirectory(prefix='avtools-native-example-') as temporary:
    temp=Path(temporary);tox=temp/'NativeBuild.tox';shutil.copy2(example/'NativeBuild.tox',tox);fixture=expand(tox)
    # The startup DAT resolves these paths; no machine-specific path is shipped.
    for path in (fixture/name).glob('*.parm'):
        lines=path.read_text().splitlines()
        lines=[line for line in lines if not line.startswith(('plugin ','Projectdir '))]
        path.write_text('\n'.join(lines)+'\n')
    collapse(tox);shutil.copy2(tox,example/'NativeBuild.tox')
    toe=temp/'NativeBuild.toe';shutil.copy2(example.parent/'example/Sketch.toe',toe);directory=expand(toe)
    old='avtools_sketch_example'
    for path in (directory/'project1').glob(old+'*'):
        if path.is_dir():shutil.rmtree(path)
        else:path.unlink()
    for path in fixture.iterdir():
        dest=directory/'project1'/path.name
        if path.is_dir():shutil.copytree(path,dest)
        else:shutil.copy2(path,dest)
    bootstrap=directory/'project1/bootstrap.text';code=(example/'project_start.py').read_bytes()
    bootstrap.write_bytes(bootstrap.read_bytes()[:23]+len(code).to_bytes(4,'big')+code)
    toc=Path(str(toe)+'.toc');entries=[line for line in toc.read_text().splitlines() if not line.startswith('project1/'+old)]
    i=entries.index('perform.n');entries[i:i]=['project1/'+line for line in Path(str(tox)+'.toc').read_text().splitlines() if line.startswith(name)]
    toc.write_text('\n'.join(entries)+'\n')
    for path in directory.rglob('*'):
        if path.is_file() and path.suffix!='.text':
            try:text=path.read_text()
            except UnicodeDecodeError:continue
            if old in text:path.write_text(text.replace(old,name))
    collapse(toe)
    shutil.copy2(toe,example/'NativeBuild.toe')
    shutil.copy2(toe,repo/'apps/td-projects/native/project.toe')
    shutil.copy2(tox,repo/'apps/td-projects/native/project.tox')
    shutil.copy2(example/'project_start.py',repo/'apps/td-projects/native/project_start.py')
