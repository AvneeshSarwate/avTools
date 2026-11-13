// Tests whether different existing AVSketch workers can overlap when the caller
// submits concurrently. This is NOT the scheduling used by the current TD TOP.
#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <stdexcept>
#include <string>
#include <vector>
using Clock=std::chrono::steady_clock;
static double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
static double mean(const std::vector<double>& v){double total=0;for(double x:v)total+=x;return total/v.size();}
static double p95(std::vector<double> v){std::sort(v.begin(),v.end());return v[size_t(v.size()*.95)];}
int main(int argc,char** argv){try{
  if(argc<3)throw std::runtime_error("bridge-concurrency runtime.dylib Resources [instances=8] [frames=150]");
  const int count=argc>3?atoi(argv[3]):8,frames=argc>4?atoi(argv[4]):150;
  if(count<1||count>16||frames<1)throw std::runtime_error("Invalid counts");
  void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
  auto create=reinterpret_cast<decltype(&avCreate)>(dlsym(lib,"avCreate"));
  auto cook=reinterpret_cast<decltype(&avCook)>(dlsym(lib,"avCook"));
  auto destroy=reinterpret_cast<decltype(&avDestroy)>(dlsym(lib,"avDestroy"));
  if(!create||!cook||!destroy)throw std::runtime_error("Missing bridge exports");
  std::vector<AVSketch*> sketches;
  std::vector<std::vector<uint8_t>> pixels(count,std::vector<uint8_t>(1920*1080*4));
  std::vector<AVFrame> inputs(count);
  std::vector<AVStats> stats(count);
  for(int i=0;i<count;i++){
    char error[8192]{};AVSketch* sketch=create(argv[2],error,sizeof(error));if(!sketch)throw std::runtime_error(error);sketches.push_back(sketch);
    auto& f=inputs[i];f.width=1920;f.height=1080;f.rate=60;f.output=pixels[i].data();f.outputSize=pixels[i].size();
    f.source="function setup(p){p.textSize(48);}function draw(p,f){p.background(f.frame%256,80,160);p.noStroke();p.fill(255);p.text('Dawn + Rust',100,100);p.circle(960+Math.sin(f.frame/20)*400,540,200);p.fill(f.frame%256,40,200);p.rect(0,0,16,16);}";
  }
  auto one=[&](int i){char error[8192]{};int ready=cook(sketches[i],&inputs[i],&stats[i],error,sizeof(error));if(ready!=1||*error)throw std::runtime_error(error);if(pixels[i][0]!=int(inputs[i].frame)%256||pixels[i][1]!=40||pixels[i][2]!=200||pixels[i][3]!=255)throw std::runtime_error("Stale/invalid frame");};
  for(bool parallel:{false,true}){
    std::vector<double> wall,workerSum,readbackSum;
    for(int frame=0;frame<frames+30;frame++){
      for(auto& f:inputs)f.frame=frame;
      auto start=Clock::now();
      if(parallel){std::vector<std::future<void>> jobs;for(int i=0;i<count;i++)jobs.push_back(std::async(std::launch::async,one,i));for(auto& j:jobs)j.get();}
      else for(int i=0;i<count;i++)one(i);
      double duration=elapsed(start),total=0,readback=0;for(auto& s:stats){total+=s.totalMs;readback+=s.readbackMs;}
      if(frame>=30){wall.push_back(duration);workerSum.push_back(total);readbackSum.push_back(readback);}
    }
    printf("{\"scheduling\":\"%s\",\"instances\":%d,\"frames\":%d,\"wallMeanMs\":%.6f,\"wallP95Ms\":%.6f,\"workerSumMeanMs\":%.6f,\"readbackSumMeanMs\":%.6f}\n",parallel?"concurrent":"serial",count,frames,mean(wall),p95(wall),mean(workerSum),mean(readbackSum));fflush(stdout);
  }
  for(auto* sketch:sketches)destroy(sketch);
  dlclose(lib);return 0;
}catch(const std::exception& e){fprintf(stderr,"%s\n",e.what());return 1;}}
