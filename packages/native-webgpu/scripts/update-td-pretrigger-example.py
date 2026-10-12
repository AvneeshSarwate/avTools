"""Embed the shared coordinator and new parameters without TD editor automation."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]
example=root/'native/td/example'
out=Path(tempfile.mkdtemp(prefix='pretrigger-example-',dir=root/'artifacts/td'))
definitions='772804867 Pretrigger "Pre-trigger Mode" 1 1 0 0 1 1 1 2 0 "" "" Output 13\n772804869 Pretriggerpulse "Submit Early (Coordinator)" 1 1 0 0 1 1 1 2 0 "" "" Output 14\n'
for name in ['Sketch.tox','Sketch.toe']:
    path=out/name;shutil.copy2(example/name,path)
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(path)],capture_output=True)
    directory=Path(str(path)+'.dir');toc=Path(str(path)+'.toc')
    prefix=('project1/' if name.endswith('.toe') else '')+'avtools_sketch_example'
    component=directory/prefix
    for node in ['sketch1','sketch2']:
        p=component/(node+'.cparm');data=p.read_text()
        if ' Pretrigger ' not in data:p.write_text(data.rstrip().removesuffix('?')+definitions+'?\n')
    (component/'pretrigger.n').write_text('DAT:execute\ntile -430 -260 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
    (component/'pretrigger.parm').write_text('?\nframestart 0 1\nframeend 0 0\n?\n')
    header=(component/'sketch.text').read_bytes()[:23];code=(example/'pretrigger.py').read_bytes()
    (component/'pretrigger.text').write_bytes(header+len(code).to_bytes(4,'big')+code)
    entries=toc.read_text().splitlines();new=[prefix+'/pretrigger'+s for s in ['.n','.parm','.text']]
    entries=[line for line in entries if line not in new]
    index=max(i for i,line in enumerate(entries) if line.startswith(prefix))+1
    entries[index:index]=new;toc.write_text('\n'.join(entries)+'\n')
    path.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(toc)],capture_output=True)
    assert path.is_file() and path.stat().st_size>1000
    shutil.copy2(path,example/name)
print(out)
