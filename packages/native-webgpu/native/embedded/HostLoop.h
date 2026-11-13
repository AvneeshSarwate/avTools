#pragma once
#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <v8.h>
#include <libplatform/libplatform.h>
namespace avtools {
using Clock = std::chrono::steady_clock;
// Also used by the TD command queue. A latched wake avoids losing a notification
// between examining the queues and entering the condition-variable wait.
struct Wake {
  std::mutex mutex;
  std::condition_variable cv;
  bool signalled = false;
  uint64_t waits=0;
  void notify() { { std::lock_guard lock(mutex); signalled=true; } cv.notify_one(); }
  void wait(Clock::time_point deadline) {
    std::unique_lock lock(mutex);++waits;
    cv.wait_until(lock,deadline,[this]{return signalled;}); signalled=false;
  }
};
class Foreground final : public v8::TaskRunner {
 public:
  explicit Foreground(std::shared_ptr<Wake> wake):wake_(wake){}
  bool IdleTasksEnabled() override { return false; }
  bool NonNestableTasksEnabled() const override { return true; }
  bool NonNestableDelayedTasksEnabled() const override { return true; }
  Clock::time_point deadline();
  std::unique_ptr<v8::Task> take();
  void close();
 private:
  void post(std::unique_ptr<v8::Task>,double);
  void PostTaskImpl(std::unique_ptr<v8::Task> t,const v8::SourceLocation&) override {post(std::move(t),0);}
  void PostNonNestableTaskImpl(std::unique_ptr<v8::Task> t,const v8::SourceLocation&) override {post(std::move(t),0);}
  void PostDelayedTaskImpl(std::unique_ptr<v8::Task> t,double delay,const v8::SourceLocation&) override {post(std::move(t),delay);}
  void PostNonNestableDelayedTaskImpl(std::unique_ptr<v8::Task> t,double delay,const v8::SourceLocation&) override {post(std::move(t),delay);}
  std::shared_ptr<Wake> wake_;
  std::mutex mutex_;
  std::map<std::pair<Clock::time_point,uint64_t>,std::unique_ptr<v8::Task>> tasks_;
  uint64_t sequence_=0;
  bool closed_=false;
};
v8::Platform* hostPlatform();
std::shared_ptr<Foreground> attachForeground(v8::Isolate*,std::shared_ptr<Wake>);
void detachForeground(v8::Isolate*);
// One sleeping watchdog for the lifetime of an isolate, never one per callback.
class Watchdog {
 public:
  explicit Watchdog(v8::Isolate*);
  ~Watchdog();
  void arm(int ms);
  bool disarm();
 private:
  void loop();
  v8::Isolate* isolate_;
  std::mutex mutex_;
  std::condition_variable cv_;
  Clock::time_point deadline_=Clock::time_point::max();
  bool stopping_=false,expired_=false;
  uint64_t revision_=0;
  std::thread thread_;
};
}
