#include "../../packages/native-webgpu/native/embedded/Bridge.h"
#include <dlfcn.h>
#include <fstream>
#include <sstream>
#include <iostream>
#include <vector>
#include <cmath>
#include <chrono>
#include <thread>
#include <stdexcept>
int main(int argc,char** argv){try{
  if(argc!=6)throw std::runtime_error("check-chop runtime resources bundle output-names samples");
  void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
  auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");
  if(!create||!cook||!destroy)throw std::runtime_error("Plugin has no CHOP API");
  std::ifstream file(argv[3]);if(!file)throw std::runtime_error("Cannot read bundle");std::string source((std::istreambuf_iterator<char>(file)),{});
  std::istringstream text(argv[4]);std::vector<std::string> names;std::string name;while(text>>name)names.push_back(name);
  std::vector<const char*> pointers;for(auto& s:names)pointers.push_back(s.c_str());uint32_t samples=std::stoul(argv[5]);std::vector<float> values(names.size()*samples);
  char error[8192]{};auto* instance=create(argv[2],error,sizeof(error));if(!instance)throw std::runtime_error(error);
  float value=.75f,target=1;AVChopChannel channels[]={{0,{"value",&value,1}},{0,{"target",&target,1}}};const char* pulse="Trigger";
  AVChopFrame f{};f.rate=60;f.channels=channels;f.channelCount=2;f.names=pointers.data();f.outputCount=uint32_t(names.size());f.outputSamples=samples;f.output=values.data();f.pulses=&pulse;
  for(int i=0;i<36;i++){f.source=source.c_str();f.reset=i%6==0;f.pulseCount=i%6==3;f.frame=f.absFrame=i;AVStats stats{};
    if(!cook(instance,&f,&stats,error,sizeof(error))||*error){destroy(instance);throw std::runtime_error(error);}
    for(float v:values)if(!std::isfinite(v))throw std::runtime_error("Nonfinite CHOP output");
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  destroy(instance);std::cout<<"PASS CHOP "<<argv[3]<<": 36 cooks, 6 resets, pulses; outputs:";for(size_t i=0;i<std::min(size_t(8),values.size());i++)std::cout<<' '<<values[i];std::cout<<" ("<<samples<<" samples/channel)";std::cout<<'\n';
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
