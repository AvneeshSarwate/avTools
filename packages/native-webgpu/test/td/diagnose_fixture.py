# Temporary diagnostic inside only the generated fixture; safe to remove afterward.
code = '''import json, os
from pathlib import Path
def onFrameStart(frame):
    if int(frame) % 60 == 0:
        data = [dict(name=s.name, sender=s.par.sendername.eval(), menus=s.par.sendername.menuNames, width=s.width, height=s.height, errors=s.errors()) for s in parent().ops('receive*')]
        Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu/artifacts/td/diagnostic-' + str(os.getpid()) + '.json').write_text(json.dumps(data, indent=2))
    return
'''
diagnostic = fixture.op('diagnostic') or fixture.create(executeDAT, 'diagnostic')
diagnostic.text = code
diagnostic.par.framestart = True
fixture.save(str(output / 'syphon-receivers.tox'))
