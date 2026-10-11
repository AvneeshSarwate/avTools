#include "Runtime.h"
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
Napi::Object Initialize(Napi::Env, Napi::Object);
napi_value InitializeAvToolsText(napi_env, napi_value);
void InitializeSyphon(Napi::Env, Napi::Object);
namespace avtools {
namespace {
// Deliberately process-lived: unloading one operator must not shut down V8
// underneath another. The plugin must remain loaded while this platform lives.
v8::Platform* platform() {
  static v8::Platform* instance = [] {
    v8::V8::InitializeICUDefaultLocation(nullptr);
    auto* p = v8::platform::NewDefaultPlatform().release();
    v8::V8::InitializePlatform(p); v8::V8::Initialize(); return p;
  }();
  return instance;
}
class Budget {
  std::mutex mutex; std::condition_variable condition; bool finished=false;
  bool expired_=false;
  std::thread watchdog;
 public:
  Budget(v8::Isolate* isolate, int ms) : watchdog([this,isolate,ms] {
    std::unique_lock lock(mutex);
    if (!condition.wait_for(lock,std::chrono::milliseconds(ms),[this]{return finished;})) { expired_=true; isolate->TerminateExecution(); }
  }) {}
  void finish() { { std::lock_guard lock(mutex); finished=true; } condition.notify_one(); if(watchdog.joinable())watchdog.join(); }
  bool expired() const { return expired_; }
  ~Budget() { finish(); }
};
v8::Local<v8::String> str(v8::Isolate* i, const char* s) { return v8::String::NewFromUtf8(i,s).ToLocalChecked(); }
void now(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count());
}
void log(const v8::FunctionCallbackInfo<v8::Value>& args) {
  for(int j=0;j<args.Length();j++) { v8::String::Utf8Value s(args.GetIsolate(),args[j]); fprintf(stderr,"%s%s",j?" ":"",*s?*s:""); } fprintf(stderr,"\n");
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
Runtime::Runtime() {
  platform(); allocator_.reset(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
  v8::Isolate::CreateParams params; params.array_buffer_allocator=allocator_.get();
  isolate_=v8::Isolate::New(params); isolate_->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);
  v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_);
  auto context=v8::Context::New(isolate_); context_.Reset(isolate_,context); v8::Context::Scope current(context);
  context->Global()->Set(context,str(isolate_,"hostNow"),v8::Function::New(context,now).ToLocalChecked()).Check();
  context->Global()->Set(context,str(isolate_,"hostLog"),v8::Function::New(context,log).ToLocalChecked()).Check();
  context->Global()->Set(context,str(isolate_,"readFile"),v8::Function::New(context,read).ToLocalChecked()).Check();
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
    dawn::napi_v8::DestroyEnv(env_); context_.Reset(); }
  isolate_->Dispose();
}
void Runtime::owner() const { if(std::this_thread::get_id()!=owner_) std::terminate(); }
bool Runtime::caught(v8::TryCatch& catcher) {
  if(catcher.HasTerminated()) { error_="JavaScript execution budget exceeded; reset the sketch"; isolate_->CancelTerminateExecution(); return false; }
  if(catcher.HasCaught()) { v8::Local<v8::Value> detail;
    if(!catcher.StackTrace(context_.Get(isolate_)).ToLocal(&detail) || !detail->IsString()) detail=catcher.Exception();
    v8::String::Utf8Value text(isolate_,detail); error_=*text?*text:"JavaScript exception"; return false; }
  return true;
}
bool Runtime::evaluate(const std::string& source,int budgetMs) {
  owner(); v8::Isolate::Scope scope(isolate_); v8::HandleScope handles(isolate_); auto context=context_.Get(isolate_); v8::Context::Scope current(context); v8::TryCatch catcher(isolate_); Budget budget(isolate_,budgetMs);
  v8::Local<v8::Script> script; v8::Local<v8::Value> result;
  bool success=v8::Script::Compile(context,str(isolate_,source.c_str())).ToLocal(&script) && script->Run(context).ToLocal(&result);
  if(success)isolate_->PerformMicrotaskCheckpoint();
  budget.finish();
  if(budget.expired()) { error_="JavaScript execution budget exceeded; reset the sketch"; isolate_->CancelTerminateExecution(); return false; }
  return caught(catcher) && success;
}
bool Runtime::pump(int budgetMs) {
  bool ok=evaluate("globalThis.__pump && __pump()",budgetMs);
  std::erase_if(env_->callback_bindings, [](const auto& binding) { return binding->liveness.IsEmpty(); });
  std::erase_if(env_->references, [](const auto& ref) { return !ref->is_userland_ref && ref->handle.IsEmpty() && !ref->finalize_cb; });
  return ok;
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
