"""Rebuild the checked-in starter .toe/.tox using TD's serialization CLI.
No editor automation. The files use project-relative bundle paths and plugin lookup.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
starter = repo / 'apps/td-projects/starter'
example = repo / 'packages/native-webgpu/native/td/example'
build = Path(__file__).resolve().parent / 'build'
build.mkdir(exist_ok=True)


def text_dat(path, code):
    code = code.encode()
    path.write_bytes(path.read_bytes()[:23] + len(code).to_bytes(4, 'big') + code)


with tempfile.TemporaryDirectory(prefix='starter-', dir=build) as temp:
    for suffix in ('toe', 'tox'):
        path = Path(temp) / ('project.' + suffix)
        shutil.copy2(example / ('Sketch.' + suffix), path)
        subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand', str(path)], capture_output=True)
        directory = Path(str(path) + '.dir')
        component = directory / ('project1/avtools_sketch_example' if suffix == 'toe' else 'avtools_sketch_example')
        for node, sketch in [('sketch1', 'particles'), ('sketch2', 'background')]:
            parm = component / (node + '.parm')
            data = [line for line in parm.read_text().splitlines() if line != '?' and not line.startswith(('Sketch ', 'Sourcefile ', 'Width ', 'Height ', 'Eventname '))]
            data += ['Sketch 67108928 ""', 'Width 67108928 1920', 'Height 67108928 1080', 'Eventname 67108928 Trigger',
                     f'Sourcefile 67108945 "" "project.folder + \'/dist/{sketch}.js\'"']
            parm.write_text('?\n' + '\n'.join(data) + '\n?\n')
            node_file = component / (node + '.n')
            node_file.write_text(node_file.read_text().replace('inputs\n{\n0 \timage\n}\n', ''))
        text_dat(component / 'sketch.text', '# Edit sketches/particles/main.ts or sketches/background/main.ts in your IDE.\n# Run npm run dev in this project directory.\n# Both TOPs load dist/*.js; this DAT is documentation only.\n# Amount controls speed / contrast. Trigger reverses particles / shifts waves.\n')
        if suffix == 'toe':
            text_dat(directory / 'project1/bootstrap.text', (starter / 'project_start.py').read_text())
        path.unlink()
        subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse', str(path) + '.toc'], capture_output=True)
        assert path.is_file() and path.stat().st_size > 1000
        shutil.copy2(path, starter / path.name)
print(starter / 'project.toe')
