"""Run in TD Textport with __file__ set. Creates isolated /avtools_io_test.
Each plugin is copied on its own away from the repo to verify static packaging.
The user's project is not saved or overwritten.
"""
from pathlib import Path
folder=Path(__file__).resolve().parent;repo=folder.parents[3]
root=op('/').create(baseCOMP,'avtools_io_test');root.store('repo',str(repo))
runner=root.create(executeDAT,'test');runner.par.active=False;runner.par.framestart=True
runner.text='''from pathlib import Path
import json, tempfile, shutil, socket, time
repo=Path(parent().fetch('repo'));root=parent()
pre=repo/'packages/native-webgpu/prebuilt/macos-arm64'
temp=Path(tempfile.mkdtemp(prefix='avtools-io-isolated-'))
result=repo/'packages/native-webgpu/test/io/results/td.json';result.parent.mkdir(exist_ok=True)
stage=0;started=time.perf_counter();records=[]
def make(kind):
 folder=temp/kind;folder.mkdir();marker='current.txt' if kind=='top' else 'current-chop.txt'
 bundle=pre/(pre/marker).read_text().strip();copied=folder/bundle.name;shutil.copytree(bundle,copied,symlinks=True)
 assert not (folder/'native-build').exists()
 n=root.create(cplusplusTOP if kind=='top' else cplusplusCHOP,kind)
 n.par.plugin=str(copied);n.cook(force=True);n.par.Samecook=True
 if kind=='top':n.par.Width=128;n.par.Height=128
 n.par.Templatedir=str(folder);n.par.Createtemplate.pulse();n.cook(force=True)
 project=folder/'avtools-project';assert (project/'sdk/packages/native-webgpu/td-io.d.ts').is_file()
 n.par.Typescript=str(project/'sketches/osc'/('picture.ts' if kind=='top' else 'channels.ts'))
 if kind=='chop':n.par.Outputchannels='value target messages port'
 info=root.create(infoDAT,'info_'+kind);info.par.op=n.name
 sender=root.create(oscoutDAT,'send_'+kind);sender.par.address='127.0.0.1';sender.viewer=True
 return n
nodes=[make('top'),make('chop')]
def onFrameStart(frame):
 global stage,started
 try:
  states=[]
  for n in nodes:
   n.cook(force=True);d=root.op('info_'+n.name);d.cook(force=True);states.append(d.text)
  if not all('build_state\\tready' in s for s in states) or any(getattr(n.par,'Port',None) is None for n in nodes):
   assert time.perf_counter()-started<45,states
   return
  assert all(not n.errors() and not n.warnings() for n in nodes),[(n.name,n.errors(),n.warnings()) for n in nodes]
  top,chop=nodes
  if stage==0:
   with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as probe:probe.bind(('127.0.0.1',0));topport=probe.getsockname()[1]
   top.par.Port=topport;top.par.Reset.pulse();top.cook(force=True)
   port=int(chop['port'][0]);assert port>0;chop.par.Port=port;chop.par.Reset.pulse();chop.cook(force=True)
   root.op('send_top').par.port=topport;root.op('send_chop').par.port=port
   stage=.5;started=time.perf_counter()
  elif stage==.5 and time.perf_counter()-started>.1:
   # TD applies changed OSC Out connection parameters between frames.
   root.op('send_top').sendOSC('/x',[.2]);root.op('send_chop').sendOSC('/target',[.8])
   stage=1;started=time.perf_counter()
  elif stage==1 and time.perf_counter()-started>.8:
   assert float(chop['messages'][0])==1 and abs(float(chop['target'][0])-.8)<.001,[(c.name,c[0]) for c in chop.chans()]
   assert float(chop['value'][0])>.7
   image=top.numpyArray(delayed=False);assert image is not None and float(image[64,25,2])>.9 and float(image[64,100,2])<.15
   assert '/received' in root.op('send_chop').text,root.op('send_chop').text
   records.append({'isolated_plugin_template_top_and_chop':True,'async_relative_config_reads':True,'native_td_osc_replies':True,'top_position_pixels':True,'timecontext_easing':True})
   root.store('oldport',int(chop['port'][0]));chop.par.Reset.pulse();chop.cook(force=True)
   root.op('send_chop').sendOSC('/target',[.4]);stage=2;started=time.perf_counter()
  elif stage==2 and time.perf_counter()-started>.3:
   assert int(chop['port'][0])==root.fetch('oldport') and float(chop['messages'][0])==1
   path=Path(chop.par.Typescript.eval());code=path.read_text();assert 'let messages = 0;' in code;path.write_text(code.replace('let messages = 0;','let messages = 10;'))
   stage=3;started=time.perf_counter()
  elif stage==3 and time.perf_counter()-started>1:
   root.op('send_chop').sendOSC('/target',[.6]);stage=4;started=time.perf_counter()
  elif stage==4 and time.perf_counter()-started>.4:
   assert float(chop['messages'][0])==11,[(c.name,c[0]) for c in chop.chans()]
   assert int(chop['port'][0])==root.fetch('oldport')
   records.append({'reset_same_port':True,'save_rebuild_reload_same_port':True})
   result.write_text(json.dumps({'passed':True,'records':records,'temporary_projects':str(temp),'plugins':[str(n.par.plugin.eval()) for n in nodes]},indent=2));me.par.active=False;print('PASS isolated static plugins + async files + native TD OSC + reset/reload')
 except Exception as error:
  import traceback
  result.write_text(json.dumps({'passed':False,'error':str(error),'traceback':traceback.format_exc(),'stage':stage,'records':records,'temporary_projects':str(temp)},indent=2));me.par.active=False;print('FAIL IO',error)
'''
runner.par.active=True
print('Started isolated file/OSC plugin test')
