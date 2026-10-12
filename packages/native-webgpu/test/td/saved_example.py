"""Validate saved .tox and the component embedded in the standalone .toe, headlessly."""
from pathlib import Path
import subprocess,json,shutil,time
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/td'/('buffered-saved-example-'+str(time.time_ns()));out.mkdir()
plugin=(root/'build/td-plugin-path.txt').read_text().strip()
toe=out/'Sketch.toe';shutil.copy2(root/'native/td/example/Sketch.toe',toe)
subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(toe)],capture_output=True)
directory=out/'from-toe.tox.dir';directory.mkdir();source=out/'Sketch.toe.dir';component='avtools_sketch_example'
for suffix in ['.n','.cparm','.parm']:shutil.copy2(source/'project1'/(component+suffix),directory/(component+suffix))
shutil.copytree(source/'project1'/component,directory/component);shutil.copy2(source/'.build',directory/'.build')
toc=out/'from-toe.tox.toc';original=Path(str(toe)+'.toc').read_text().splitlines();entries=['.build']+[line.removeprefix('project1/') for line in original if line.startswith('project1/'+component)]
toc.write_text('# 4 0 0 0 1\n'+'\n'.join(entries)+'\n');subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(toc)],capture_output=True)
cases=[('tox',root/'native/td/example/Sketch.tox'),('toe-component',out/'from-toe.tox')]
# Exercise the exact coordinator embedded in both distribution artifacts.
for name,original in list(cases):
 path=out/(name+'-pretrigger.tox');shutil.copy2(original,path)
 subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand',str(path)],capture_output=True)
 for node in ['sketch1','sketch2']:
  p=Path(str(path)+'.dir')/component/(node+'.parm')
  p.write_text(p.read_text().rstrip().removesuffix('?')+'Pretrigger 67108928 1\n?\n')
 path.unlink();subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse',str(path)+'.toc'],capture_output=True)
 cases.append((name+'-pretrigger',path))
for name,path in cases:
 with (out/(name+'.jsonl')).open('w') as stdout,(out/(name+'.log')).open('w') as stderr:
  subprocess.run([root/'build/touchengine-probe',path,'90','--sketch',plugin],stdout=stdout,stderr=stderr,check=True,timeout=90)
 rows=[json.loads(line) for line in (out/(name+'.jsonl')).read_text().splitlines()];assert len(rows)==180
 for r in rows:
  if r['frame']<30 or 45<=r['frame']<=48:continue
  index=int(r['output'][-1])-1;assert (r['width'],r['height'])==(191+index*16,79+index*8),r
  rgba=r['center'];rgba=([rgba[2],rgba[1],rgba[0],rgba[3]] if r['pixelFormat']==80 else rgba)
  assert rgba[0]==(40 if r['frame']<45 else 90) and rgba[1]==80 and rgba[3]==255,r
 print(name,'PASS',flush=True)
print(out,flush=True)
