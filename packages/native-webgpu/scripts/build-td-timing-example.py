"""Generate independently openable TimeContext.toe/.tox from the saved example.
Uses TouchDesigner's serialization utilities; no editor automation is required.
"""
from pathlib import Path
import shutil,subprocess,tempfile
root=Path(__file__).resolve().parents[1]
example=root/'native/td/example'
out=Path(tempfile.mkdtemp(prefix='timecontext-example-',dir=root/'artifacts/td'))
for suffix in ['tox','toe']:
 path=out/('TimeContext.'+suffix);shutil.copy2(example/('Sketch.'+suffix),path)
 subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(path)],capture_output=True)
 directory=Path(str(path)+'.dir');prefix=('project1/' if suffix=='toe' else '')+'avtools_sketch_example';component=directory/prefix
 header=(component/'sketch.text').read_bytes()[:23];code=(example/'TimeContext.js').read_bytes()
 (component/'sketch.text').write_bytes(header+len(code).to_bytes(4,'big')+code)
 for node in ['sketch1','sketch2']:
  parm=component/(node+'.parm')
  data='\n'.join(line for line in parm.read_text().rstrip().removesuffix('?').splitlines() if not line.startswith(('Width ','Height ','Eventname ')))+'\n'
  # The bootstrap sets plugin/source/control paths relative to this example.
  data+='Width 67108928 640\nHeight 67108928 360\nEventname 67108928 Trigger\n'
  parm.write_text(data+'?\n')
 path.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(path)+'.toc'],capture_output=True)
 assert path.is_file() and path.stat().st_size>1000
 shutil.copy2(path,example/path.name)
print(out)
