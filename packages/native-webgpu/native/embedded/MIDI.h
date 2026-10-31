#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
extern "C" {
uint32_t midi_list_inputs(uint8_t*,uint32_t);
uint32_t midi_list_outputs(uint8_t*,uint32_t);
uint32_t av_midi_open_input(const uint8_t*,uint32_t,uint32_t,uint32_t,void(*)(uintptr_t,const uint8_t*,uint32_t),uintptr_t,uint8_t*,uint32_t);
void midi_close_input(uint32_t);
uint32_t midi_open_output(const uint8_t*,uint32_t);
void midi_close_output(uint32_t);
int32_t midi_send(uint32_t,const uint8_t*,uint32_t);
}
namespace avtools {
struct MIDIEvent { uint64_t id,generation; std::vector<uint8_t> bytes; };
// All handle operations are owner-thread-only. Only receive() crosses threads.
// Rust's embedded close is a callback barrier; no detached callback owns this.
class MIDI {
  struct Input {MIDI* owner;uint64_t id,generation;uint32_t native=0;};
  struct Output {uint64_t generation;uint32_t native;};
  std::map<uint64_t,std::unique_ptr<Input>> inputs;
  std::map<uint64_t,Output> outputs;
  mutable std::mutex mutex;
  std::deque<MIDIEvent> queue;
  size_t queuedBytes=0;
  uint64_t lost=0,batches=0;
  std::function<void()> wake;
  static uint32_t word(const uint8_t* p){uint32_t v;std::memcpy(&v,p,4);return v;}
  static void receive(uintptr_t context,const uint8_t* bytes,uint32_t size){
    auto& input=*reinterpret_cast<Input*>(context);auto& self=*input.owner;
    if(size<32)return;
    {std::lock_guard lock(self.mutex);
      self.lost+=uint64_t(word(bytes+16))+word(bytes+20);
      if(self.queue.size()>=128||self.queuedBytes+size>1024*1024){self.lost+=word(bytes+24);return;}
      self.queue.push_back({input.id,input.generation,{bytes,bytes+size}});self.queuedBytes+=size;++self.batches;
    }
    self.wake();
  }
 public:
  explicit MIDI(std::function<void()> notify):wake(std::move(notify)){}
  ~MIDI(){while(!inputs.empty())close(inputs.begin()->first);while(!outputs.empty())close(outputs.begin()->first);}
  static std::string ports(bool output){
    auto fn=output?midi_list_outputs:midi_list_inputs;
    for(int retry=0;retry<3;retry++){auto n=fn(nullptr,0);if(n>1024*1024)throw std::runtime_error("MIDI device list exceeds limit");std::string result(n,'\0');auto size=fn(reinterpret_cast<uint8_t*>(result.data()),n);if(size<=n){result.resize(size);return result;}}
    throw std::runtime_error("MIDI devices changed during enumeration; retry");
  }
  void open(uint64_t id,uint64_t gen,const std::string& port,unsigned rate,bool raw,bool output){
    if(inputs.size()+outputs.size()>=32||inputs.count(id)||outputs.count(id))throw std::runtime_error("MIDI connection limit (32) or duplicate id");
    if(port.empty()||port.size()>4096||port.find('\0')!=std::string::npos)throw std::runtime_error("Invalid MIDI device id");
    if(output){auto handle=midi_open_output(reinterpret_cast<const uint8_t*>(port.data()),port.size());if(!handle)throw std::runtime_error("Cannot open MIDI output: missing, disconnected, or unavailable device");outputs.emplace(id,Output{gen,handle});return;}
    if(rate<1||rate>1000)throw std::runtime_error("MIDI rateHz must be 1–1000");
    auto input=std::make_unique<Input>(Input{this,id,gen});char error[1024]{};
    input->native=av_midi_open_input(reinterpret_cast<const uint8_t*>(port.data()),port.size(),rate,raw?1:0,receive,reinterpret_cast<uintptr_t>(input.get()),reinterpret_cast<uint8_t*>(error),sizeof(error));
    if(!input->native)throw std::runtime_error(*error?error:"Cannot open MIDI input");inputs.emplace(id,std::move(input));
  }
  void close(uint64_t id){
    if(auto it=inputs.find(id);it!=inputs.end()){midi_close_input(it->second->native);inputs.erase(it);}
    if(auto it=outputs.find(id);it!=outputs.end()){midi_close_output(it->second.native);outputs.erase(it);}
    std::lock_guard lock(mutex);std::erase_if(queue,[&](const MIDIEvent& event){if(event.id!=id)return false;queuedBytes-=event.bytes.size();return true;});
  }
  void cancel(uint64_t gen){std::vector<uint64_t> ids;for(auto& [id,input]:inputs)if(input->generation==gen)ids.push_back(id);for(auto& [id,out]:outputs)if(out.generation==gen)ids.push_back(id);for(auto id:ids)close(id);}
  void send(uint64_t id,const uint8_t* bytes,size_t n){auto it=outputs.find(id);if(it==outputs.end())throw std::runtime_error("MIDI output is closed");if(n<1||n>65536||midi_send(it->second.native,bytes,n))throw std::runtime_error("MIDI send failed");}
  bool pending()const{std::lock_guard lock(mutex);return !queue.empty();}
  bool take(MIDIEvent& event){std::lock_guard lock(mutex);if(queue.empty())return false;event=std::move(queue.front());queue.pop_front();queuedBytes-=event.bytes.size();return true;}
  std::string stats()const{std::lock_guard lock(mutex);return "{\"droppedMessages\":"+std::to_string(lost)+",\"batches\":"+std::to_string(batches)+",\"queuedBatches\":"+std::to_string(queue.size())+",\"inputs\":"+std::to_string(inputs.size())+",\"outputs\":"+std::to_string(outputs.size())+"}";}
};
}
