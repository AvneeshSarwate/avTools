"""One Textport invocation: verification, then benchmark only if it passes."""
from pathlib import Path
import json,time
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
folder=repo/'packages/native-webgpu/test/logging'
(folder/'td-result.json').write_text(json.dumps({'passed':None,'state':'running'}))
exec((folder/'verify_td.py').read_text(),globals())
coordinator=op('/project1/logging_example').create(textDAT,'benchmark_after_verification')
coordinator.text='''from pathlib import Path
import json,time
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir());folder=repo/'packages/native-webgpu/test/logging';started=time.monotonic()
def check():
 result=json.loads((folder/'td-result.json').read_text())
 if result.get('passed') is True:exec((folder/'benchmark.py').read_text(),globals());return
 if result.get('passed') is False:print('Benchmark skipped: verification failed',result);return
 if time.monotonic()-started>60:print('Verification timed out');return
 run("op(args[0]).module.check()",me.path,delayMilliSeconds=500,wallTime=True,delayRef=op.TDResources)
'''
coordinator.module.check()
