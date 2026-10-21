#pragma once
// Native-only request/publication exchange. No V8 or TD pointers cross threads.
#include "Bridge.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <stdexcept>
#include <vector>

struct ChopRequest {
  AVChopFrame frame{};
  uint64_t id=0,generation=0,schema=0;
  double elapsed=0;
  std::chrono::steady_clock::time_point submitted;
  std::string source;
  std::vector<std::string> channelNames,names,events;
  std::vector<float> samples;
  std::vector<AVChopChannel> channels;
  std::vector<const char*> namePointers,eventPointers;
  std::shared_ptr<std::promise<bool>> waiter;
  explicit ChopRequest(const AVChopFrame& f):frame(f),submitted(std::chrono::steady_clock::now()),source(f.source){
    size_t total=0;for(uint32_t i=0;i<f.channelCount;i++)total+=f.channels[i].channel.count;
    samples.reserve(total);channelNames.reserve(f.channelCount);channels.reserve(f.channelCount);
    for(uint32_t i=0;i<f.channelCount;i++){
      const auto& c=f.channels[i];auto offset=samples.size();
      if(c.channel.count)samples.insert(samples.end(),c.channel.samples,c.channel.samples+c.channel.count);
      channelNames.emplace_back(c.channel.name);channels.push_back({c.input,{channelNames.back().c_str(),c.channel.count?samples.data()+offset:nullptr,c.channel.count}});
    }
    for(uint32_t i=0;i<f.outputCount;i++)names.emplace_back(f.names[i]);
    for(uint32_t i=0;i<f.pulseCount;i++)events.emplace_back(f.pulses[i]);
    frame.output=nullptr;frame.outputSamples=std::max(1u,f.outputSamples);
  }
  void bind(float* output){
    namePointers.clear();for(auto& n:names)namePointers.push_back(n.c_str());
    eventPointers.clear();for(auto& n:events)eventPointers.push_back(n.c_str());
    frame.source=source.c_str();frame.channels=channels.data();frame.names=namePointers.data();
    frame.pulses=eventPointers.data();frame.pulseCount=uint32_t(eventPointers.size());frame.output=output;
    frame.deltaSeconds=elapsed;
  }
};
struct ChopPublication {
  std::vector<float> values;
  uint64_t sequence=0,request=0,generation=0,schema=0;
  double frame=-1;
  std::chrono::steady_clock::time_point published,input;
  AVStats stats{};
};
struct ChopExchange {
  using Time=std::chrono::steady_clock;
  struct Event {uint64_t request,generation;std::string name;};
  std::mutex mutex;
  std::unique_ptr<ChopRequest> pending;
  std::deque<std::unique_ptr<ChopRequest>> controls;
  std::deque<Event> events;
  // Three permanent slots. Only pointer swaps occur under the exchange mutex.
  std::unique_ptr<ChopPublication> latest=std::make_unique<ChopPublication>();
  std::unique_ptr<ChopPublication> spare=std::make_unique<ChopPublication>(); // worker only
  std::unique_ptr<ChopPublication> retained=std::make_unique<ChopPublication>(); // caller only
  uint64_t submitted=0,accepted=0,completed=0,generation=0,schema=0,sequence=0,coalesced=0,overflows=0;
  bool busy=false;double workerMs=0;
  std::string source,lastError,callerError;
  std::vector<std::string> names;
  uint32_t sampleCount=0;
  double elapsed=0,lastAbs=0,lastRate=0;
  bool haveTime=false;
  uint64_t reused=0,sameRequest=0,lastConsumed=0;
  std::array<bool,120> repeatWindow{};size_t windowSize=0,windowIndex=0;
  AVChopDiagnostics cached{};
  // Caller serialization follows TD's per-instance cook contract. Concurrent
  // C API callers for one instance are unsupported, including destroy vs cook.
  uint64_t offer(std::unique_ptr<ChopRequest>& request){
    std::unique_ptr<ChopRequest> retired;
    auto& r=*request;
    const bool schemaChange=names!=r.names||sampleCount!=r.frame.outputSamples;
    const bool control=r.frame.reset||source!=r.source||schemaChange;
    std::string nextSource=control?r.source:std::string();
    std::vector<std::string> nextNames=schemaChange?r.names:std::vector<std::string>();
    std::lock_guard lock(mutex);
    if((control||r.waiter)&&controls.size()+(control&&pending?1:0)>=16)throw std::runtime_error("CHOP control queue full (16); retry Reset/Reload");
    if(events.size()+r.events.size()>256){++overflows;throw std::runtime_error("CHOP pulse queue full (256); request not accepted");}
    if(control){++generation;source.swap(nextSource);}
    if(schemaChange){++schema;names.swap(nextNames);sampleCount=r.frame.outputSamples;}
    // Accumulate TD elapsed time on EVERY offer, including replaced inputs.
    // absFrame is independent of looping/seekable timeline frame. Backwards
    // absolute time/rate changes establish a new anchor, never negative time.
    double delta=std::max(0.,r.frame.deltaSeconds);
    if(haveTime&&lastRate==r.frame.rate)delta=std::max(0.,(r.frame.absFrame-lastAbs)/r.frame.rate);
    elapsed+=delta;lastAbs=r.frame.absFrame;lastRate=r.frame.rate;haveTime=true;
    r.elapsed=elapsed;r.id=++submitted;r.generation=generation;r.schema=schema;
    for(auto& name:r.events)events.push_back({r.id,generation,std::move(name)});
    r.events.clear();
    cached.schema=schema;cached.submitted=submitted;cached.generation=generation;
    if(control||r.waiter){
      if(pending){if(control)controls.push_back(std::move(pending));else{retired=std::move(pending);++coalesced;}}
      controls.push_back(std::move(request));
    }else{if(pending)++coalesced;retired=std::move(pending);pending=std::move(request);}
    return submitted;
  }
  std::unique_ptr<ChopRequest> take(){
    std::lock_guard lock(mutex);std::unique_ptr<ChopRequest> r;
    if(!controls.empty()){r=std::move(controls.front());controls.pop_front();}else r=std::move(pending);
    if(r){
      while(!events.empty()&&events.front().request<=r->id){
        // Events before a reload belong to the previous generation. They are
        // delivered by its ordered control request (see offer barrier below).
        r->events.push_back(std::move(events.front().name));events.pop_front();
      }
      accepted=r->id;busy=true;
    }
    return r;
  }
  bool hasWork(){std::lock_guard lock(mutex);return pending||!controls.empty();}
  void publish(const ChopRequest& r,const AVStats& stats){
    spare->request=r.id;spare->generation=r.generation;spare->schema=r.schema;spare->frame=r.frame.absFrame;
    spare->input=r.submitted;spare->published=Time::now();spare->stats=stats;
    std::lock_guard lock(mutex);
    if(r.generation!=generation||r.schema!=schema)return;
    spare->sequence=++sequence;latest.swap(spare);
  }
  void finish(const ChopRequest& r,bool ok,const std::string& error,double duration){
    {std::lock_guard lock(mutex);completed=r.id;busy=false;workerMs=duration;if(r.generation==generation)lastError=error;}
    if(r.waiter)r.waiter->set_value(ok);
  }
  void timerBegin(){std::lock_guard lock(mutex);busy=true;}
  void timerEnd(double duration){std::lock_guard lock(mutex);busy=false;workerMs=duration;}
  void timerError(const std::string& error){std::lock_guard lock(mutex);lastError=error;}
  int collect(float* output,size_t count,uint64_t request,bool blocking,AVStats& stats,AVChopDiagnostics& d,std::string& error){
    const auto start=Time::now();
    {std::unique_lock lock(mutex,std::defer_lock);if(blocking)lock.lock();else lock.try_lock();
      if(lock.owns_lock()){
        if(latest->sequence>retained->sequence)latest.swap(retained);
        cached.submitted=submitted;cached.accepted=accepted;cached.completed=completed;
        cached.generation=generation;cached.schema=schema;cached.published=sequence;
        cached.coalesced=coalesced;cached.pulseDepth=uint32_t(events.size());cached.pulseOverflows=overflows;cached.busy=busy;cached.workerMs=workerMs;
        callerError=lastError;
      }
    }
    error=callerError;d=cached;d.blocking=blocking;
    const bool ready=retained->sequence&&retained->schema==cached.schema&&retained->values.size()==count;
    bool repeat=!ready||retained->sequence==lastConsumed;
    repeatWindow[windowIndex++%repeatWindow.size()]=repeat;windowSize=std::min(windowSize+1,repeatWindow.size());
    d.repeatedPercent=100.*std::count(repeatWindow.begin(),repeatWindow.begin()+windowSize,true)/windowSize;
    if(repeat)++reused;
    if(ready){
      std::copy(retained->values.begin(),retained->values.end(),output);stats=retained->stats;
      lastConsumed=retained->sequence;d.consumed=lastConsumed;d.sourceRequest=retained->request;d.sourceFrame=retained->frame;
      d.publicationAgeMs=std::chrono::duration<double,std::milli>(Time::now()-retained->published).count();
      d.inputAgeMs=std::chrono::duration<double,std::milli>(Time::now()-retained->input).count();
      if(!blocking&&retained->request==request)++sameRequest;
    }else{std::fill_n(output,count,0.f);d.sourceFrame=-1;d.publicationAgeMs=d.inputAgeMs=-1;}
    d.ready=ready;d.reused=reused;d.sameRequest=sameRequest;
    d.outputCopyMs=std::chrono::duration<double,std::milli>(Time::now()-start).count();
    return ready;
  }
};
