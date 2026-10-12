"""Real TD checks for mixed modes, toggles, duplicate triggers, pulses and stalls."""
import json
import subprocess
import buffered_scaling as b

path=b.fixture(2,'no-input');directory=path.with_suffix('.tox.dir');component=directory/b.component
valid=b.OUT/'pretrigger-valid.js'
valid.write_text("let count=0;function onPulse(n){if(n==='Trigger')count++;}function draw(p,f){if(f.frame>=160&&f.frame<200){const end=hostNow()+65;while(hostNow()<end){}}p.background(f.chop('amount'),count,f.frame%256);}")
invalid=b.OUT/'invalid.js';invalid.write_text('function draw( broken')
fast=b.OUT/'fast.js';fast.write_text("function draw(p,f){p.background(40,0,f.frame%256);}")
for i in range(2):
    p=component/f'renderer{i}.parm'
    p.write_text(p.read_text().replace(str(b.sketch),str(valid if i==0 else fast)).replace('Width 67108928 1920','Controls 67108928 controls\nWidth 67108928 65').replace('Height 67108928 1080','Height 67108928 37').rstrip().removesuffix('?')+f'Pretrigger 67108928 {int(i==0)}\n?\n')
(component/'controls.n').write_text('CHOP:constant\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
(component/'controls.parm').write_text('?\nconst0name 0 amount\nconst0value 0 40\n?\n')
code=(b.ROOT/'native/td/example/pretrigger.py').read_text()+f'''
import json,math
_coordinate=onFrameStart

def between_passes(nodes):
    sum(math.sin(i*.001) for i in range(60000))

def onFrameStart(frame):
    f=int(frame);a=parent().op('renderer0');control=parent().op('controls')
    if f==40:
        control.par.const0value=90
        a.par.Sendpulse.pulse();a.par.Sendpulse.pulse()
    if f==70:a.par.Pretrigger=0
    if f==100:a.par.Pretrigger=1;a.par.Samecook=1
    if 180<=f<190:a.par.Sendpulse.pulse()
    if f==270:
        for i in range(3):a.par.Sendpulse.pulse()
    if 250<=f<280:return
    if f==300:a.par.Sourcefile={str(invalid)!r}
    if f==330:a.par.Sourcefile={str(valid)!r};a.par.Reset.pulse()
    if f==360:a.par.Width=71;a.par.Height=41
    _coordinate(frame)
    if 130<=f<150:_coordinate(frame) # No second draw/submission in one TD frame.

def onFrameEnd(frame):
    with open({str(b.OUT/'pretrigger-state.jsonl')!r},'a') as out:
        out.write(json.dumps(dict(frame=int(frame),errors=[n.errors() for n in parent().ops('renderer*')],warnings=[n.warnings() for n in parent().ops('renderer*')]))+'\\n')
'''
(component/'driver.n').write_text('DAT:execute\ntile 0 0 160 110\nflags = parlanguage 0\ncolor 0.67 0.67 0.67\nend\n')
(component/'driver.parm').write_text('?\nframestart 0 1\nframeend 0 1\n?\n')
header=(b.basedir/b.component/'sketch.text').read_bytes()[:23];encoded=code.encode()
(component/'driver.text').write_bytes(header+len(encoded).to_bytes(4,'big')+encoded)
toc=path.with_suffix('.tox.toc');toc.write_text(toc.read_text()+'\n'.join(f'{b.component}/{n}' for n in ['controls.n','controls.parm','driver.n','driver.parm','driver.text'])+'\n')
path.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(toc)],capture_output=True)
with (b.OUT/'behavior.jsonl').open('w') as out,(b.OUT/'behavior.log').open('w') as err:
    b.run([b.ROOT/'build/touchengine-probe',path,420,'--buffered-bench'],stdout=out,stderr=err,timeout=120)
rows=[json.loads(l) for l in (b.OUT/'behavior.jsonl').read_text().splitlines()]
state=[json.loads(l) for l in (b.OUT/'pretrigger-state.jsonl').read_text().splitlines()]
assert len(rows)==840
for r in rows:
    f=r['frame']+1
    if f<35:continue
    if r['output']==1:
        assert r['top'][:2]==[40,0] and (f%600-r['top'][2])%256<=3,r
    else:
        if 50<=f<=155:assert r['top'][:2]==[90,2],r
        if 220<=f<=245:assert r['top'][:2]==[90,12],r
        if 285<=f<=295:assert r['top'][:2]==[90,15],r
        if 340<=f:assert r['top'][:2]==[90,0],r
        if 370<=f:assert (r['width'],r['height'])==(71,41),r
assert any('Pre-trigger Mode needs' in str(s['warnings']) for s in state if 255<=s['frame']<=275)
assert any('SyntaxError' in str(s['errors']) for s in state if 305<=s['frame']<=325)
assert all(not any(s['errors']) and not any(s['warnings']) for s in state if 370<=s['frame']<=410)
trace=[json.loads(l) for l in (b.OUT/'trace.jsonl').read_text().splitlines()]
# Duplicate coordinators create extra collection cooks but never extra accepted jobs.
jobs=[t for t in trace if t['workerStartNs'] and t['phase']==2]
by_job={t['workerStartNs']:t for t in jobs}
keys=[(t['instance'],t['outputFrame']) for t in by_job.values()]
assert len(keys)==len(set(keys)), 'Multiple pre-trigger jobs accepted for one TD frame'
print('PASS: mixed modes, toggles, duplicate coordinators, ignored Samecook, queued pulses, busy worker, missing coordinator warning, errors/reset, resize; '+str(b.OUT))
