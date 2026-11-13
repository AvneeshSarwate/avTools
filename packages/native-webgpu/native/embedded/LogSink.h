#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include "Bridge.h"

namespace avtools {
// Fixed storage, independent of the isolate. No V8 handles or execution lock.
// Capture can lose a NEW message under snapshot/clear contention; never waits.
class LogSink {
  using Clock = std::chrono::steady_clock;
  const Clock::time_point start_ = Clock::now();
  std::mutex mutex_;
  std::array<AVLogEntry,256> entries_{};
  size_t begin_=0, count_=0;
  uint64_t sequence_=0, evicted_=0, truncated_=0;
  std::atomic<uint64_t> dropped_{0};
 public:
  std::atomic<int> level{1};
  bool enabled(int severity) const { return severity >= level.load(std::memory_order_relaxed); }
  void capture(int severity,uint64_t generation,const std::string& message,bool truncated=false) {
    if(!enabled(severity))return;
    std::unique_lock lock(mutex_,std::try_to_lock);
    if(!lock){dropped_.fetch_add(1,std::memory_order_relaxed);return;}
    auto& entry=entries_[(begin_+count_)%entries_.size()];
    if(count_==entries_.size()){begin_=(begin_+1)%entries_.size();++evicted_;}else ++count_;
    entry.sequence=++sequence_;entry.generation=generation;entry.level=severity;
    entry.timeMs=std::chrono::duration<double,std::milli>(Clock::now()-start_).count();
    size_t bytes=std::min(message.size(),sizeof(entry.message)-1);
    if(bytes<message.size()){while(bytes && (static_cast<unsigned char>(message[bytes])&0xc0)==0x80)--bytes;truncated=true;}
    std::memcpy(entry.message,message.data(),bytes);entry.message[bytes]=0;
    if(truncated)++truncated_;
  }
  void clear(){std::lock_guard lock(mutex_);begin_=count_=0;evicted_=truncated_=0;dropped_.store(0);}
  void snapshot(AVLogSnapshot& out,bool entries=true){
    std::lock_guard lock(mutex_);out.count=uint32_t(count_);out.evicted=evicted_;out.truncated=truncated_;out.dropped=dropped_.load();
    if(entries)for(size_t i=0;i<count_;i++)out.entries[i]=entries_[(begin_+i)%entries_.size()];
  }
};
}
