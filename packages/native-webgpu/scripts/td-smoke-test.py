"""Headless-ish smoke test of a TD fixture with the locally built avTools plugins.

Copies a fixture .toe beside itself (so its relative paths resolve), appends a
verification hook to its startup script, launches TouchDesigner on the copy, and
waits for a JSON report. The hook waits for native TypeScript builds, then records
every CPlusPlus TOP/CHOP: plugin path, errors/warnings, TOP resolution and centre
pixel, CHOP channel values; it then quits TD. The copy is always removed.

Plugins resolve as in normal use: an adjacent Plugins/ folder, else the local
build/fetch markers in prebuilt/<platform>/ (gitignored). No plugin copies needed.
A TD window opens while it runs; no interaction is required unless TD shows a
license/login dialog (then the run times out and reports that).

    python scripts/td-smoke-test.py <fixture.toe> [--seconds 45] [--timeout 240] [--out report.json]
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import time

args = sys.argv[1:]
if not args or args[0].startswith('--'):
    sys.exit(__doc__)
fixture = Path(args[0]).resolve()
option = lambda name, default: args[args.index(name) + 1] if name in args else default
settle = float(option('--seconds', '45'))
timeout = float(option('--timeout', '240'))
report = Path(option('--out', str(Path(tempfile.gettempdir()) / f'avtools-smoke-{fixture.stem}.json'))).resolve()

if sys.platform == 'win32':
    bin_dir = Path(r'C:\Program Files\Derivative\TouchDesigner\bin')
    touch, expand, collapse = bin_dir / 'TouchDesigner.exe', bin_dir / 'toeexpand.exe', bin_dir / 'toecollapse.exe'
else:
    mac = Path('/Applications/TouchDesigner.app/Contents/MacOS')
    touch, expand, collapse = mac / 'TouchDesigner', mac / 'toeexpand', mac / 'toecollapse'

HEADER = 23  # Text DAT payload: header, 4-byte big-endian length, text
HOOK = '''

# ---- avTools smoke-test hook (temporary copy only) ----
import json as _smoke_json
_smoke_original_onStart = onStart
def onStart():
    try:
        _smoke_original_onStart()
    except Exception as error:
        globals()['_smoke_start_error'] = repr(error)
    run("op('/project1/bootstrap').module._smoke_report()", delayMilliSeconds=int(SETTLE * 1000))

def _smoke_report():
    result = {'startError': globals().get('_smoke_start_error'), 'td': app.build, 'operators': []}
    try:
        for node in op('/project1').findChildren(depth=None):
            if node.OPType not in ('cplusplusTOP', 'cplusplusCHOP'):
                continue
            node.cook(force=True)
            entry = {'path': node.path, 'type': node.OPType, 'plugin': str(node.par.plugin.eval()),
                     'errors': node.errors(recurse=False), 'warnings': node.warnings(recurse=False)}
            if node.OPType == 'cplusplusTOP':
                entry['size'] = [node.width, node.height]
                try:
                    pixels = node.numpyArray(delayed=False)  # (height, width, 4) float32
                    # TOP.sample() reported equal RGBA values here; read pixels directly instead.
                    entry['centerRGBA'] = [round(float(v), 4) for v in pixels[node.height // 2, node.width // 2]]
                    entry['channels'] = {name: {'min': round(float(pixels[..., i].min()), 4),
                                                'max': round(float(pixels[..., i].max()), 4),
                                                'mean': round(float(pixels[..., i].mean()), 4)}
                                         for i, name in enumerate('rgba')}
                except Exception as error:
                    entry['sampleError'] = repr(error)
            else:
                entry['channels'] = {c.name: [round(v, 5) for v in c.vals[:4]] for c in node.chans()}
            result['operators'].append(entry)
    except Exception as error:
        result['reportError'] = repr(error)
    with open(REPORT, 'w', encoding='utf-8') as f:
        _smoke_json.dump(result, f, indent=2)
    project.quit(force=True)
'''


def read_text(path):
    data = path.read_bytes()
    size = int.from_bytes(data[HEADER:HEADER + 4], 'big')
    assert HEADER + 4 + size == len(data), f'unexpected Text DAT layout: {path}'
    return data, data[HEADER + 4:].decode('utf-8')


copy = fixture.with_name(f'_avtools_smoke_{fixture.stem}.toe')
report.unlink(missing_ok=True)
try:
    with tempfile.TemporaryDirectory(prefix='avtools-smoke-') as temporary:
        staged = Path(temporary) / fixture.name
        shutil.copy2(fixture, staged)
        subprocess.run([str(expand), str(staged)], cwd=temporary, capture_output=True)
        bootstrap = Path(str(staged) + '.dir') / 'project1/bootstrap.text'
        data, code = read_text(bootstrap)
        hook = HOOK.replace('SETTLE', repr(settle)).replace('REPORT', repr(str(report)))
        body = (code + hook).encode('utf-8')
        bootstrap.write_bytes(data[:HEADER] + len(body).to_bytes(4, 'big') + body)
        staged.unlink()
        subprocess.run([str(collapse), str(staged) + '.toc'], cwd=temporary, capture_output=True)
        shutil.copy2(staged, copy)
    started = time.time()
    process = subprocess.Popen([str(touch), str(copy)], cwd=str(copy.parent))
    while time.time() - started < timeout and not report.exists() and process.poll() is None:
        time.sleep(2)
    time.sleep(2)
    if process.poll() is None:
        process.kill()
    if not report.exists():
        print(json.dumps({'fixture': str(fixture), 'result': 'no report',
                          'detail': 'TD exited or timed out before reporting (license/login dialog? crash?)',
                          'exitCode': process.poll(), 'seconds': round(time.time() - started)}, indent=2))
        sys.exit(1)
    print(report.read_text(encoding='utf-8'))
finally:
    for leftover in [copy, *copy.parent.glob(f'{copy.stem}.*.toe')]:
        leftover.unlink(missing_ok=True)
