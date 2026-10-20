#include "Bridge.h"
#include "Runtime.h"
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <vector>
#include <deque>
#include <cmath>
using Clock=std::chrono::steady_clock;
static double ms(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
static std::string quoted(const std::string& value){std::string s="\"";for(unsigned char c:value){if(c=='"'||c=='\\'){s+='\\';s+=c;}else if(c<32){char b[7];snprintf(b,sizeof(b),"\\u%04x",c);s+=b;}else s+=c;}return s+'"';}
static void report(char* dest,size_t size,const std::string& value){if(dest&&size){std::memcpy(dest,value.data(),std::min(size-1,value.size()));dest[std::min(size-1,value.size())]=0;}}
struct AVSketch {
  std::mutex mutex;std::shared_ptr<avtools::Wake> wake=std::make_shared<avtools::Wake>();std::deque<std::function<void()>> jobs;bool stopping=false;
  std::condition_variable dispatchCV;std::function<void()> dispatchJob;bool dispatchBusy=false;std::thread dispatcher;
  std::unique_ptr<avtools::Runtime> runtime;std::string resources,error;bool poisoned=false,chop=false;uint64_t cooks=0;std::thread worker;
  explicit AVSketch(const char* root,bool cpuChannels=false):resources(root),chop(cpuChannels),worker([this]{loop();}){}
  ~AVSketch(){ {std::lock_guard lock(mutex);stopping=true;}wake->notify();dispatchCV.notify_one();if(dispatcher.joinable())dispatcher.join();worker.join(); }
  void loop(){
    for(;;){
      std::function<void()> next;
      {std::lock_guard lock(mutex);if(stopping&&jobs.empty())break;if(!jobs.empty()){next=std::move(jobs.front());jobs.pop_front();}}
      if(next)next();
      if(runtime&&!poisoned&&!runtime->pump(1000)){poisoned=true;error=runtime->error();}
      {std::lock_guard lock(mutex);if(stopping&&jobs.empty())break;if(!jobs.empty())continue;}
      wake->wait(runtime&&!poisoned?runtime->deadline():Clock::time_point::max());
    }
    dispose();
  }
  template<class F> void sync(F&& work){if(std::this_thread::get_id()==worker.get_id()){work();return;}std::packaged_task<void()> task(std::forward<F>(work));auto done=task.get_future();{std::lock_guard lock(mutex);if(stopping)throw std::runtime_error("Sketch stopped");jobs.emplace_back([&task]{task();});}wake->notify();done.get();}
  void eval(const std::string& text,int budget=100){if(!runtime->evaluate(text,budget)){poisoned=true;throw std::runtime_error(runtime->error());}}
  void wait(int timeout){
    const auto deadline=Clock::now()+std::chrono::milliseconds(timeout);
    while(runtime->value("__avDone")!="true"){
      if(Clock::now()>=deadline){poisoned=true;throw std::runtime_error("Async initialization/readback exceeded time budget; reset the operator");}
      if(!runtime->pump(1000)){poisoned=true;throw std::runtime_error(runtime->error());}
      if(runtime->value("__avDone")!="true")wake->wait(std::min(deadline,runtime->deadline()));
      {std::lock_guard lock(mutex);if(stopping)throw std::runtime_error("Sketch stopped");}
    }
  }
  void dispose(){
    if(!runtime)return;
    if(!runtime->poisoned()&&runtime->call("__avDispose",100)){
      auto deadline=Clock::now()+std::chrono::milliseconds(250);
      while(runtime->value("__avDone")!="true"&&Clock::now()<deadline){if(!runtime->pump(100))break;wake->wait(std::min(deadline,runtime->deadline()));}
    }
    runtime.reset();
  }
  void initialize(){
    dispose();
    // Deferred creation leaves the instance alive if initialization fails.
    // Keep it resettable even for failures before the renderer is installed.
    poisoned=true;runtime=std::make_unique<avtools::Runtime>(wake);
    if(chop){
      std::ifstream file(resources+"/chop.js");if(!file)throw std::runtime_error("Missing bundled chop.js");
      eval(std::string((std::istreambuf_iterator<char>(file)),{}),1000);poisoned=false;return;
    }
    std::vector<std::string> fonts;for(const auto& entry:std::filesystem::directory_iterator(resources+"/fonts")){auto ext=entry.path().extension().string();if(ext==".ttf"||ext==".otf"||ext==".woff"||ext==".woff2")fonts.push_back(entry.path().string());}std::sort(fonts.begin(),fonts.end());
    std::string json="[";for(const auto& font:fonts){if(json.size()>1)json+=',';json+=quoted(font);}json+=']';runtime->setString("__avFontsJSON",json);
    std::ifstream file(resources+"/renderer.js");if(!file)throw std::runtime_error("Missing bundled renderer.js");std::string source((std::istreambuf_iterator<char>(file)),{});
    eval(source,1000);wait(5000);auto failure=runtime->value("__avError");if(!failure.empty())throw std::runtime_error(failure);poisoned=false;
  }
  int cook(const AVFrame& f,AVStats& stats){
    if(!runtime)initialize();
    auto start=Clock::now();stats={};stats.cooks=++cooks;
    if(poisoned){if(!f.reset)throw std::runtime_error("Execution stopped after a timeout; pulse Reset");initialize();}
    if(!runtime->pump(1000)){poisoned=true;throw std::runtime_error(runtime->error());}
    runtime->setString("__avSource",f.source);
    runtime->setString("__avSyphonName",f.syphonName?f.syphonName:"");
    std::string pulses="[";for(uint32_t i=0;i<f.pulseCount;i++){if(i)pulses+=',';pulses+=quoted(f.pulses[i]);}pulses+=']';runtime->setString("__avPulsesJSON",pulses);
    std::ostringstream json;json.precision(17);json<<"{\"width\":"<<f.width<<",\"height\":"<<f.height<<",\"reset\":"<<f.reset<<",\"syphonOnly\":"<<f.syphonOnly<<",\"frame\":"<<f.frame<<",\"rate\":"<<f.rate<<",\"deltaSeconds\":"<<f.deltaSeconds<<",\"absFrame\":"<<f.absFrame<<",\"sampleRate\":"<<f.sampleRate<<",\"startIndex\":"<<f.startIndex<<"}";
    runtime->setString("__avFrameJSON",json.str());eval("__avInputs()");
    for(uint32_t i=0;i<f.channelCount;i++){const auto& c=f.channels[i];runtime->setBytes("__avData",c.samples,c.count*sizeof(float));eval("__avChannel("+quoted(c.name)+")");}
    for(uint32_t i=0;i<f.imageCount;i++){const auto& image=f.images[i];runtime->setBytes("__avData",image.pixels,size_t(image.width)*image.height*4);eval("__avImage("+std::to_string(i)+","+std::to_string(image.width)+","+std::to_string(image.height)+")");}
    eval("__avTrimImages("+std::to_string(f.imageCount)+");globalThis.__avData=null;globalThis.__avSubmitted=false");stats.inputMs=ms(start);
    if(!runtime->call("__avRender",1000)){poisoned=true;throw std::runtime_error(runtime->error());}wait(3000);stats.drawMs=std::stod(runtime->value("__avDrawMs"));stats.readbackMs=std::stod(runtime->value("__avReadbackMs"));
    stats.syphonClients=std::stoul(runtime->value("__avSyphonClients"));stats.syphonPublished=std::stoul(runtime->value("__avSyphonPublished"));stats.syphonDropped=std::stoul(runtime->value("__avSyphonDropped"));
    error=runtime->value("__avError");
    if(runtime->value("__avHasFrame")=="true"){
      // A rejected resize keeps the old frame in TD; do not interpret its rows as the requested size.
      if(!runtime->copyRows("__avBytes",f.output,f.outputSize,size_t(f.width)*4,((size_t(f.width)*4+255)/256)*256,f.height)){eval("__avUnmap()");throw std::runtime_error(runtime->error());}
      eval("__avUnmap()");stats.ready=1;
    }
    stats.totalMs=ms(start);if(stats.ready)return 1;
    if(runtime->value("__avRendered")=="true"){stats.ready=1;return 2;}return 0;
  }
  int cookChop(const AVChopFrame& f,AVStats& stats){
    if(!chop)throw std::runtime_error("Expected a CHOP runtime");
    auto start=Clock::now();stats={};stats.cooks=++cooks;
    if(!runtime)initialize();
    if(poisoned){if(!f.reset)throw std::runtime_error("Execution stopped after a timeout; pulse Reset");initialize();}
    runtime->setString("__avSource",f.source);
    std::ostringstream json;json.precision(17);
    json<<"{\"reset\":"<<f.reset<<",\"frame\":"<<f.frame<<",\"rate\":"<<f.rate<<",\"deltaSeconds\":"<<f.deltaSeconds<<",\"absFrame\":"<<f.absFrame<<",\"channels\":[";
    std::vector<float> samples;
    for(uint32_t i=0;i<f.channelCount;i++){
      const auto& c=f.channels[i];if(i)json<<',';
      json<<"{\"input\":"<<c.input<<",\"name\":"<<quoted(c.channel.name)<<",\"offset\":"<<samples.size()<<",\"count\":"<<c.channel.count<<'}';
      if(c.channel.count)samples.insert(samples.end(),c.channel.samples,c.channel.samples+c.channel.count);
    }
    json<<"],\"outputSamples\":"<<std::max(1u,f.outputSamples)<<",\"names\":[";for(uint32_t i=0;i<f.outputCount;i++){if(i)json<<',';json<<quoted(f.names[i]);}
    json<<"],\"pulses\":[";for(uint32_t i=0;i<f.pulseCount;i++){if(i)json<<',';json<<quoted(f.pulses[i]);}json<<"]}";
    runtime->setString("__avFrameJSON",json.str());runtime->setBytes("__avData",samples.data(),samples.size()*sizeof(float));
    // No pump between receiving the job and publishing its complete snapshot.
    if(!runtime->call("__avChopAccept",1000))throw std::runtime_error(runtime->error());
    stats.inputMs=ms(start);
    auto runStart=Clock::now();
    if(!runtime->call("__avChopCook",1000)){poisoned=true;throw std::runtime_error(runtime->error());}
    wait(3000);stats.drawMs=ms(runStart);error=runtime->value("__avError");
    if(runtime->value("__avHasFrame")=="true"){
      const size_t bytes=size_t(f.outputCount)*std::max(1u,f.outputSamples)*sizeof(float);
      if(!runtime->copyRows("__avBytes",f.output,bytes,bytes,bytes,1))throw std::runtime_error(runtime->error());
      stats.ready=1;
    }
    stats.totalMs=ms(start);return stats.ready;
  }
};
extern "C" AVSketch* avCreateDeferred(const char* resources,char* error,size_t size){
  try{
    if(!resources)throw std::runtime_error("Missing runtime resources path");
    // V8's shared platform is process-lived. Keep its code loaded even after every TOP is deleted.
    static void* pinned=[](){Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&avCreateDeferred),&info))return static_cast<void*>(nullptr);return dlopen(info.dli_fname,RTLD_NOW|RTLD_LOCAL|RTLD_NODELETE);}();
    if(!pinned)throw std::runtime_error("Unable to pin embedded runtime library");
    return new AVSketch(resources);
  }catch(const std::exception& e){report(error,size,e.what());return nullptr;}
}
extern "C" AVSketch* avCreate(const char* resources,char* error,size_t size){
  auto* sketch=avCreateDeferred(resources,error,size);if(!sketch)return nullptr;
  try{sketch->sync([&]{sketch->initialize();});return sketch;}
  catch(const std::exception& e){report(error,size,e.what());delete sketch;return nullptr;}
}
extern "C" int avDispatch(AVSketch* sketch,AVWork work,void* user){
  try{
    if(!sketch||!work)return 0;
    std::lock_guard lock(sketch->mutex);
    if(sketch->stopping||sketch->dispatchBusy)return 0;
    // The TD input download API may block. Keep its preparation callback off
    // the V8 owner so independent timers continue even during an input fence.
    if(!sketch->dispatcher.joinable())sketch->dispatcher=std::thread([sketch]{
      for(;;){std::function<void()> next;
        {std::unique_lock lock(sketch->mutex);sketch->dispatchCV.wait(lock,[&]{return sketch->stopping||bool(sketch->dispatchJob);});if(!sketch->dispatchJob)break;next=std::move(sketch->dispatchJob);sketch->dispatchJob=nullptr;}
        next();
        {std::lock_guard lock(sketch->mutex);sketch->dispatchBusy=false;}
      }
    });
    sketch->dispatchBusy=true;sketch->dispatchJob=[=]{work(sketch,user);};sketch->dispatchCV.notify_one();return 1;
  }catch(...){return 0;} // Never unwind across the host's different C++ ABI.
}
extern "C" int avCook(AVSketch* sketch,const AVFrame* frame,AVStats* stats,char* error,size_t size){
  try{
    if(!sketch||!frame||!stats||!frame->source||!frame->output||frame->width<1||frame->height<1||frame->width>4096||frame->height>4096||frame->outputSize<(frame->syphonOnly?4:size_t(frame->width)*frame->height*4)||frame->imageCount>4||frame->pulseCount>256)throw std::runtime_error("Invalid sketch frame");
    for(uint32_t i=0;i<frame->imageCount;i++){auto& image=frame->images[i];if(!image.pixels||!image.width||!image.height||image.width>8192||image.height>8192||image.size<size_t(image.width)*image.height*4)throw std::runtime_error("Invalid input image");}
    int result=0;sketch->sync([&]{result=sketch->cook(*frame,*stats);});report(error,size,sketch->error);return result;
  }catch(const std::exception& e){report(error,size,e.what());return 0;}
}
extern "C" void avDestroy(AVSketch* sketch){delete sketch;}
extern "C" AVSketch* avChopCreate(const char* resources,char* error,size_t size){
  // Reuse the existing library pinning and owner-thread lifecycle.
  auto* sketch=avCreateDeferred(resources,error,size);if(sketch)sketch->chop=true;return sketch;
}
extern "C" int avChopCook(AVSketch* sketch,const AVChopFrame* f,AVStats* stats,char* error,size_t size){
  try{
    if(!sketch||!f||!stats||!f->source||!f->output||!f->names||!f->outputCount||f->outputCount>1024||size_t(f->outputCount)*std::max(1u,f->outputSamples)>1048576||f->channelCount>4096||f->pulseCount>256||(f->channelCount&&!f->channels)||(f->pulseCount&&!f->pulses)||!std::isfinite(f->frame)||!std::isfinite(f->absFrame)||!std::isfinite(f->rate)||f->rate<=0||!std::isfinite(f->deltaSeconds))throw std::runtime_error("Invalid CHOP frame");
    size_t count=0;
    for(uint32_t i=0;i<f->channelCount;i++){const auto& c=f->channels[i];count+=c.channel.count;if(c.input>=4||!c.channel.name||(c.channel.count&&!c.channel.samples)||count>1048576)throw std::runtime_error("Invalid/oversized CHOP inputs (maximum 1M samples)");}
    for(uint32_t i=0;i<f->outputCount;i++)if(!f->names[i])throw std::runtime_error("Missing output channel name");
    for(uint32_t i=0;i<f->pulseCount;i++)if(!f->pulses[i])throw std::runtime_error("Missing pulse name");
    int result=0;sketch->sync([&]{result=sketch->cookChop(*f,*stats);});report(error,size,sketch->error);return result;
  }catch(const std::exception& e){report(error,size,e.what());return 0;}
}
