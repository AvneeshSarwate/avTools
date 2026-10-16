#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <cstdio>
#include <chrono>
#include <thread>
#include <vector>
#include <stdexcept>
#include <string>
#include <mutex>
#include <condition_variable>
static void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
static void sleep(int ms){std::this_thread::sleep_for(std::chrono::milliseconds(ms));}
int main(int argc,char**argv){try{
  check(argc==3,"timing-bridge runtime Resources");auto* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror());
  auto create=(decltype(&avCreate))dlsym(lib,"avCreate");auto cook=(decltype(&avCook))dlsym(lib,"avCook");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");auto dispatch=(decltype(&avDispatch))dlsym(lib,"avDispatch");
  char error[8192]{};auto* a=create(argv[2],error,sizeof(error));check(a,error);auto* b=create(argv[2],error,sizeof(error));check(b,error);
  AVFrame f{};f.width=f.height=32;f.rate=60;f.sampleRate=60;f.frame=1;std::vector<uint8_t> pixels(32*32*4);f.output=pixels.data();f.outputSize=pixels.size();AVStats stats{};
  float level=41;AVChannel channel{"level",&level,1};f.channels=&channel;f.channelCount=1;
  const char* source=R"JS(let ticks=0,level=0,frames=0,root;function setup(p,h){globalThis.bad=0;root=h.timing.launch(async c=>{while(true){await c.waitSec(.01);ticks++;level=h.chop('level');}});h.timing.launchBrowser(async c=>{while(true){await c.waitFrame();frames++;}});}function onPulse(name){if(name==='stop')root.cancel();}function draw(p){p.background(ticks%256,level,frames);})JS";
  auto render=[&](AVSketch* sketch,bool success=true){auto result=cook(sketch,&f,&stats,error,sizeof(error));check(bool(result)==success,error);return result;};
  f.source=source;render(a);check(!*error,error);int first=pixels[0],firstFrames=pixels[2];sleep(180);render(a);check(pixels[0]>=first+12,"Timers stopped without cooks");check(pixels[1]==41,"Latest controls missing");check(pixels[2]<=firstFrames+2,"Frame waits advanced without frames");
  render(b);check(pixels[0]<8,"Instances shared timing state");level=82;render(a);sleep(35);render(a);check(pixels[1]==82,"Async control snapshot did not update");
  const char* pulse="stop";f.pulses=&pulse;f.pulseCount=1;render(a);int stopped=pixels[0];f.pulseCount=0;sleep(50);render(a);check(pixels[0]==stopped,"Pulse cancellation failed");
  f.source="setTimeout(()=>globalThis.bad=99,10);throw Error('candidate failed');function draw(){}";render(a);check(std::string(error).find("candidate failed")!=std::string::npos,"Candidate failure missing");sleep(40);
  f.source="function draw(p){p.background(globalThis.bad,0,0)}";render(a);check(pixels[0]==0,"Failed candidate leaked timer");
  f.source=R"JS(let saved;function setup(p,h){saved=p;globalThis.stale=0;globalThis.leaked=0;new Promise(resolve=>{globalThis.resolveOld=resolve;}).then(()=>{try{saved.background(255);}catch{globalThis.stale++;}setTimeout(()=>globalThis.leaked++,1);});h.timing.launch(async c=>{try{await c.waitSec(100);}finally{setTimeout(()=>globalThis.leaked++,1);}});}function draw(p){p.background(0);})JS";render(a);
  f.source="function setup(){globalThis.resolveOld();}function draw(p){p.background(globalThis.stale,globalThis.leaked,0)}";render(a);sleep(25);render(a);
  // The old continuation was resolved during candidate setup, before commit:
  // old resources are still valid then. Resolve a second one after commit below.
  check(pixels[1]==0,"Cancellation cleanup leaked timer across commit");
  f.source="function setup(p){new Promise(r=>globalThis.resolveLater=r).then(()=>{try{p.background(255);}catch{globalThis.stale++;}setTimeout(()=>globalThis.leaked++,1);});}function draw(p){p.background(0)}";render(a);
  f.source="function onPulse(){globalThis.resolveLater();}function draw(p){p.background(globalThis.stale,globalThis.leaked,0)}";render(a);f.pulseCount=1;render(a);f.pulseCount=0;sleep(25);render(a);check(pixels[0]>=1&&pixels[1]==0,"Stale continuation crossed lifetime boundary");
  f.source="function setup(){setTimeout(()=>{throw Error('background failure');},5);}function draw(p){p.background(0)}";render(a);sleep(25);render(a,false);check(std::string(error).find("background failure")!=std::string::npos,"Background error not surfaced");
  f.source=source;f.reset=1;render(a);f.reset=0;sleep(30);render(a);check(!*error,error);
  struct Prep{std::mutex mutex;std::condition_variable cv;bool done=false;};Prep prep;
  check(dispatch(a,[](AVSketch*,void* data){sleep(200);auto& p=*(Prep*)data;{std::lock_guard lock(p.mutex);p.done=true;}p.cv.notify_one();},&prep),"Preparation dispatch failed");
  int before=pixels[0];sleep(100);render(a);check(pixels[0]>=before+6,"Blocking input preparation stalled independent timers");
  {std::unique_lock lock(prep.mutex);prep.cv.wait(lock,[&]{return prep.done;});}
  f.syphonName="avTools TimeContext headless";f.syphonOnly=1;render(a);sleep(40);render(a);f.syphonOnly=0;render(a);check(pixels[0]>before,"Syphon mode stalled timers");
  // Device-created resources must cross the host/p guard boundary without
  // proxying a NAPI receiver; retained getters must fail after commit.
  f.syphonName="";
  f.source=R"JS(let image;function setup(p,h){const texture=h.device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});h.device.queue.writeTexture({texture},new Uint8Array([37,82,119,255]),{},[1,1]);image={texture};globalThis.oldTexture=texture;}function draw(p){p.background(0);p.image(image,0,0,32,32);})JS";
  render(a);check(pixels[0]==37&&pixels[1]==82&&pixels[2]==119,"Guarded device texture did not cross into p.image");
  // Candidate setup precedes commit, so check the old getter from a pulse after it.
  f.source="function onPulse(){try{globalThis.oldTexture.width;throw Error('stale getter allowed');}catch(e){if(!String(e).includes('disposed'))throw e;}}function draw(p){p.background(0)}";
  render(a);f.pulseCount=1;render(a);f.pulseCount=0;
  // Resource cleanup runs before guard invalidation, including failed candidates.
  f.source=R"JS(function setup(p,h){globalThis.cleanupOrder=[];const texture=h.device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});h.onDispose(()=>{if(texture.width!==1)throw Error('cleanup lost texture');cleanupOrder.push(1);});h.onDispose(()=>cleanupOrder.push(2));}function draw(p){p.background(0);})JS";
  render(a);
  f.source="function draw(p){if(cleanupOrder[0]!==2||cleanupOrder[1]!==1)throw Error('cleanup ordering failed');p.background(cleanupOrder.length,0,0)}";
  render(a);check(pixels[0]==2,"Cleanup hooks did not run on replacement");
  f.source="function setup(p,h){h.onDispose(()=>cleanupOrder.push(3));throw Error('failed cleanup candidate')}function draw(){}";
  render(a);check(std::string(error).find("failed cleanup candidate")!=std::string::npos,"Failed setup error missing");check(pixels[0]==3,"Failed candidate cleanup did not run");
  for(int cycle=0;cycle<100;cycle++){
    std::string text="// reload "+std::to_string(cycle)+R"JS(
function setup(p,h){setTimeout(()=>{},60000);h.timing.launch(async c=>{while(true)await c.waitSec(60);});}
function draw(p){const s=__hostStats();if(s.generations!==1||s.tasks>8)throw Error('reload leak '+JSON.stringify(s));p.background(s.generations,0,0);})JS";
    f.source=text.c_str();render(a);check(!*error,error);check(pixels[0]==1,"Reload generation count grew");
  }
  auto start=std::chrono::steady_clock::now();destroy(a);destroy(b);check(std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<1,"Sleeping teardown exceeded 1 second");
  puts("TIME CONTEXT BRIDGE PASS: no cooks, frames, controls, two isolates, pulse cancellation, failed/successful reload, stale promises, background errors, reset, input preparation, Syphon, teardown");return 0;
}catch(const std::exception& e){fprintf(stderr,"FAIL: %s\n",e.what());return 1;}}
