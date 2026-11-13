"""Make TD fixture startup code platform-aware, in sources and saved projects.

Fixture startup code lives in project_start.py files and is embedded (as Text
DATs) in the saved .toe/.tox files, sometimes in older variants. This script
applies one transformation everywhere: macOS-only plugin lookups become
platform-aware (prebuilt/macos-arm64 + .plugin bundles on macOS, prebuilt/
windows-x64 + .dll on Windows). Saved files are rewritten with TouchDesigner's
own toeexpand/toecollapse, so no TD session is needed. Works on macOS and Windows.
    python3 scripts/update-td-project-startup.py [--dry-run]
Idempotent: already-converted code is left unchanged.
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

package = Path(__file__).resolve().parents[1]
repo = package.parents[1]
if sys.platform == 'win32':
    tools = Path(r'C:\Program Files\Derivative\TouchDesigner\bin')
    expand, collapse = tools / 'toeexpand.exe', tools / 'toecollapse.exe'
else:
    tools = Path('/Applications/TouchDesigner.app/Contents/MacOS')
    expand, collapse = tools / 'toeexpand', tools / 'toecollapse'
dry_run = '--dry-run' in sys.argv

PLATFORM_HEADER = (
    "import sys as _avtools_sys\n"
    "# Plugin lookup is per platform: .plugin bundles on macOS, .dll files on Windows.\n"
    "PLATFORM = 'windows-x64' if _avtools_sys.platform == 'win32' else 'macos-arm64'\n"
    "PLUGIN = '.dll' if _avtools_sys.platform == 'win32' else '.plugin'\n")


def needs(code: str) -> bool:
    # Quoted macOS-only path literals; the platform header's comment doesn't count.
    return re.search(r"prebuilt/macos-arm64['/]", code) is not None or \
        re.search(r"'Plugins/AvTools\w+\.plugin'", code) is not None


def platformize(code: str) -> str:
    """macOS-only plugin lookup -> platform-aware. Returns code unchanged if not needed."""
    if not needs(code):
        return code
    s = code.replace('\r\n', '\n')
    s = s.replace("'packages/native-webgpu/prebuilt/macos-arm64/", "('packages/native-webgpu/prebuilt/'+PLATFORM)/'")
    s = s.replace("'packages/native-webgpu/prebuilt/macos-arm64'", "('packages/native-webgpu/prebuilt/'+PLATFORM)")
    s = s.replace("'../../../packages/native-webgpu/prebuilt/macos-arm64'", "('../../../packages/native-webgpu/prebuilt/'+PLATFORM)")
    s = s.replace("'../../../prebuilt/macos-arm64'", "('../../../prebuilt/'+PLATFORM)")
    s = re.sub(r"'Plugins/(AvTools\w+)\.plugin'", r"('Plugins/\1'+PLUGIN)", s)
    s = s.replace('plugin.is_dir()', 'plugin.exists()')
    if needs(s):
        raise ValueError('unhandled macOS-only lookup remains')
    docstring = re.match(r'(\s*(?:"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')\n)', s)
    s = (docstring.group(1) + PLATFORM_HEADER + s[docstring.end():]) if docstring else PLATFORM_HEADER + s
    compile(s, '<startup>', 'exec')
    return s


# Text DAT payload: 23-byte header, 4-byte big-endian length, then the text.
HEADER = 23


def read_text(path: Path):
    data = path.read_bytes()
    if len(data) < HEADER + 4:
        return None
    size = int.from_bytes(data[HEADER:HEADER + 4], 'big')
    if HEADER + 4 + size != len(data):
        return None  # not the plain Text DAT layout; never guess
    try:
        return data[HEADER + 4:].decode('utf-8')
    except UnicodeDecodeError:
        return None


def write_text(path: Path, text: str):
    data = path.read_bytes()
    body = text.encode('utf-8')
    path.write_bytes(data[:HEADER] + len(body).to_bytes(4, 'big') + body)


roots = [repo / 'apps', package / 'native/td']
changed = 0
# 1. Source files.
for script in sorted(p for root in roots for p in root.rglob('project_start.py') if 'node_modules' not in p.parts):
    raw = script.read_bytes().decode('utf-8')
    new = platformize(raw)
    if new != raw.replace('\r\n', '\n') and needs(raw):
        if not dry_run:
            script.write_bytes((new.replace('\n', '\r\n') if '\r\n' in raw else new).encode('utf-8'))
        changed += 1
        print(('would  ' if dry_run else 'update ') + script.relative_to(repo).as_posix())
# 2. Saved projects/components.
for saved in sorted(p for root in roots for ext in ('*.toe', '*.tox') for p in root.rglob(ext)
                    if 'node_modules' not in p.parts and 'Backup' not in p.parts):
    label = saved.relative_to(repo).as_posix()
    with tempfile.TemporaryDirectory(prefix='avtools-startup-') as temporary:
        copy = Path(temporary) / saved.name
        shutil.copy2(saved, copy)
        subprocess.run([str(expand), str(copy)], cwd=temporary, capture_output=True)
        expanded = Path(str(copy) + '.dir')
        if not expanded.is_dir():
            print(f'skip   {label}: toeexpand failed')
            continue
        # Sync: an embedded copy of the sibling project_start.py (its committed
        # version, macOS-only or already platformized) becomes the current file.
        sibling = saved.parent / 'project_start.py'
        current = sibling.read_bytes().decode('utf-8').replace('\r\n', '\n') if sibling.is_file() else None
        previous = set()
        if current is not None:
            committed = subprocess.run(['git', 'show', f'HEAD:{sibling.relative_to(repo).as_posix()}'],
                                       cwd=repo, capture_output=True).stdout.decode('utf-8').replace('\r\n', '\n')
            if committed:
                previous = {committed, platformize(committed)}
        edits = []
        for text_file in expanded.rglob('*.text'):
            text = read_text(text_file)
            if text is None:
                continue
            normalized = text.replace('\r\n', '\n')
            if current is not None and normalized in previous and normalized != current:
                edits.append((text_file, current))
            elif needs(text):
                edits.append((text_file, platformize(text)))
        if not edits:
            continue
        names = ', '.join(t.relative_to(expanded).as_posix() for t, _ in edits)
        if dry_run:
            print(f'would  {label}: {names}')
            continue
        for text_file, text in edits:
            write_text(text_file, text)
        copy.unlink()
        subprocess.run([str(collapse), str(copy) + '.toc'], cwd=temporary, capture_output=True)
        if not copy.is_file() or copy.stat().st_size < 1000:
            raise RuntimeError(f'toecollapse failed for {label}')
        shutil.copy2(copy, saved)
        changed += 1
        print(f'update {label}: {names}')
print(f'{changed} file(s) {"would change" if dry_run else "updated"}')
