#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <chrono>
#include <thread>
#include <iostream>
#include <fstream>
#include <vector>
#include <stdexcept>
#include <sys/resource.h>
static void check(bool value,const char* text){if(!value)throw std::runtime_error(text);}
int main(int argc,char** argv){try{
  check(argc==4,"runtime resources port");
  auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror());
  auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");
  auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");
  auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");
  auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");
  char error[8192]{};
  const char* names[]={"opened","text","binary","closed","errors","sent","ticks"};
  AVStats stats{};AVChopDiagnostics diag{};float values[7]{};
  AVChopFrame frame{};frame.outputCount=7;frame.names=names;frame.output=values;frame.rate=60;
  std::string source=std::string(R"JS(function setup(h){
    const s=h.webSocket.connect('ws://localhost:)JS")+argv[3]+R"JS(/echo');
    s.onOpen(()=>{
      h.outputs.set('opened',1);
      s.send('hello 日本語 🎨').then(()=>h.outputs.set('sent',h.outputs.get('sent')+1));
      const bytes=new Uint8Array(1024*1024);bytes.fill(42);
      s.send(bytes).then(()=>h.outputs.set('sent',h.outputs.get('sent')+1));
      bytes.fill(99); // Native send must own a copy.
      s.send(new Uint8Array(8*1024*1024+1)).then(()=>{throw Error('Oversize accepted')},()=>h.outputs.set('errors',h.outputs.get('errors')+1));
      try{s.close(1006)}catch{h.outputs.set('errors',h.outputs.get('errors')+1)}
    });
    s.onMessage(data=>{
      if(typeof data==='string'){
        if(data!=='hello 日本語 🎨')throw Error('Text mismatch');h.outputs.set('text',1);
      }else{
        if(data.length!==1048576||data[0]!==42||data[data.length-1]!==42)throw Error('Binary mismatch');h.outputs.set('binary',1);
      }
    });
    s.onClose(()=>h.outputs.set('closed',1));
    s.onError(error=>{throw error});
    function tick(){h.outputs.set('ticks',h.outputs.get('ticks')+1);setTimeout(tick,10)}tick();
  })JS";
  frame.source=source.c_str();
  std::vector<AVSketch*> instances;
  auto awaitReady=[&](AVSketch* instance){
    for(int retry=0;retry<500;retry++){
      check(collect(instance,values,7,&stats,&diag,error,sizeof(error)),error);
      if(values[0]==1&&values[1]==1&&values[2]==1&&values[5]==2&&values[6]>2){check(values[4]==2,"Validation limits failed");return;}
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    throw std::runtime_error("V8 WebSocket callbacks timed out");
  };
  for(int n=0;n<4;n++){
    auto instance=create(argv[2],error,sizeof(error));check(instance,error);instances.push_back(instance);
    check(cook(instance,&frame,&stats,error,sizeof(error)),error);
  }
  for(auto instance:instances)awaitReady(instance);
  for(int n=0;n<30;n++){
    frame.reset=1;check(cook(instances[0],&frame,&stats,error,sizeof(error)),error);awaitReady(instances[0]);
  }
  frame.reset=0;
  // Remove intentional test timers before measuring idle connected sockets.
  std::string idle="function setup(h){const s=h.webSocket.connect('ws://127.0.0.1:"+std::string(argv[3])+"/echo');s.onOpen(()=>h.outputs.set('opened',1));s.onError(e=>{throw e})}";
  frame.source=idle.c_str();for(auto instance:instances)check(cook(instance,&frame,&stats,error,sizeof(error)),error);
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  rusage before{},after{};getrusage(RUSAGE_SELF,&before);
  std::this_thread::sleep_for(std::chrono::seconds(1));getrusage(RUSAGE_SELF,&after);
  auto cpu=[](const rusage& r){return r.ru_utime.tv_sec+r.ru_stime.tv_sec+(r.ru_utime.tv_usec+r.ru_stime.tv_usec)/1e6;};
  std::cout<<"four_idle_websocket_cpu_percent="<<(cpu(after)-cpu(before))*100<<"\n";
  // Failed setup after creating a connection must also invalidate the socket.
  frame.source="function setup(h){h.webSocket.connect('ws://127.0.0.1:1');throw Error('intentional setup failure')}";
  check(!cook(instances[0],&frame,&stats,error,sizeof(error)),"Failed setup unexpectedly succeeded");
  for(auto instance:instances)destroy(instance);
  std::cout<<"PASS: four V8 workers, no-cook callbacks, text/binary copies, send errors, timers, 30 reloads, failed setup, teardown\n";
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
