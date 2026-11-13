"""Read TD output after drawing in the browser. Writes real pixel/channel evidence."""
from pathlib import Path
import json
import numpy as np
ROOT = Path('/Users/avneeshsarwate/agentCombine/avTools')
fixture = op('/project1/canvas_example')
rows = []
images = []
for name in ('picture1', 'picture2', 'channels1', 'channels2'):
    node = fixture.op(name)
    node.cook(force=True)
    assert not node.errors(), node.errors()
    assert not node.warnings(), node.warnings()
    row = dict(name=name, errors=node.errors(), warnings=node.warnings())
    if name.startswith('picture'):
        image = node.numpyArray(delayed=False)
        assert image is not None
        assert image.shape[:2] == (720, 1280), image.shape
        ink = image[:,:,1] > 0.5
        row['ink_pixels'] = int(ink.sum())
        assert row['ink_pixels'] > 1000
        images.append(image.copy())
    else:
        row['channels'] = {c.name: float(c[0]) for c in node.chans()}
        assert row['channels']['shapes'] >= 3
        assert row['channels']['connected'] == 1
    rows.append(row)
assert np.max(np.abs(images[0] - images[1])) == 0
report = dict(passed=True, touchdesigner=str(app.build), operators=rows, top_pixels_equal=True)
path = ROOT/'apps/td-canvas/test/td.json'
path.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, indent=2))
