#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <chrono>
#include <thread>
#include <iostream>
#include <fstream>
#include <vector>
#include <algorithm>
#include <stdexcept>
#include <string>
static void check(bool ok,const char* msg){if(!ok)throw std::runtime_error(msg);}
static void pause(int ms){std::this_thread::sleep_for(std::chrono::milliseconds(ms));}
int main(int argc,char** argv){try{
  check(argc==3,"bridge runtime Resources");void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror());
  auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");check(create&&cook&&destroy,"Missing CHOP API");
  char error[8192]{};std::vector<AVSketch*> instances;for(int i=0;i<4;i++){auto* p=create(argv[2],error,sizeof(error));check(p,error);instances.push_back(p);}
  const char* names[]={"out","ticks","seen","frames","pulses"};float output[5]{},samples[]={3,9},other=17;
  AVChopChannel channels[]={{0,{"value",samples,2}},{1,{"value",&other,1}}};AVChopFrame f{};f.rate=60;f.channels=channels;f.channelCount=2;f.names=names;f.outputCount=5;f.output=output;AVStats stats{};
  auto run=[&](int i=0,bool success=true){int ready=cook(instances[i],&f,&stats,error,sizeof(error));check(bool(ready)==success,error);};
  f.source="function onCook(h){h.outputs.set('out',h.inputs.get('value'));h.outputs.set('seen',h.inputs.get('value',1)+h.inputs.get('missing'));const a=h.inputs.samples('value');a[1]=999;h.outputs.set('ticks',h.inputs.get('value',0,0));}";
  std::vector<double> durations;
  for(int frame=0;frame<1000;frame++){
    f.frame=f.absFrame=frame;samples[1]=float(frame);
    for(int i=0;i<4;i++){auto start=std::chrono::steady_clock::now();run(i);durations.push_back(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count());check(output[0]==frame&&output[1]==3&&output[2]==17,"Same-cook inputs or owned copies failed");samples[1]=output[0];}
  }
  std::sort(durations.begin(),durations.end());std::cout<<"same_cook_chain=4000 median_ms="<<durations[durations.size()/2]<<" p95_ms="<<durations[size_t(durations.size()*.95)]<<"\n";
  const char* stateful=R"JS(function setup(h){h.timing.launch(async c=>{while(true){await c.waitSec(.01);h.outputs.set('ticks',h.outputs.get('ticks')+1);h.outputs.set('seen',h.inputs.get('value'));}});h.timing.launchBrowser(async c=>{while(true){await c.waitFrame();h.outputs.set('frames',h.outputs.get('frames')+1);}});}function onPulse(name,h){if(name==='Trigger')h.outputs.set('pulses',h.outputs.get('pulses')+1);}function onCook(h){h.outputs.set('out',h.inputs.get('value')*2);})JS";
  f.source=stateful;samples[1]=21;run();float first=output[1],frames=output[3];pause(160);run();check(output[1]>=first+8,"Timers depend on cook");check(output[2]==21,"Timer did not read latest inputs");check(output[3]==frames+1,"Frame waits ran while paused");check(output[0]==42,"Cook evaluator stale");
  run(1);check(output[1]<5,"CHOP instances share state");samples[1]=31;run();pause(40);run();check(output[2]==31&&output[0]==62,"Fresh snapshot missing");
  const char* pulse="Trigger";f.pulses=&pulse;f.pulseCount=1;run();check(output[4]==1,"Pulse failed");f.pulseCount=0;run();check(output[4]==1,"Pulse duplicated");
  f.source="function setup(h){globalThis.failedCleanup=0;h.onDispose(()=>globalThis.failedCleanup++);setTimeout(()=>globalThis.leaked=1,5);throw Error('candidate failed');}";run(0,false);check(std::string(error).find("candidate failed")!=std::string::npos,"Failed setup error missing");pause(30);
  f.source="function onCook(h){h.outputs.set('out',globalThis.failedCleanup||0);h.outputs.set('seen',globalThis.leaked||0)}";run();check(output[0]==0&&output[2]==0,"Failed environment leaked globals");pause(40);run();check(output[1]==0,"Old timers survived reload");
  f.source="function setup(h){globalThis.staleHost=h;}";run();
  f.source="function onCook(h){try{globalThis.staleHost.outputs.set('out',99)}catch{h.outputs.set('out',7)}}";run();check(output[0]==7,"Disposed host is writable");
  f.source="async function onCook(h){h.outputs.set('out',1)}";run(0,false);check(std::string(error).find("must be synchronous")!=std::string::npos,"Async cook accepted");
  f.source="function setup(){setTimeout(()=>{throw Error('background failure')},5)}";run();pause(30);run(0,false);check(std::string(error).find("background failure")!=std::string::npos,"Background error missing");
  f.source=stateful;f.reset=1;run();f.reset=0;check(!*error,error);
  f.source="function onCook(h){h.outputs.set('out',NaN)}";run(0,false);check(std::string(error).find("finite")!=std::string::npos,"Non-finite output accepted");
  f.source="function onCook(h){h.outputs.set('unknown',1)}";run(0,false);check(std::string(error).find("Unknown output")!=std::string::npos,"Unknown channel accepted");
  f.source=stateful;f.reset=1;run();f.reset=0;
  f.channelCount=4097;run(0,false);f.channelCount=2;
  for(int i=0;i<100;i++){f.reset=1;run();check(output[1]<5,"Reload inherited timing state");}f.reset=0;
  // Buffer stress: two channels of XY points. Every sample encodes the current
  // frame, so stale or partial output is detected, including across four instances.
  const char* xyNames[]={"x","y"};
  f.names=xyNames;f.outputCount=2;f.pulseCount=0;
  f.source="function onCook(h){for(const name of ['x','y']){const v=h.inputs.samples(name);for(let i=0;i<v.length;i++)v[i]=v[i]*2+1;h.outputs.setSamples(name,v);v.fill(-999);}}";
  for(uint32_t points:{10000u,100000u}){
    std::vector<float> x(points),y(points),xyOutput(points*2);
    AVChopChannel xy[]={{0,{"x",x.data(),points}},{0,{"y",y.data(),points}}};
    f.channels=xy;f.channelCount=2;f.outputSamples=points;f.output=xyOutput.data();durations.clear();
    for(int frame=0;frame<250;frame++){
      for(uint32_t j=0;j<points;j++){x[j]=float(frame)+float(j)/points;y[j]=-x[j];}
      for(int instance=0;instance<4;instance++){
        auto start=std::chrono::steady_clock::now();run(instance);
        if(frame>5)durations.push_back(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count());
        for(uint32_t j=0;j<points;j++)check(xyOutput[j]==x[j]*2+1&&xyOutput[points+j]==y[j]*2+1,"Large XY buffer stale, corrupt, or caller-owned");
      }
    }
    std::sort(durations.begin(),durations.end());std::cout<<"xy_points="<<points<<" instances=4 frames=250 median_ms="<<durations[durations.size()/2]<<" p95_ms="<<durations[size_t(durations.size()*.95)]<<"\n";
    f.source="function onCook(h){h.outputs.setSamples('x',[NaN]);}";run(0,false);check(std::string(error).find("samples")!=std::string::npos,"Wrong buffer length accepted");
    f.source="function onCook(h){const a=new Float32Array(h.outputs.sampleCount);a[4]=NaN;h.outputs.setSamples('x',a);}";run(0,false);check(std::string(error).find("finite")!=std::string::npos,"Nonfinite buffer accepted");
    f.source="function onCook(h){for(const name of ['x','y']){const v=h.inputs.samples(name);for(let i=0;i<v.length;i++)v[i]=v[i]*2+1;h.outputs.setSamples(name,v);v.fill(-999);}}";
  }
  for(auto* instance:instances)destroy(instance);
  std::cout<<"PASS: same-cook chain, independent timers, multi-input/sample snapshots, pulses, reload/reset, failed setup cleanup, stale host, async/background errors, 100 reloads\n";
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
