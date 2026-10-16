#include "../../packages/native-webgpu/native/embedded/Bridge.h"
#include <dlfcn.h>
#include <fstream>
#include <iostream>
#include <vector>
#include <string>
#include <thread>
#include <chrono>
#include <stdexcept>
#include <filesystem>

int main(int argc,char** argv){try{
  if(argc<5)throw std::runtime_error("check runtime resources output-dir bundle...");
  void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
  auto create=(decltype(&avCreate))dlsym(lib,"avCreate");
  auto cook=(decltype(&avCook))dlsym(lib,"avCook");
  auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");
  if(!create||!cook||!destroy)throw std::runtime_error("Missing runtime bridge exports");
  std::vector<AVSketch*> instances;
  try {
    for(int i=4;i<argc;i++){
      char error[8192]{};auto* instance=create(argv[2],error,sizeof(error));
      if(!instance)throw std::runtime_error(error);instances.push_back(instance);
    }
    for(int i=4;i<argc;i++){
      std::ifstream file(argv[i]);if(!file)throw std::runtime_error("Cannot read bundle");
      std::string source((std::istreambuf_iterator<char>(file)),{});
      std::vector<uint8_t> pixels(320*180*4);char error[8192]{};AVStats stats{};AVFrame f{};
      f.width=320;f.height=180;f.rate=60;f.deltaSeconds=1.0/60;f.sampleRate=60;f.output=pixels.data();f.outputSize=pixels.size();
      float amount=40;AVChannel controls{"amount",&amount,1};f.channels=&controls;f.channelCount=1;
      const char* trigger="Trigger";
      for(int cycle=0;cycle<6;cycle++){
        auto changed=source+"\n// headless reload "+std::to_string(cycle);f.source=changed.c_str();
        for(int frame=0;frame<6;frame++){
          f.frame=f.absFrame=cycle*6+frame+1;f.pulses=&trigger;f.pulseCount=frame==3?1:0;
          if(!cook(instances[i-4],&f,&stats,error,sizeof(error))||*error)throw std::runtime_error(std::string(argv[i])+": "+error);
          std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
      }
      const auto name=std::filesystem::path(argv[i]).stem().string();
      std::ofstream image(std::filesystem::path(argv[3])/(name+".ppm"),std::ios::binary);image<<"P6\n320 180\n255\n";
      for(size_t pixel=0;pixel<pixels.size();pixel+=4)image.write((char*)&pixels[pixel],3);
      std::cout<<"PASS "<<name<<": 36 cooks, 6 reloads, pulses, CPU output; final cook "<<stats.totalMs<<" ms\n";
    }
  }catch(...){for(auto* instance:instances)destroy(instance);throw;}
  for(auto* instance:instances)destroy(instance);
  return 0;
}catch(const std::exception& error){std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}}
