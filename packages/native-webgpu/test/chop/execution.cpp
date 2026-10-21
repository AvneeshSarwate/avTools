#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <chrono>
#include <thread>
#include <iostream>
#include <vector>
#include <algorithm>
#include <stdexcept>
#include <string>
#include <mach/mach.h>
using Clock=std::chrono::steady_clock;
static double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
static void check(bool v,const std::string& message){if(!v)throw std::runtime_error(message);}
static void pause(int n){std::this_thread::sleep_for(std::chrono::milliseconds(n));}
int main(int argc,char** argv){try{
  check(argc>=3,"runtime resources required");auto* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror()?"Cannot load library":"");
  auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto execute=(decltype(&avChopExecute))dlsym(lib,"avChopExecute");
  auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");check(create&&execute&&collect&&destroy,"Missing execution API");
  char error[8192]{};auto* s=create(argv[2],error,sizeof error);check(s,error);
  const char* names[]={"out","pair","count","pulse","dt"};float values[5]{},input=1;AVChopChannel ch{0,{"value",&input,1}};
  AVChopFrame f{};f.names=names;f.outputCount=5;f.output=values;f.outputSamples=1;f.rate=60;f.channels=&ch;f.channelCount=1;
  AVStats stats{};AVChopDiagnostics d{};
  auto run=[&](bool wait){++f.absFrame;f.frame=f.absFrame;f.deltaSeconds=1./60;return execute(s,&f,wait,&stats,&d,error,sizeof error);};
  auto read=[&]{return collect(s,values,5,&stats,&d,error,sizeof error);};
  auto await=[&](uint64_t id){auto start=Clock::now();while(ms(start)<5000){read();if(d.completed>=id)return;pause(2);}throw std::runtime_error("completion timeout");};
  f.source="function setup(h){let t=performance.now();while(performance.now()-t<50){};}function onCook(h,f){h.outputs.set('out',h.inputs.get('value'));h.outputs.set('pair',-h.inputs.get('value'));h.outputs.set('count',h.outputs.get('count')+1);h.outputs.set('dt',f.deltaSeconds)}function onPulse(n,h){h.outputs.set('pulse',h.outputs.get('pulse')*10+Number(n))}";
  auto start=Clock::now();check(!run(false),"First buffered cook must be zero");check(ms(start)<20,"Buffered setup blocked");check(values[0]==0,"Initial output not zero");await(d.submitted);check(values[0]==1&&values[1]==-1,"Initial snapshot incorrect");
  // State survives policy changes, and blocking always waits for its new input.
  input=2;check(run(true),error);check(values[0]==2&&values[2]==2,"Mode switch reset state or stale result");
  f.source="function onCook(h,f){const t=performance.now();while(performance.now()-t<50){};h.outputs.set('out',h.inputs.get('value'));h.outputs.set('pair',-h.inputs.get('value'));h.outputs.set('count',h.outputs.get('count')+1);h.outputs.set('dt',f.deltaSeconds)}function onPulse(n,h){globalThis.eventLog=(globalThis.eventLog||'')+n;h.outputs.set('pulse',h.outputs.get('pulse')*10+Number(n))}";
  run(true);input=10;run(false);pause(5);
  const char* pulse="1";f.pulses=&pulse;f.pulseCount=1;input=11;run(false);f.pulseCount=0;
  for(int i=12;i<=30;i++){input=float(i);start=Clock::now();run(false);check(ms(start)<20,"Buffered input waited for JS");check(values[0]==-values[1],"Partial publication");}
  auto newest=d.submitted;await(newest);check(values[0]==30&&values[3]==1,"Newest input or coalesced pulse lost");check(d.coalesced>=15,"No bounded coalescing");check(values[4]>.2,"Coalescing lost elapsed TD time");
  input=31;run(false);pause(5);input=32;start=Clock::now();check(run(true),error);check(values[0]==32&&ms(start)>40,"Blocking did not wait for fresh request");
  // Event barriers before source replacement must execute on old script once.
  pulse="2";f.pulseCount=1;run(false);f.pulseCount=0;
  f.source="function onCook(h){h.outputs.set('out',Number(globalThis.eventLog||0))}";run(false);await(d.submitted);check(values[0]==0,"Global state survived isolate restart");
  // Timer publications require no additional frame submissions; untouched output
  // does not advance sequence. Getter reads live worker state within the turn.
  f.source="function setup(h){function tick(){let n=h.outputs.get('count')+1;h.outputs.set('count',n);h.outputs.set('out',n);h.outputs.set('pair',-h.outputs.get('out'));setTimeout(tick,5)}setTimeout(tick,5)}";
  check(run(true),error);auto seq=d.published;pause(70);check(read(),error);check(d.published>seq&&values[0]>=5&&values[0]==-values[1],"Timer publication/coherence failed");
  f.source="function onCook(h){h.outputs.set('out',7)}";check(run(true),error);seq=d.published;pause(30);read();check(d.published==seq,"Unchanged arrays republished");
  // New schema: no old buffer/values even while new setup is busy or fails.
  const char* renamed[]={"new","pair","count","pulse","dt"};f.names=renamed;
  f.source="function setup(){let t=performance.now();while(performance.now()-t<50){};throw Error('bad schema')}";
  check(!run(false)&&values[0]==0,"Old schema leaked into new layout");await(d.submitted);check(!read()&&values[0]==0&&std::string(error).find("bad schema")!=std::string::npos,"Failed schema not zero/error");
  f.names=names;f.source="function onCook(h){h.outputs.set('out',88)}";f.reset=1;check(run(true),error);f.reset=0;
  // Timeout retains last compatible buffer, exposes error, then Reset recovers.
  f.source="function onCook(){while(true){}}";start=Clock::now();run(false);check(ms(start)<20,"Timeout request blocked");await(d.submitted);check(read()&&values[0]==88&&*error,"Timeout did not retain/report");
  f.source="function onCook(h){h.outputs.set('out',99)}";f.reset=1;check(run(true),error);f.reset=0;check(values[0]==99,"Reset after timeout failed");
  // Independent slow timers block only their isolate. Even timer-only failures
  // reach the native status exchange without requiring another JS cook.
  f.source="function setup(h){function tick(){let t=performance.now();while(performance.now()-t<50){};h.outputs.set('out',h.outputs.get('out')+1);setTimeout(tick,5)}setTimeout(tick,5)}";
  check(run(true),error);pause(10);start=Clock::now();run(false);check(ms(start)<20,"Independent timer blocked buffered caller");pause(100);read();check(values[0]>=1,"Slow timer output was not published");
  f.source="function setup(){setTimeout(()=>{while(true){}},5)}";f.reset=1;check(run(true),error);f.reset=0;pause(1100);read();check(*error,"Independent timer timeout missing");
  f.source="function onCook(h){h.outputs.set('out',99)}";f.reset=1;check(run(true),error);f.reset=0;
  // Timeline seeks/loops change metadata, not the monotonic timing clock.
  f.source="function setup(h){h.timing.launchBrowser(async c=>{while(true){await c.waitFrame();h.outputs.set('count',h.outputs.get('count')+1)}})}function onCook(h,f){h.outputs.set('out',f.frame);h.outputs.set('dt',f.deltaSeconds)}";
  f.reset=1;f.frame=10;f.absFrame=100;check(execute(s,&f,1,&stats,&d,error,sizeof error),error);f.reset=0;
  float frameCount=values[2];
  for(double timeline:{1.,500.,2.}){f.frame=timeline;++f.absFrame;check(execute(s,&f,1,&stats,&d,error,sizeof error),error);check(values[0]==timeline&&values[2]==++frameCount&&std::abs(values[4]-1./60)<1e-6,"Timeline loop/seek changed frame wait or elapsed time");}
  check(execute(s,&f,1,&stats,&d,error,sizeof error)&&values[4]==0,"Paused forced cook advanced TD elapsed time");
  // Queue overflow is explicit and rejection leaves no waiter/pulse duplication.
  f.source="function onCook(){let t=performance.now();while(performance.now()-t<50){}}";run(false);pause(5);
  std::vector<const char*> pulses(256,"1");f.pulses=pulses.data();f.pulseCount=256;run(false);pulse="2";f.pulses=&pulse;f.pulseCount=1;
  run(false);check(std::string(error).find("queue full")!=std::string::npos,"Pulse overflow not reported");f.pulseCount=0;await(d.submitted);
  destroy(s);
  std::cout<<"PASS buffered init, fresh blocking, mode-state continuity, bounded coalescing, pulse FIFO, elapsed time, timer snapshots, schema isolation, timeout/reset, overflow\n";
  if(argc>3&&std::string(argv[3])=="soak"){
    s=create(argv[2],error,sizeof error);std::vector<float> data(20000,1),result(20000);const char* xyNames[]={"x","y"};
    AVChopChannel xy[]={{0,{"x",data.data(),10000}},{0,{"y",data.data()+10000,10000}}};
    f.names=xyNames;f.outputCount=2;f.outputSamples=10000;f.channels=xy;f.channelCount=2;f.output=result.data();f.pulseCount=0;
    f.source="function onCook(h){for(const name of ['x','y']){const a=h.inputs.samples(name);for(let i=0;i<a.length;i++)a[i]=a[i]*.75+1;h.outputs.setSamples(name,a)}}";
    std::vector<double> memory;
    for(int batch=0;batch<12;batch++){
      for(int i=0;i<2000;i++){++f.absFrame;execute(s,&f,0,&stats,&d,error,sizeof error);}
      auto id=d.submitted;auto start=Clock::now();
      while(ms(start)<5000){collect(s,result.data(),result.size(),&stats,&d,error,sizeof error);if(d.completed>=id)break;pause(2);}
      check(d.completed>=id,"Soak did not drain newest input");
      task_vm_info_data_t info{};mach_msg_type_number_t count=TASK_VM_INFO_COUNT;
      check(task_info(mach_task_self(),TASK_VM_INFO,reinterpret_cast<task_info_t>(&info),&count)==KERN_SUCCESS,"task_info failed");
      memory.push_back(info.phys_footprint/1048576.);std::cout<<"SOAK batch="<<batch<<" footprint_mib="<<memory.back()<<" submitted="<<d.submitted<<" coalesced="<<d.coalesced<<"\n";
    }
    check(memory.back()-memory[3]<32,"Soak footprint failed to stabilize within 32 MiB");destroy(s);
  }
  if(argc>3)return 0;
  // 1/4 instances, scalar and 10k XY math, short/10/50ms workloads.
  for(int count:{1,4})for(int points:{1,10000})for(int delay:{0,10,50})for(int blocking:{0,1}){
    std::vector<AVSketch*> instances;for(int i=0;i<count;i++)instances.push_back(create(argv[2],error,sizeof error));
    std::vector<float> xy(points*2),out(points*2);for(size_t i=0;i<xy.size();i++)xy[i]=float(i)*.001f;
    const char* xyNames[]={"x","y"};AVChopChannel chans[]={{0,{"x",xy.data(),uint32_t(points)}},{0,{"y",xy.data()+points,uint32_t(points)}}};
    std::string code="function onCook(h){const t=performance.now();while(performance.now()-t<"+std::to_string(delay)+"){};for(const name of ['x','y']){let a=h.inputs.samples(name);for(let i=0;i<a.length;i++)a[i]=a[i]*.75+1;h.outputs.setSamples(name,a)}}";
    AVChopFrame frame{};frame.source=code.c_str();frame.rate=60;frame.names=xyNames;frame.outputCount=2;frame.outputSamples=points;frame.output=out.data();frame.channels=chans;frame.channelCount=2;
    std::vector<double> times,ages;uint64_t coalesced=0,reused=0;
    for(int n=0;n<45;n++){
      auto tick=Clock::now();frame.frame=frame.absFrame=n+1;frame.deltaSeconds=1./60;
      for(auto* p:instances){auto t=Clock::now();execute(p,&frame,blocking,&stats,&d,error,sizeof error);if(n>5){times.push_back(ms(t));if(d.ready)ages.push_back(d.inputAgeMs);}if(n==44){coalesced+=d.coalesced;reused+=d.reused;}}
      std::this_thread::sleep_until(tick+std::chrono::milliseconds(17));
    }
    std::sort(times.begin(),times.end());std::sort(ages.begin(),ages.end());
    std::cout<<"BENCH {\"instances\":"<<count<<",\"points\":"<<points<<",\"delay_ms\":"<<delay<<",\"blocking\":"<<blocking<<",\"p50_ms\":"<<times[times.size()/2]<<",\"p95_ms\":"<<times[size_t(times.size()*.95)]<<",\"p99_ms\":"<<times[size_t(times.size()*.99)]<<",\"max_ms\":"<<times.back()<<",\"input_age_p50_ms\":"<<(ages.empty()?-1:ages[ages.size()/2])<<",\"coalesced\":"<<coalesced<<",\"reused\":"<<reused<<"}\n";
    for(auto* p:instances)destroy(p);
  }
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
