#include "Runtime.h"
#include "LogFormat.h"
#include "src/dawn/node/interop/Environment.h"
#include "Polyfills.h"
#include "src/dawn/node/interop/NodeAPI.h"
#include <libplatform/libplatform.h>
#include <chrono>
#include <condition_variable>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <vector>
#include <cstring>
#include <map>
#include <deque>
#include <unordered_set>
#include <cmath>
#include <algorithm>
#include <Security/SecRandom.h>
Napi::Object Initialize(Napi::Env, Napi::Object);
napi_value InitializeAvToolsText(napi_env, napi_value);
void InitializeSyphon(Napi::Env, Napi::Object);
namespace avtools {
namespace {
v8::Local<v8::String> str(v8::Isolate* i, const char* s) { return v8::String::NewFromUtf8(i,s).ToLocalChecked(); }
void now(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count());
}
void read(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate=args.GetIsolate();
  if(args.Length()!=1 || !args[0]->IsString()) { isolate->ThrowException(v8::Exception::TypeError(str(isolate,"readFile requires a path"))); return; }
  v8::String::Utf8Value name(isolate,args[0]); std::ifstream file(*name,std::ios::binary|std::ios::ate);
  if(!file) { isolate->ThrowException(v8::Exception::Error(str(isolate,"Unable to read asset"))); return; }
  auto size=file.tellg();
  if(size<0 || size>256*1024*1024) { isolate->ThrowException(v8::Exception::RangeError(str(isolate,"Asset exceeds 256 MiB"))); return; }
  auto buffer=v8::ArrayBuffer::New(isolate,static_cast<size_t>(size)); file.seekg(0);
  file.read(static_cast<char*>(buffer->GetBackingStore()->Data()),size);
  if(!file) { isolate->ThrowException(v8::Exception::Error(str(isolate,"Asset read failed"))); return; }
  args.GetReturnValue().Set(v8::Uint8Array::New(buffer,0,size));
}
}
struct Runtime::State {
  struct Task {
    uint64_t id=0,generation=0;
    Clock::time_point due;
    bool immediate=false;
    v8::Global<v8::Function> function;
    std::vector<v8::Global<v8::Value>> args;
  };
  struct Rejection {v8::Global<v8::Promise> promise;v8::Global<v8::Value> reason;uint64_t generation;};
  static void log(const v8::FunctionCallbackInfo<v8::Value>& args){
    auto& runtime=*get(args.GetIsolate()).runtime;
    int severity=args.Data().As<v8::Int32>()->Value();
    if(runtime.logs_&&!runtime.logs_->enabled(severity))return;
    LogFormat formatter(args.GetIsolate());auto line=formatter.format(args,0);
    if(runtime.logs_)runtime.logs_->capture(severity,runtime.logGeneration_,line,formatter.truncated);
    else fprintf(stderr,"%s\n",line.c_str()); // Standalone Runtime fallback only.
  }
  Runtime* runtime;
  v8::Isolate* isolate;
  Clock::time_point start=Clock::now();
  uint64_t nextId=0,nextGeneration=0,timerCalls=0,immediateCalls=0,foregroundCalls=0;
  std::map<uint64_t,std::unique_ptr<Task>> tasks;
  std::map<std::pair<Clock::time_point,uint64_t>,uint64_t> timers;
  std::deque<uint64_t> immediates;
  std::unordered_set<uint64_t> active;
  bool dead(uint64_t gen)const{return gen!=0&&!active.count(gen);}
  bool unhandled=false;
  std::vector<Rejection> rejections;
  std::map<std::string,v8::Global<v8::Function>> functions;
  static State& get(v8::Isolate* i){return *static_cast<State*>(i->GetData(0));}
  uint64_t generation(){auto data=isolate->GetContinuationPreservedEmbedderDataV2();return data->IsValue()&&data.As<v8::Value>()->IsNumber()?uint64_t(data.As<v8::Value>().As<v8::Number>()->Value()):0;}
  void generation(uint64_t id){isolate->SetContinuationPreservedEmbedderDataV2(v8::Number::New(isolate,double(id)));}
  void cancel(uint64_t id){auto it=tasks.find(id);if(it==tasks.end())return;auto& t=*it->second;if(!t.immediate)timers.erase({t.due,id});tasks.erase(it);}
  void invalidate(uint64_t gen){active.erase(gen);for(auto it=tasks.begin();it!=tasks.end();){auto id=it++->first;if(tasks.at(id)->generation==gen)cancel(id);}std::erase_if(immediates,[&](uint64_t id){return !tasks.count(id);});}
  static void schedule(const v8::FunctionCallbackInfo<v8::Value>& a){
    auto& s=get(a.GetIsolate());auto* i=s.isolate;auto c=i->GetCurrentContext();
    if(!a.Length()||!a[0]->IsFunction()){i->ThrowException(v8::Exception::TypeError(str(i,"Timer callback must be callable")));return;}
    bool immediate=a.Data()->BooleanValue(i);int first=immediate?1:2;
    double delay=0;if(!immediate){if(a.Length()>1){auto converted=a[1]->NumberValue(c);if(converted.IsNothing())return;delay=converted.FromJust();}else delay=1;if(i->IsExecutionTerminating())return;if(!std::isfinite(delay)||delay<1||delay>2147483647)delay=1;delay=std::trunc(delay);}
    auto t=std::make_unique<Task>();t->id=++s.nextId;t->generation=s.generation();t->immediate=immediate;
    a.GetReturnValue().Set(double(t->id));if(s.dead(t->generation))return;
    t->due=Clock::now()+std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double,std::milli>(delay));
    t->function.Reset(i,a[0].As<v8::Function>());for(int n=first;n<a.Length();n++)t->args.emplace_back(i,a[n]);
    if(immediate)s.immediates.push_back(t->id);else s.timers.emplace(std::make_pair(t->due,t->id),t->id);
    s.tasks.emplace(t->id,std::move(t));s.runtime->wake_->notify();
  }
  static void nativeImmediate(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());auto prior=s.generation();s.generation(0);schedule(a);s.generation(prior);}
  static void clear(const v8::FunctionCallbackInfo<v8::Value>& a){if(a.Length()&&a[0]->IsNumber()){auto id=a[0].As<v8::Number>()->Value();if(std::isfinite(id)&&id>0&&id<=9007199254740991.0)get(a.GetIsolate()).cancel(uint64_t(id));}}
  static void runMicrotask(const v8::FunctionCallbackInfo<v8::Value>& a){
    auto& s=get(a.GetIsolate());auto c=s.isolate->GetCurrentContext();auto data=a.Data().As<v8::Array>();
    auto f=data->Get(c,0).ToLocalChecked().As<v8::Function>();auto gen=uint64_t(data->Get(c,1).ToLocalChecked().As<v8::Number>()->Value());
    v8::TryCatch catcher(s.isolate);v8::Local<v8::Value> result;
    if(!f->Call(c,c->Global(),0,nullptr).ToLocal(&result)&&!catcher.HasTerminated()){auto error=catcher.Exception();catcher.Reset();s.report(error,gen);}
  }
  static void microtask(const v8::FunctionCallbackInfo<v8::Value>& a){
    auto* i=a.GetIsolate();if(!a.Length()||!a[0]->IsFunction()){i->ThrowException(v8::Exception::TypeError(str(i,"queueMicrotask requires a function")));return;}
    auto c=i->GetCurrentContext();auto data=v8::Array::New(i,2);data->Set(c,0,a[0]).Check();data->Set(c,1,v8::Number::New(i,double(get(i).generation()))).Check();
    i->EnqueueMicrotask(v8::Function::New(c,runMicrotask,data).ToLocalChecked());
  }
  static void monotonic(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());a.GetReturnValue().Set(std::chrono::duration<double,std::milli>(Clock::now()-s.start).count());}
  static void uuid(const v8::FunctionCallbackInfo<v8::Value>& a){unsigned char b[16];if(SecRandomCopyBytes(kSecRandomDefault,sizeof(b),b)!=errSecSuccess){a.GetIsolate()->ThrowException(v8::Exception::Error(str(a.GetIsolate(),"OS entropy unavailable")));return;}b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;char out[37];snprintf(out,sizeof(out),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);a.GetReturnValue().Set(str(a.GetIsolate(),out));}
  static void registerGeneration(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());auto id=++s.nextGeneration;s.active.insert(id);a.GetReturnValue().Set(double(id));}
  static void setGeneration(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());auto prior=s.generation();if(a.Length()&&a[0]->IsNumber())s.generation(uint64_t(a[0].As<v8::Number>()->Value()));a.GetReturnValue().Set(double(prior));}
  static void invalidateGeneration(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());if(a.Length()&&a[0]->IsNumber())s.invalidate(uint64_t(a[0].As<v8::Number>()->Value()));}
  static void alive(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());a.GetReturnValue().Set(!s.dead(s.generation()));}
  static void stats(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());auto c=s.isolate->GetCurrentContext();auto o=v8::Object::New(s.isolate);
    auto put=[&](const char* key,double value){o->Set(c,str(s.isolate,key),v8::Number::New(s.isolate,value)).Check();};
    put("tasks",s.tasks.size());put("generations",s.active.size());put("timerCallbacks",s.timerCalls);put("immediateCallbacks",s.immediateCalls);put("foregroundCallbacks",s.foregroundCalls);
    {std::lock_guard lock(s.runtime->wake_->mutex);put("waits",s.runtime->wake_->waits);}
    v8::HeapStatistics heap;s.isolate->GetHeapStatistics(&heap);put("heapUsed",heap.used_heap_size());a.GetReturnValue().Set(o);
  }
  static void waitBudget(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());auto remaining=std::chrono::duration<double,std::milli>(s.runtime->deadline()-Clock::now()).count();a.GetReturnValue().Set(std::clamp(remaining,0.0,100.0));}
  static void reject(v8::PromiseRejectMessage message){
    auto& s=get(v8::Isolate::GetCurrent());
    if(message.GetEvent()==v8::kPromiseRejectWithNoHandler)s.rejections.push_back({v8::Global<v8::Promise>(s.isolate,message.GetPromise()),v8::Global<v8::Value>(s.isolate,message.GetValue()),s.generation()});
    else if(message.GetEvent()==v8::kPromiseHandlerAddedAfterReject)std::erase_if(s.rejections,[&](auto& r){return r.promise.Get(s.isolate)==message.GetPromise();});
  }
  void report(v8::Local<v8::Value> error,uint64_t gen){
    auto c=isolate->GetCurrentContext();v8::Local<v8::Value> handler;
    if(c->Global()->Get(c,str(isolate,"__hostError")).ToLocal(&handler)&&handler->IsFunction()){
      v8::Local<v8::Value> args[]={error,v8::Number::New(isolate,double(gen))};v8::Local<v8::Value> ignored;handler.As<v8::Function>()->Call(c,c->Global(),2,args).ToLocal(&ignored);
    }else {v8::String::Utf8Value text(isolate,error);runtime->error_=*text?*text:"Uncaught host task error";unhandled=true;}
  }
  static void reportError(const v8::FunctionCallbackInfo<v8::Value>& a){auto& s=get(a.GetIsolate());if(a.Length())s.report(a[0],s.generation());}
  static void uncaught(v8::Local<v8::Message> message,v8::Local<v8::Value> error){auto& s=get(v8::Isolate::GetCurrent());s.report(error,s.generation());}
  void flushRejections(){auto pending=std::move(rejections);rejections.clear();for(auto& r:pending){if(r.promise.Get(isolate)->HasHandler())continue;auto c=isolate->GetCurrentContext();v8::Local<v8::Value> handler;bool suppressed=false;
    if(c->Global()->Get(c,str(isolate,"__hostRejection")).ToLocal(&handler)&&handler->IsFunction()){v8::Local<v8::Value> args[]={r.reason.Get(isolate),r.promise.Get(isolate)};v8::Local<v8::Value> result;if(handler.As<v8::Function>()->Call(c,c->Global(),2,args).ToLocal(&result))suppressed=result->BooleanValue(isolate);}
    if(!suppressed)report(r.reason.Get(isolate),r.generation);
  }}
};
Runtime::Runtime(std::shared_ptr<Wake> wake,std::shared_ptr<LogSink> logs,uint64_t logGeneration):logs_(std::move(logs)),logGeneration_(logGeneration),wake_(std::move(wake)) {
  hostPlatform(); allocator_.reset(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
  v8::Isolate::CreateParams params; params.array_buffer_allocator=allocator_.get();
  isolate_=v8::Isolate::Allocate(); foreground_=attachForeground(isolate_,wake_);v8::Isolate::Initialize(isolate_,params);
  isolate_->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);
  state_=std::make_unique<State>();state_->runtime=this;state_->isolate=isolate_;isolate_->SetData(0,state_.get());
  watchdog_=std::make_unique<Watchdog>(isolate_);
  isolate_->SetPromiseRejectCallback(State::reject);
  isolate_->SetCaptureStackTraceForUncaughtExceptions(true,8);
  v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_);
  isolate_->AddMessageListener(State::uncaught);
  auto context=v8::Context::New(isolate_); context_.Reset(isolate_,context); v8::Context::Scope current(context);
  context->Global()->Set(context,str(isolate_,"hostNow"),v8::Function::New(context,now).ToLocalChecked()).Check();
  auto console=v8::Object::New(isolate_);
  const char* methods[]={"debug","log","warn","error","info"};
  for(int n=0;n<5;n++)console->Set(context,str(isolate_,methods[n]),v8::Function::New(context,State::log,v8::Int32::New(isolate_,n==4?1:n)).ToLocalChecked()).Check();
  context->Global()->Set(context,str(isolate_,"console"),console).Check();
  context->Global()->Set(context,str(isolate_,"readFile"),v8::Function::New(context,read).ToLocalChecked()).Check();
  auto bind=[&](const char* name,v8::FunctionCallback callback,bool data=false){context->Global()->Set(context,str(isolate_,name),v8::Function::New(context,callback,v8::Boolean::New(isolate_,data)).ToLocalChecked()).Check();};
  bind("__avNativeImmediate",State::nativeImmediate,true);bind("setTimeout",State::schedule);bind("setImmediate",State::schedule,true);
  bind("clearTimeout",State::clear);bind("clearImmediate",State::clear);bind("queueMicrotask",State::microtask);
  bind("__hostStats",State::stats);bind("__hostReportError",State::reportError);bind("__hostNow",State::monotonic);bind("__hostUUID",State::uuid);bind("__hostGeneration",State::setGeneration);
  bind("__hostRegister",State::registerGeneration);bind("__hostInvalidate",State::invalidateGeneration);bind("__hostAlive",State::alive);bind("__avNativeWaitBudget",State::waitBudget);
  if (!evaluate(kPolyfills)) throw std::runtime_error(error_);
  env_=dawn::napi_v8::CreateEnv(isolate_,context);
  auto exports=Initialize(Napi::Env(env_),Napi::Object::New(env_));
  InitializeSyphon(Napi::Env(env_),exports);
  context->Global()->Set(context,str(isolate_,"nativeGPU"),dawn::napi_v8::ToV8(exports)).Check();
  auto text = Napi::Object::New(env_);
  InitializeAvToolsText(env_, text);
  context->Global()->Set(context,str(isolate_,"nativeText"),dawn::napi_v8::ToV8(text)).Check();
}
Runtime::~Runtime() {
  owner();
  { v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto context=context_.Get(isolate_); v8::Context::Scope current(context);
    watchdog_.reset();wgpu::interop::RetireEnvironment(env_);dawn::napi_v8::DestroyEnv(env_);state_.reset(); context_.Reset(); }
  foreground_->close();isolate_->Dispose();detachForeground(isolate_);
}
void Runtime::owner() const { if(std::this_thread::get_id()!=owner_) std::terminate(); }
bool Runtime::caught(v8::TryCatch& catcher) {
  if(catcher.HasTerminated()) { poisoned_=true; error_="JavaScript execution budget exceeded; reset the sketch"; isolate_->CancelTerminateExecution(); return false; }
  if(catcher.HasCaught()) { v8::Local<v8::Value> detail;
    if(!catcher.StackTrace(context_.Get(isolate_)).ToLocal(&detail) || !detail->IsString()) detail=catcher.Exception();
    v8::String::Utf8Value text(isolate_,detail); error_=*text?*text:"JavaScript exception"; return false; }
  return true;
}
bool Runtime::finish(v8::TryCatch& catcher) {
  bool expired=watchdog_->disarm();
  if(expired){poisoned_=true;error_="JavaScript execution budget exceeded; reset the sketch";isolate_->CancelTerminateExecution();return false;}
  return caught(catcher)&&!state_->unhandled;
}
bool Runtime::evaluate(const std::string& source,int budgetMs) {
  owner();if(poisoned_)return false;
  v8::Isolate::Scope scope(isolate_);v8::HandleScope handles(isolate_);auto context=context_.Get(isolate_);v8::Context::Scope current(context);v8::TryCatch catcher(isolate_);watchdog_->arm(budgetMs);
  v8::Local<v8::Script> script;v8::Local<v8::Value> result;
  bool success=v8::Script::Compile(context,str(isolate_,source.c_str())).ToLocal(&script)&&script->Run(context).ToLocal(&result);
  if(success){isolate_->PerformMicrotaskCheckpoint();state_->flushRejections();}
  return finish(catcher)&&success;
}
bool Runtime::call(const char* name,int budgetMs){
  owner();if(poisoned_)return false;
  v8::Isolate::Scope scope(isolate_);v8::HandleScope handles(isolate_);auto c=context_.Get(isolate_);v8::Context::Scope current(c);v8::TryCatch catcher(isolate_);watchdog_->arm(budgetMs);
  auto& cached=state_->functions[name];if(cached.IsEmpty()){v8::Local<v8::Value> f;if(c->Global()->Get(c,str(isolate_,name)).ToLocal(&f)&&f->IsFunction())cached.Reset(isolate_,f.As<v8::Function>());}
  v8::Local<v8::Value> result;bool ok=!cached.IsEmpty()&&cached.Get(isolate_)->Call(c,c->Global(),0,nullptr).ToLocal(&result);
  if(ok){isolate_->PerformMicrotaskCheckpoint();state_->flushRejections();}return finish(catcher)&&ok;
}
Clock::time_point Runtime::deadline(){
  owner();if(poisoned_)return Clock::time_point::max();
  while(!state_->immediates.empty()&&!state_->tasks.count(state_->immediates.front()))state_->immediates.pop_front();
  if(!state_->immediates.empty())return Clock::now();
  auto due=foreground_->deadline();if(!state_->timers.empty())due=std::min(due,state_->timers.begin()->first.first);return due;
}
size_t Runtime::taskCount() const{return state_->tasks.size();}
bool Runtime::pump(int budgetMs) {
  owner();if(poisoned_)return false;
  v8::Isolate::Scope scope(isolate_);v8::HandleScope handles(isolate_);auto c=context_.Get(isolate_);v8::Context::Scope current(c);
  // A bounded round services each source; new immediates belong to the next
  // round. Each callback gets its own complete microtask checkpoint.
  const auto boundary=state_->nextId;const auto roundStart=Clock::now();
  for(unsigned round=0;round<64;round++){
    bool worked=false;
    auto invoke=[&](std::unique_ptr<State::Task> t){
      if(state_->dead(t->generation))return true;
      if(t->immediate)++state_->immediateCalls;else ++state_->timerCalls;
      v8::TryCatch catcher(isolate_);watchdog_->arm(budgetMs);auto prior=state_->generation();state_->generation(t->generation);
      std::vector<v8::Local<v8::Value>> args;for(auto& a:t->args)args.push_back(a.Get(isolate_));v8::Local<v8::Value> result;
      bool ok=t->function.Get(isolate_)->Call(c,c->Global(),args.size(),args.data()).ToLocal(&result);
      if(!ok&&!catcher.HasTerminated()){auto error=catcher.Exception();catcher.Reset();state_->report(error,t->generation);}
      isolate_->PerformMicrotaskCheckpoint();state_->flushRejections();state_->generation(prior);return finish(catcher);
    };
    if(!state_->timers.empty()&&state_->timers.begin()->first.first<=Clock::now()){
      auto id=state_->timers.begin()->second;state_->timers.erase(state_->timers.begin());auto t=std::move(state_->tasks.at(id));state_->tasks.erase(id);worked=true;if(!invoke(std::move(t)))return false;
    }
    while(!state_->immediates.empty()&&!state_->tasks.count(state_->immediates.front()))state_->immediates.pop_front();
    if(!state_->immediates.empty()&&state_->immediates.front()<=boundary){auto id=state_->immediates.front();state_->immediates.pop_front();auto t=std::move(state_->tasks.at(id));state_->tasks.erase(id);worked=true;if(!invoke(std::move(t)))return false;}
    if(auto task=foreground_->take()){++state_->foregroundCalls;worked=true;v8::TryCatch catcher(isolate_);watchdog_->arm(budgetMs);auto prior=state_->generation();state_->generation(0);task->Run();isolate_->PerformMicrotaskCheckpoint();state_->flushRejections();state_->generation(prior);if(!finish(catcher))return false;}
    if(!worked||Clock::now()-roundStart>=std::chrono::milliseconds(2))break;
  }
  std::erase_if(env_->callback_bindings,[](const auto& binding){return binding->liveness.IsEmpty();});
  std::erase_if(env_->references,[](const auto& ref){return !ref->is_userland_ref&&ref->handle.IsEmpty()&&!ref->finalize_cb;});
  return true;
}
void Runtime::collect() {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_);
  auto context=context_.Get(isolate_); v8::Context::Scope current(context);
  isolate_->LowMemoryNotification();
  std::erase_if(env_->callback_bindings, [](const auto& binding) { return binding->liveness.IsEmpty(); });
  std::erase_if(env_->references, [](const auto& ref) { return !ref->is_userland_ref && ref->handle.IsEmpty() && !ref->finalize_cb; });
}
std::string Runtime::value(const char* name) {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto context=context_.Get(isolate_); v8::Context::Scope current(context);
  v8::Local<v8::Value> result;
  if(!context->Global()->Get(context,str(isolate_,name)).ToLocal(&result)) return "";
  v8::String::Utf8Value text(isolate_,result); return *text?*text:"";
}
bool Runtime::setString(const char* name,const std::string& value) {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto c=context_.Get(isolate_); v8::Context::Scope current(c); v8::TryCatch catcher(isolate_);
  auto text=v8::String::NewFromUtf8(isolate_,value.data(),v8::NewStringType::kNormal,static_cast<int>(value.size())).ToLocalChecked();
  return c->Global()->CreateDataProperty(c,str(isolate_,name),text).FromMaybe(false) && caught(catcher);
}
bool Runtime::setBytes(const char* name,const void* data,size_t size) {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto c=context_.Get(isolate_); v8::Context::Scope current(c); v8::TryCatch catcher(isolate_);
  auto buffer=v8::ArrayBuffer::New(isolate_,size);
  if(size)std::memcpy(buffer->GetBackingStore()->Data(),data,size);
  return c->Global()->CreateDataProperty(c,str(isolate_,name),v8::Uint8Array::New(buffer,0,size)).FromMaybe(false) && caught(catcher);
}
bool Runtime::copyRows(const char* name,void* destination,size_t capacity,size_t rowBytes,size_t stride,size_t height) {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto c=context_.Get(isolate_); v8::Context::Scope current(c); v8::TryCatch catcher(isolate_);
  v8::Local<v8::Value> result;
  if(!c->Global()->Get(c,str(isolate_,name)).ToLocal(&result) || !result->IsUint8Array()) {error_="Missing mapped output bytes";return false;}
  auto view=result.As<v8::Uint8Array>();
  if(!height || stride<rowBytes || height>capacity/rowBytes || view->ByteLength()<stride*height) {error_="Invalid output buffer dimensions";return false;}
  auto backing=view->Buffer()->GetBackingStore();auto* source=static_cast<const char*>(backing->Data())+view->ByteOffset();
  for(size_t row=0;row<height;row++)std::memcpy(static_cast<char*>(destination)+row*rowBytes,source+row*stride,rowBytes);
  return true;
}

}
