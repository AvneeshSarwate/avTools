"""Verify source-file publication with the channels project's watcher running.
After starting, temporarily add 7 to passthrough/main.ts, then restore it.
"""
from pathlib import Path
import td
example=Path(__file__).resolve().parent
repo=example.parents[4]
c=td.op('/project1/avtools_channels_example')
for name in ['animation1','animation2','pass1','pass2','pass3','pass4','points1']:
    node=c.op(name);source='points' if name=='points1' else ('animation' if name.startswith('animation') else 'passthrough')
    node.par.Sketch='';node.par.Sourcefile=str(repo/'apps/td-projects/channels/dist'/ (source+'.js'));node.cook(force=True)
    assert not node.errors(),node.errors()
probe=c.create(td.executeDAT,'watch_verification');probe.par.framestart=False;probe.par.frameend=True
probe.text='''from pathlib import Path
import json
seen=[]
def onFrameEnd(frame):
    c=parent();node=c.op('pass4');node.cook(force=True)
    delta=float(node['value'][0])-float(c.op('counter')['value'][0])
    if not seen or seen[-1]!=delta:
        seen.append(delta);Path(REPORT).write_text(json.dumps({'transitions':seen,'errors':node.errors()}))
    return
'''.replace('REPORT',repr(str(example.parents[2]/'artifacts/chop-watch-td.json')))
print('File-backed CHOPs ready; watching delta transitions:', c.path)
