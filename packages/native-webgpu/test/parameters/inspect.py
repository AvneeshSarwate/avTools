from pathlib import Path
import json
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
OUT=ROOT/'artifacts/parameters'
assert op('/avtools_parameter_probe') is None, 'Existing probe must be removed explicitly before rerunning'
b=op('/').create(baseCOMP,'avtools_parameter_probe')
n=b.create(cplusplusCHOP,'probe');n.par.plugin=str(OUT/'ParameterProbe.plugin');n.cook(force=True)
t=b.create(cplusplusTOP,'actual_top');t.par.plugin=str(ROOT/'prebuilt/macos-arm64'/ (ROOT/'prebuilt/macos-arm64/current.txt').read_text().strip())
c=b.create(cplusplusCHOP,'actual_chop');c.par.plugin=str(ROOT/'prebuilt/macos-arm64'/ (ROOT/'prebuilt/macos-arm64/current-chop.txt').read_text().strip())
r={'probePars':[p.name for p in n.customPars], 'ops':{}}
for x in [n,t,c]:
 d={'appendCustomPage':hasattr(x,'appendCustomPage'),'destroyCustomPars':hasattr(x,'destroyCustomPars'),'errors':x.errors()}
 try:
  page=x.appendCustomPage('Dynamic');p=page.appendFloat('Dynamicvalue')[0];p.val=17
  d['appendResult']={'value':p.eval(),'style':p.style}
 except Exception as e:d['appendError']=repr(e)
 r['ops'][x.name]=d
r['parMethods']=[x for x in dir(n.par.Speed) if any(k in x.lower() for k in ['export','bind','destroy'])]
r['snapshot']={p.name:{'value':p.eval(),'mode':str(p.mode),'default':p.default} for p in n.customPars}
(OUT/'inspect.json').write_text(json.dumps(r,indent=2,default=str))
print('Parameter probe written:',OUT/'inspect.json')
