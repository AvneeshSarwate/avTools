#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <sys/resource.h>
#include <chrono>
#include <thread>
#include <iostream>
#include <fstream>
#include <vector>
#include <algorithm>
#include <stdexcept>
static void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static void pause(int ms){std::this_thread::sleep_for(std::chrono::milliseconds(ms));}
int main(int argc,char** argv){try{
  check(argc==4,"bridge runtime Resources assetdir");void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror());
  auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");
  auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");
  char error[8192]{};AVSketch* sketch=create(argv[2],error,sizeof(error));check(sketch,error);
  const char* names[]={"value","count","port","errors","ticks"};float values[5]{};AVStats stats{};AVChopDiagnostics diag{};
  AVChopFrame f{};f.rate=60;f.outputCount=5;f.names=names;f.output=values;f.baseDirectory=argv[3];
  auto run=[&](bool success=true){auto ok=cook(sketch,&f,&stats,error,sizeof(error));check(bool(ok)==success,error);};
  f.source=R"JS(async function setup(h){
    const text=await h.files.readText('asset.txt');if(text!=='hello 日本語 🎛️\n')throw Error('UTF-8 file mismatch');
    const bytes=await h.files.readBytes('asset.bin');if(bytes.length!==1048576||bytes[12345]!==57)throw Error('Binary file mismatch');
    for(const name of ['missing.txt','.','fifo','oversize.bin']){let failed=false;try{await h.files.readBytes(name)}catch{failed=true}if(!failed)throw Error('Invalid file accepted: '+name);}
    let failures=0;await Promise.all(Array.from({length:12},()=>h.files.readBytes('asset.bin').catch(()=>{failures++})));if(!failures)throw Error('File pressure limit missing');
    const osc=await h.osc.open();h.outputs.set('port',osc.localAddress.port);
    osc.onError(()=>h.outputs.set('errors',h.outputs.get('errors')+1));
    osc.onMessage((message,remote)=>{if(message.address==='/value'){h.outputs.set('value',message.args[0].value);h.outputs.set('count',h.outputs.get('count')+1);osc.send({address:'/reply',args:message.args},remote);}});
    function tick(){h.outputs.set('ticks',h.outputs.get('ticks')+1);setTimeout(tick,5)}tick();
  })JS";
  run();const int port=int(values[2]);check(port>0,"No bound UDP port");
  int fd=socket(AF_INET,SOCK_DGRAM,0);check(fd>=0,"socket failed");timeval timeout{1,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));sockaddr_in destination{};destination.sin_family=AF_INET;destination.sin_port=htons(port);inet_pton(AF_INET,"127.0.0.1",&destination.sin_addr);
  auto send=[&](const std::vector<uint8_t>& packet){check(sendto(fd,packet.data(),packet.size(),0,reinterpret_cast<sockaddr*>(&destination),sizeof(destination))==ssize_t(packet.size()),"send failed");};
  const std::vector<uint8_t> message={'/','v','a','l','u','e',0,0,',','i',0,0,0,0,0,42};
  send(message);uint8_t reply[128];int count=recv(fd,reply,sizeof(reply),0);check(count==16&&reply[1]=='r'&&reply[15]==42,"OSC reply while TD paused failed");
  pause(30);check(collect(sketch,values,5,&stats,&diag,error,sizeof(error)),error);check(values[0]==42&&values[1]==1&&values[4]>=3,"I/O publication depended on a cook");
  // Future timetag is delivered now; nested bundles preserve ordering.
  std::vector<uint8_t> bundle={'#','b','u','n','d','l','e',0,0xf0,0,0,0,0,0,0,0,0,0,0,16};bundle.insert(bundle.end(),message.begin(),message.end());send(bundle);check(recv(fd,reply,sizeof(reply),0)==16,"Future bundle was scheduled instead of delivered immediately");
  send({'/','x',0,0,',','z',0,0});pause(20);collect(sketch,values,5,&stats,&diag,error,sizeof(error));check(values[3]==1,"Malformed OSC not reported");
  // Actual request/reply latency, with no TD cooks during measurement.
  std::vector<double> timings;
  for(int i=0;i<300;i++){auto start=std::chrono::steady_clock::now();send(message);check(recv(fd,reply,sizeof(reply),0)==16,"OSC lost response");timings.push_back(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count());}
  std::sort(timings.begin(),timings.end());std::cout<<"OSC paused-cook roundtrip median_ms="<<timings[150]<<" p95_ms="<<timings[285]<<"\n";
  // Reuse the exact UDP port repeatedly: old generations must close before setup.
  std::string reload="async function setup(h){const s=await h.udp.open({port:"+std::to_string(port)+"});s.onMessage((b,r)=>{h.outputs.set('count',h.outputs.get('count')+1);s.send(b,r)});h.outputs.set('port',s.localAddress.port)}";
  f.source=reload.c_str();
  for(int i=0;i<50;i++){f.reset=1;run();send(message);check(recv(fd,reply,sizeof(reply),0)==16,"UDP reload response missing");pause(2);collect(sketch,values,5,&stats,&diag,error,sizeof(error));check(values[1]==1,"Stale/duplicate UDP callback after reload");}f.reset=0;
  // Async setup rejection is surfaced without hanging or occupying the port.
  std::string conflict="async function setup(h){await h.udp.open({port:"+std::to_string(port)+"});await h.udp.open({port:"+std::to_string(port)+"});}";
  f.source=conflict.c_str();run(false);check(std::string(error).find("address already in use")!=std::string::npos,"Bind error missing");
  pause(20);int released=socket(AF_INET,SOCK_DGRAM,0);check(bind(released,reinterpret_cast<sockaddr*>(&destination),sizeof(destination))==0,"Failed setup retained its UDP socket");close(released);
  f.source=reload.c_str();run();
  std::string flood="async function setup(h){const s=await h.udp.open({port:"+std::to_string(port)+"});s.onMessage(b=>{if(b[0]===255){const end=performance.now()+100;while(performance.now()<end){}}h.outputs.set('count',h.outputs.get('count')+1)})}function onCook(h){h.outputs.set('errors',h.udp.droppedDatagrams)}";
  f.source=flood.c_str();run();send({255});pause(5);for(int i=0;i<6000;i++)send({1});pause(250);run();check(values[3]>0,"Flood did not exercise bounded datagram queue");std::cout<<"flood dropped="<<values[3]<<" delivered="<<values[1]<<"\n";
  // Four independent idle UDP loops add no polling timer. Compare same-cook cost.
  std::vector<AVSketch*> four{sketch};for(int i=0;i<3;i++){auto* s=create(argv[2],error,sizeof(error));check(s,error);four.push_back(s);}
  f.source="async function setup(h){const s=await h.udp.open();h.outputs.set('port',s.localAddress.port)}function onCook(h){h.outputs.set('value',42)}";
  for(auto* s:four)check(cook(s,&f,&stats,error,sizeof(error)),error);
  rusage a{},b{};getrusage(RUSAGE_SELF,&a);pause(600);getrusage(RUSAGE_SELF,&b);
  auto cpu=[](const rusage& r){return r.ru_utime.tv_sec+r.ru_stime.tv_sec+(r.ru_utime.tv_usec+r.ru_stime.tv_usec)/1e6;};
  std::cout<<"four_idle_udp_cpu_percent="<<(cpu(b)-cpu(a))/0.6*100<<"\n";
  timings.clear();for(int i=0;i<500;i++){auto start=std::chrono::steady_clock::now();for(auto* s:four){check(cook(s,&f,&stats,error,sizeof(error)),error);check(values[0]==42,"Four-instance output mismatch");}timings.push_back(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count());}
  std::sort(timings.begin(),timings.end());std::cout<<"four_chop_cook_total median_ms="<<timings[250]<<" p95_ms="<<timings[475]<<"\n";
  for(auto* s:four)destroy(s);close(fd);
  int probe=socket(AF_INET,SOCK_DGRAM,0);check(bind(probe,reinterpret_cast<sockaddr*>(&destination),sizeof(destination))==0,"UDP port leaked after destroy");close(probe);
  std::cout<<"PASS: async setup files, UTF8/binary/errors/limits, OSC interoperability, future bundles, malformed traffic, paused-cook callbacks, 50 port rebinds, failed setup and destroy cleanup\n";
}catch(const std::exception& error){std::cerr<<"FAIL: "<<error.what()<<"\n";return 1;}}
