"""Exercise buffered TOP state changes in real headless TD, without editor automation."""
from pathlib import Path
import json
import subprocess
import buffered_scaling as b

path=b.fixture(2,'no-input')
directory=path.with_suffix('.tox.dir')
component=directory/b.component
valid=b.OUT/'behavior-valid.js'
valid.write_text("let count=0;function onPulse(n,p,f){if(n==='Trigger')count++;}function draw(p,f){p.background(f.chop('amount'),count,f.frame%256);}")
slow=b.OUT/'behavior-slow.js'
slow.write_text(valid.read_text().replace('p.background(',"if(f.frame>=160&&f.frame<200){const until=hostNow()+65;while(hostNow()<until){}}p.background("))
invalid=b.OUT/'behavior-invalid.js';invalid.write_text('function draw( broken')
throws=b.OUT/'behavior-throws.js';throws.write_text("function draw(){throw Error('expected buffered draw failure');}")
hung=b.OUT/'behavior-hung.js';hung.write_text('async function setup(){await new Promise(()=>{});}function draw(){}')
for i in range(2):
    p=component/f'renderer{i}.parm'
    p.write_text(p.read_text().replace(str(b.sketch),str(valid)).replace('Width 67108928 1920','Controls 67108928 controls\nWidth 67108928 65').replace('Height 67108928 1080','Height 67108928 37'))
(component/'controls.n').write_text('CHOP:constant\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
(component/'controls.parm').write_text('?\nconst0name 0 amount\nconst0value 0 40\n?\n')
code=f'''import json
from pathlib import Path

def onFrameStart(frame):
    f=int(frame);a=parent().op('renderer0');control=parent().op('controls')
    if f==40:
        control.par.const0value=90
        a.par.Sendpulse.pulse();a.par.Sendpulse.pulse()
    if f==70: a.par.Width=71;a.par.Height=41
    if f==100: a.par.Sourcefile={str(invalid)!r}
    if f==130: a.par.Sourcefile={str(valid)!r}
    if f==160: a.par.Sourcefile={str(slow)!r}
    if 180<=f<190: a.par.Sendpulse.pulse()
    if f==185: control.par.const0value=120
    if f==250: a.par.Sourcefile={str(throws)!r}
    if f==270: a.par.Sourcefile={str(valid)!r}
    if f==300: a.par.Sourcefile={str(hung)!r}
    if f==310:
        a.par.Sourcefile={str(valid)!r};a.par.Reset.pulse()
        a.par.Sendpulse.pulse();a.par.Sendpulse.pulse();a.par.Sendpulse.pulse()
    return

def onFrameEnd(frame):
    with open({str(b.OUT/'behavior-state.jsonl')!r},'a') as out:
        out.write(json.dumps(dict(frame=int(frame),errors=[n.errors() for n in parent().ops('renderer*')]))+'\\n')
    return
'''
(component/'driver.n').write_text('DAT:execute\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
(component/'driver.parm').write_text('?\nframestart 0 1\nframeend 0 1\n?\n')
header=(b.basedir/b.component/'sketch.text').read_bytes()[:23]
encoded=code.encode();(component/'driver.text').write_bytes(header+len(encoded).to_bytes(4,'big')+encoded)
toc=path.with_suffix('.tox.toc')
toc.write_text(toc.read_text()+'\n'.join(f'{b.component}/{name}' for name in ['controls.n','controls.parm','driver.n','driver.parm','driver.text'])+'\n')
path.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(toc)],capture_output=True)
assert path.exists()
with (b.OUT/'behavior.jsonl').open('w') as out,(b.OUT/'behavior.log').open('w') as err:
    b.run([b.ROOT/'build/touchengine-probe',path,540,'--buffered-bench'],stdout=out,stderr=err,timeout=120)
rows=[json.loads(line) for line in (b.OUT/'behavior.jsonl').read_text().splitlines()]
state=[json.loads(line) for line in (b.OUT/'behavior-state.jsonl').read_text().splitlines()]
assert len(state)>=540
# Independent second instance keeps animating throughout the first's GPU/JS waits.
for r in rows:
    if r['frame']<30:continue
    if r['output']==1:
        assert r['top'][1]==0,r
        assert (r['frame']+1-r['top'][2])%256<=3,r
    else:
        f=r['frame']+1
        if 48<=f<=65:assert r['top'][:2]==[90,2],r
        if 80<=f<=95:assert (r['width'],r['height'])==(71,41) and r['top'][:2]==[90,0],r
        if 225<=f<=240:assert r['top'][:2]==[120,10],r
        if 280<=f<=295:assert r['top'][:2]==[120,0],r
        if 520<=f<=539:assert r['top'][:2]==[120,3],r
assert any('SyntaxError' in str(s['errors']) for s in state if 105<=s['frame']<=125)
assert any('expected buffered draw failure' in str(s['errors']) for s in state if 250<=s['frame']<=265)
assert all(not any(s['errors']) for s in state if 520<=s['frame']<=539)
print('PASS: snapshots, exactly-once queued pulses, resize, syntax/last-good, draw error/recovery, overload, async timeout/reset, independent second instance; '+str(b.OUT))
