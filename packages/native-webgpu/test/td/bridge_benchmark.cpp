#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <thread>
#include <vector>
#include <algorithm>
using Clock=std::chrono::steady_clock;
int main(int argc,char**argv){try{
  if(argc<4)throw std::runtime_error("bridge-benchmark runtime.dylib Resources cpu|syphon [frames]");
  void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
  auto create=reinterpret_cast<decltype(&avCreate)>(dlsym(lib,"avCreate"));auto cook=reinterpret_cast<decltype(&avCook)>(dlsym(lib,"avCook"));auto destroy=reinterpret_cast<decltype(&avDestroy)>(dlsym(lib,"avDestroy"));
  char error[8192]{};auto* sketch=create(argv[2],error,sizeof(error));if(!sketch)throw std::runtime_error(error);
  bool syphon=strcmp(argv[3],"syphon")==0;int frames=argc>4?atoi(argv[4]):600;
  std::vector<uint8_t> pixels(syphon?4:1920*1080*4);AVFrame f{};f.width=1920;f.height=1080;f.rate=60;f.syphonOnly=syphon;f.syphonName=syphon?"avTools embedded benchmark":"";f.output=pixels.data();f.outputSize=pixels.size();
  f.source="function setup(p){p.textSize(48);} function draw(p,f){p.background(f.frame%256,80,160);p.noStroke();p.fill(255);p.text('Dawn + Rust embedded',100,100);p.circle(960+Math.sin(f.frame/20)*400,540,200);}";
  std::vector<double> total,draw,readback;AVStats stats{};auto start=Clock::now();auto schedule=start;
  for(int i=0;i<frames+10;i++){auto tick=Clock::now();f.frame=i;int ready=cook(sketch,&f,&stats,error,sizeof(error));if(!ready||*error)throw std::runtime_error(error);if(syphon&&(ready!=2||stats.readbackMs!=0))throw std::runtime_error("Unexpected readback in Syphon-only output");if(i==10)start=Clock::now();if(i>=10){total.push_back(stats.totalMs);draw.push_back(stats.drawMs);readback.push_back(stats.readbackMs);}std::this_thread::sleep_until(schedule+std::chrono::microseconds(16667LL*(i+1)));}
  double seconds=std::chrono::duration<double>(Clock::now()-start).count();auto mean=[](std::vector<double> v){double total=0;for(double n:v)total+=n;return total/v.size();};auto p95=[](std::vector<double> v){std::sort(v.begin(),v.end());return v[size_t(v.size()*.95)];};
  printf("{\"mode\":\"%s\",\"frames\":%d,\"fps\":%.3f,\"runtimeMeanMs\":%.3f,\"runtimeP95Ms\":%.3f,\"drawMeanMs\":%.3f,\"readbackMeanMs\":%.3f}\n",argv[3],frames,frames/seconds,mean(total),p95(total),mean(draw),mean(readback));destroy(sketch);dlclose(lib);return 0;
}catch(const std::exception& e){fprintf(stderr,"%s\n",e.what());return 1;}}
