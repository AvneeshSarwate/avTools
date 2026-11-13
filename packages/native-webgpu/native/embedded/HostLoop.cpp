#include "HostLoop.h"
#include <unordered_map>
namespace avtools {
void Foreground::post(std::unique_ptr<v8::Task> task,double delay) {
  {std::lock_guard lock(mutex_); if(closed_)return;
   auto due=Clock::now()+std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(delay));
   tasks_.emplace(std::make_pair(due,++sequence_),std::move(task));}
  wake_->notify();
}
Clock::time_point Foreground::deadline(){std::lock_guard lock(mutex_);return tasks_.empty()?Clock::time_point::max():tasks_.begin()->first.first;}
std::unique_ptr<v8::Task> Foreground::take(){std::lock_guard lock(mutex_);if(tasks_.empty()||tasks_.begin()->first.first>Clock::now())return {};auto t=std::move(tasks_.begin()->second);tasks_.erase(tasks_.begin());return t;}
void Foreground::close(){std::lock_guard lock(mutex_);closed_=true;tasks_.clear();}
namespace {
// Delegate background jobs, clocks, allocation and tracing to V8's default
// platform; foreground work alone belongs to the isolate's sleeping owner.
class Platform final:public v8::Platform {
 public:
  std::unique_ptr<v8::Platform> base=v8::platform::NewDefaultPlatform();
  std::mutex mutex;
  std::unordered_map<v8::Isolate*,std::shared_ptr<Foreground>> runners;
  v8::PageAllocator* GetPageAllocator() override{return base->GetPageAllocator();}
  v8::ThreadIsolatedAllocator* GetThreadIsolatedAllocator() override{return base->GetThreadIsolatedAllocator();}
  int NumberOfWorkerThreads() override{return base->NumberOfWorkerThreads();}
  std::shared_ptr<v8::TaskRunner> GetForegroundTaskRunner(v8::Isolate* i,v8::TaskPriority) override {
    std::lock_guard lock(mutex);auto found=runners.find(i);
    if(found==runners.end()) {auto r=std::make_shared<Foreground>(std::make_shared<Wake>());runners.emplace(i,r);return r;}
    return found->second;
  }
  double MonotonicallyIncreasingTime() override{return base->MonotonicallyIncreasingTime();}
  double CurrentClockTimeMillis() override{return base->CurrentClockTimeMillis();}
  v8::TracingController* GetTracingController() override{return base->GetTracingController();}
  void PostTaskOnWorkerThreadImpl(v8::TaskPriority p,std::unique_ptr<v8::Task> t,const v8::SourceLocation& l) override{base->PostTaskOnWorkerThread(p,std::move(t),l);}
  void PostDelayedTaskOnWorkerThreadImpl(v8::TaskPriority p,std::unique_ptr<v8::Task> t,double d,const v8::SourceLocation& l) override{base->PostDelayedTaskOnWorkerThread(p,std::move(t),d,l);}
  std::unique_ptr<v8::JobHandle> CreateJobImpl(v8::TaskPriority p,std::unique_ptr<v8::JobTask> t,const v8::SourceLocation& l) override{return base->CreateJob(p,std::move(t),l);}
};
Platform* platform(){static auto* p=[] {v8::V8::InitializeICUDefaultLocation(nullptr);auto* p=new Platform;v8::V8::InitializePlatform(p);v8::V8::Initialize();return p;}();return p;}
}
v8::Platform* hostPlatform(){return platform();}
std::shared_ptr<Foreground> attachForeground(v8::Isolate* i,std::shared_ptr<Wake> wake){auto* p=platform();std::lock_guard lock(p->mutex);auto runner=std::make_shared<Foreground>(wake);p->runners[i]=runner;return runner;}
void detachForeground(v8::Isolate* i){auto* p=platform();std::lock_guard lock(p->mutex);auto it=p->runners.find(i);if(it!=p->runners.end()){it->second->close();p->runners.erase(it);}}
Watchdog::Watchdog(v8::Isolate* i):isolate_(i),thread_([this]{loop();}){}
Watchdog::~Watchdog(){{std::lock_guard lock(mutex_);stopping_=true;}cv_.notify_one();thread_.join();}
void Watchdog::arm(int ms){{std::lock_guard lock(mutex_);expired_=false;deadline_=Clock::now()+std::chrono::milliseconds(ms);++revision_;}cv_.notify_one();}
bool Watchdog::disarm(){std::lock_guard lock(mutex_);deadline_=Clock::time_point::max();++revision_;cv_.notify_one();return expired_;}
void Watchdog::loop(){std::unique_lock lock(mutex_);while(!stopping_){auto revision=revision_;if(!cv_.wait_until(lock,deadline_,[&]{return stopping_||revision_!=revision;})){expired_=true;deadline_=Clock::time_point::max();isolate_->TerminateExecution();}}}
}
