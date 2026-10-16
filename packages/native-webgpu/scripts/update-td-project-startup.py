"""Refresh embedded startup code in the saved projects without opening TD."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
example = root / 'native/td/example'
code = (example / 'project_start.py').read_bytes()
with tempfile.TemporaryDirectory(prefix='avtools-startup-') as temporary:
    for name in ['Sketch.toe', 'TimeContext.toe']:
        path = Path(temporary) / name
        shutil.copy2(example / name, path)
        subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand', str(path)], capture_output=True)
        startup = Path(str(path) + '.dir') / 'project1/bootstrap.text'
        startup.write_bytes(startup.read_bytes()[:23] + len(code).to_bytes(4, 'big') + code)
        path.unlink()
        subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse', str(path) + '.toc'], capture_output=True)
        assert path.is_file() and path.stat().st_size > 1000
        shutil.copy2(path, example / name)
        print(example / name)
