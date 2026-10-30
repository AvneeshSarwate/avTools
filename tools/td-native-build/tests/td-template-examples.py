"""Run in TD Textport with __file__ set to this script's absolute path.
Creates isolated /avtools_template_examples and temporary source projects.
Does not save or modify the user's .toe. Reports results under tests/results.
"""
from pathlib import Path
repo=Path(__file__).resolve().parents[3]
root=op('/').create(baseCOMP,'avtools_template_examples');root.store('repo',str(repo))
callback=root.create(executeDAT,'test');callback.par.active=False;callback.par.framestart=True
callback.text='''from pathlib import Path
import tempfile,time,json
repo=Path(parent().fetch('repo'))
root=parent();pre=repo/'packages/native-webgpu/prebuilt/macos-arm64';temp=Path(tempfile.mkdtemp(prefix='avtools-template-examples-'))
root.store('temporary_projects',str(temp))
nodes=[];records=[];started=time.perf_counter();stage=0
result=repo/'tools/td-native-build/tests/results/template-examples-td.json'
def make(name,kind):
 n=root.create(cplusplusTOP if kind=='top' else cplusplusCHOP,name)
 marker='current.txt' if kind=='top' else 'current-chop.txt'
 n.par.plugin=str(pre/(pre/marker).read_text().strip());n.cook(force=True)
 if kind=='top':
  assert (n.par.Width.eval(),n.par.Height.eval())==(1280,720)
  n.par.Width=128;n.par.Height=128;n.par.Samecook=True
 else:n.par.Samecook=True
 d=root.create(infoDAT,'info_'+name);d.par.op=n.name
 return n
for kind in ['top','chop']:
 n=make('starter_'+kind,kind);folder=temp/kind;folder.mkdir();(folder/'show.toe').write_text('keep')
 (folder/'sketches').mkdir();(folder/'sketches/user.ts').write_text('keep too')
 n.par.Templatedir=str(folder);n.par.Createtemplate.pulse();n.cook(force=True)
 projectdir=folder/'avtools-project'
 assert projectdir.is_dir() and (projectdir/'tsconfig.json').is_file(),n.warnings()
 assert not (folder/'tsconfig.json').exists() and not (folder/'sdk').exists()
 assert (folder/'show.toe').read_text()=='keep' and (folder/'sketches/user.ts').read_text()=='keep too'
 assert '/sdk/' in (projectdir/'.gitignore').read_text()
 assert Path(n.par.Typescript.eval()).is_relative_to(projectdir)
 assert '## CHOP API' in (projectdir/'README.md').read_text(encoding='utf-8')
 assert '## UDP and OSC API' in (projectdir/'README.md').read_text(encoding='utf-8')
 if kind=='top':assert (n.par.Width.eval(),n.par.Height.eval())==(1280,720)
 before=(projectdir/'sketches/channels/main.ts').read_text()
 n.par.Createtemplate.pulse();n.cook(force=True);assert 'replace' in n.warnings(),n.warnings()
 assert (projectdir/'sketches/channels/main.ts').read_text()==before
 n.par.Buildproject.pulse();nodes.append(n)
 records.append({'kind':kind,'created_child':True,'preserved_parent':True,'repeat_refused':True,'api_readme':True,'resolution':[n.par.Width.eval(),n.par.Height.eval()] if kind=='top' else None})
# Existing symlink child is rejected without writing through it.
folder=temp/'symlink';folder.mkdir();target=temp/'target';target.mkdir();(folder/'avtools-project').symlink_to(target,target_is_directory=True)
n=make('collision','chop');n.par.Templatedir=str(folder);n.par.Createtemplate.pulse();n.cook(force=True)
assert 'replace' in n.warnings() and not list(target.iterdir()),n.warnings()
records.append({'symlink_refused':True})
# Build and execute the exact WebGPU lifecycle example from the generated README.
readme=(temp/'top/avtools-project/README.md').read_text(encoding='utf-8')
raw=next(block.split('```')[0] for block in readme.split('```ts')[1:] if '// Example: raw-webgpu-lifecycle' in block.split('```')[0])
(temp/'top/avtools-project/sketches/readme-webgpu.ts').write_text(raw,encoding='utf-8')
entries=[('all_controls','parameters/all-controls.ts','chop','value count x y z red alpha textlength pulses',1),('buffers','buffers/interpolate.ts','chop','x y',10000),('inputs','inputs/picture.ts','top','',1),('timing','timing/picture.ts','top','',1),('raw_readme','readme-webgpu.ts','top','',1)]
for name,entry,kind,channels,count in entries:
 n=make(name,kind);n.par.Typescript=str(temp/'top/avtools-project/sketches'/entry)
 if kind=='chop':n.par.Outputchannels=channels;n.par.Outputsamples=count
 nodes.append(n)
# Two XY buffers, exercising math at 10k samples through the example.
for index in range(2):
 d=root.create(textDAT,'buffer_callbacks'+str(index));d.text="def onCook(o):\\n o.clear()\\n o.numSamples=10000\\n o.appendChan('x').vals=[%s]*10000\\n o.appendChan('y').vals=[%s]*10000\\n"%(index*8,index*12)
 c=root.create(scriptCHOP,'input'+str(index));c.par.callbacks=d.path;c.cook(force=True);root.op('buffers').inputConnectors[index].connect(c)
colors=root.create(constantTOP,'image');colors.par.colorr=0;colors.par.colorg=1;colors.par.colorb=0
root.op('inputs').inputConnectors[0].connect(colors)
controls=root.create(constantCHOP,'size');controls.par.name0='size';controls.par.value0=30;root.op('inputs').par.Controls=controls.path

def onFrameStart(frame):
 global stage,started
 try:
  states=[]
  for n in nodes:
   n.cook(force=True);d=root.op('info_'+n.name);d.cook(force=True);states.append(d.text)
  if time.perf_counter()-started<.5 or not all('build_state\\tready' in s for s in states):
   assert time.perf_counter()-started<30,states
   return
  assert all(not n.errors() and not n.warnings() for n in nodes),[(n.name,n.errors(),n.warnings()) for n in nodes]
  a=root.op('all_controls');b=root.op('buffers')
  if stage==0:
   starter=root.op('starter_top');assert (starter.width,starter.height)==(1280,720)
   raw=root.op('raw_readme');pixels=raw.numpyArray(delayed=False)
   assert pixels is not None and float(pixels[64,64,2])>.6 and float(pixels[64,64,0])<.3
   assert [float(a[c][0]) for c in ['count','x','y','z','red','alpha','textlength','pulses']]==[3,.25,.75,1,1,.5,8,0]
   assert b.numSamples==10000 and all(v==4 for v in b['x'].vals) and all(v==6 for v in b['y'].vals)
   image=root.op('inputs').numpyArray(delayed=False);assert image is not None and float(image[0,0,1])>.9
   root.op('starter_top').par.Size=40
   root.op('starter_chop').par.Gain=2;root.op('starter_chop').par.Offset=5
   a.par.Trigger.pulse();b.par.Blend=.25
   raw.par.Width=256;raw.par.Height=144;raw.par.Reset.pulse()
   stage=1;started=time.perf_counter()
  elif time.perf_counter()-started>.2:
   assert float(root.op('starter_chop')['value'][0])==5
   assert root.op('starter_top').par.Size.eval()==40
   assert float(a['pulses'][0])==1
   assert all(v==2 for v in b['x'].vals) and all(v==3 for v in b['y'].vals)
   raw=root.op('raw_readme');pixels=raw.numpyArray(delayed=False)
   assert (raw.width,raw.height)==(256,144) and pixels is not None and float(pixels[70,120,2])>.6
   result.write_text(json.dumps({'passed':True,'records':records,'examples':[n.name for n in nodes],'samples':10000,'math_and_parameter_edits':True,'default_controls':True,'raw_webgpu_readme_and_resize_reset':True},indent=2));me.par.active=False;print('PASS template API README, 720p default, WebGPU lifecycle, collisions, API examples and 10k XY interpolation')
 except Exception as e:
  result.write_text(json.dumps({'passed':False,'error':str(e),'records':records},indent=2));me.par.active=False;print('FAIL template examples',e)
'''
callback.par.active=True
print('Started template/example verification')
