// Narrow additions needed by the retained Rust text adapter. WebGPU bindings
// remain upstream Dawn/napi_v8; no Node runtime is embedded.
#include "src/dawn/node/napi_v8/napi_v8.h"
#include <cstdio>
#include <cstdlib>
using dawn::napi_v8::ToV8;
using dawn::napi_v8::ToNapi;
namespace {
v8::Local<v8::Private> tagKey(napi_env env) {
  return v8::Private::ForApi(env->isolate,v8::String::NewFromUtf8Literal(env->isolate,"avtools.native.typeTag"));
}
}
extern "C" {
napi_status napi_get_new_target(napi_env env,napi_callback_info info,napi_value* result) {
  if(!env||!info||!result)return napi_invalid_arg;
  *result=info->v8_info->IsConstructCall()?ToNapi(info->v8_info->NewTarget()):nullptr;return napi_ok;
}
napi_status napi_get_value_bigint_uint64(napi_env env,napi_value value,uint64_t* result,bool* lossless) {
  if(!env||!value||!result||!lossless)return napi_invalid_arg;
  auto v=ToV8(value);if(!v->IsBigInt())return napi_bigint_expected;
  *result=v.As<v8::BigInt>()->Uint64Value(lossless);return napi_ok;
}
napi_status napi_create_buffer(napi_env env,size_t length,void** data,napi_value* result) {
  if(!env||!result)return napi_invalid_arg;
  auto buffer=v8::ArrayBuffer::New(env->isolate,length);
  if(data)*data=buffer->GetBackingStore()->Data();
  *result=ToNapi(v8::Uint8Array::New(buffer,0,length));return napi_ok;
}
napi_status napi_create_buffer_copy(napi_env env,size_t length,const void* data,void** copied,napi_value* result) {
  if(length&&!data)return napi_invalid_arg;void* bytes=nullptr;
  auto status=napi_create_buffer(env,length,&bytes,result);if(status!=napi_ok)return status;
  if(length)memcpy(bytes,data,length);if(copied)*copied=bytes;return napi_ok;
}
napi_status napi_type_tag_object(napi_env env,napi_value value,const napi_type_tag* tag) {
  if(!env||!value||!tag)return napi_invalid_arg;
  auto v=ToV8(value);if(!v->IsObject())return napi_object_expected;
  auto obj=v.As<v8::Object>();auto context=env->GetContext();auto key=tagKey(env);
  if(obj->HasPrivate(context,key).FromMaybe(false))return napi_invalid_arg;
  uint64_t words[]={tag->lower,tag->upper};
  v8::Local<v8::BigInt> bits;if(!v8::BigInt::NewFromWords(context,0,2,words).ToLocal(&bits))return napi_generic_failure;
  return obj->SetPrivate(context,key,bits).FromMaybe(false)?napi_ok:napi_generic_failure;
}
napi_status napi_check_object_type_tag(napi_env env,napi_value value,const napi_type_tag* tag,bool* result) {
  if(!env||!value||!tag||!result)return napi_invalid_arg;*result=false;
  auto v=ToV8(value);if(!v->IsObject())return napi_object_expected;
  v8::Local<v8::Value> bits;if(!v.As<v8::Object>()->GetPrivate(env->GetContext(),tagKey(env)).ToLocal(&bits))return napi_generic_failure;
  if(!bits->IsBigInt())return napi_ok;int sign=0,count=2;uint64_t words[2]={0,0};bits.As<v8::BigInt>()->ToWordsArray(&sign,&count,words);
  *result=!sign&&words[0]==tag->lower&&words[1]==tag->upper;return napi_ok;
}
}

struct napi_escapable_handle_scope__ {
  v8::EscapableHandleScope scope;
  napi_env env;
  bool escaped=false;
  explicit napi_escapable_handle_scope__(napi_env e):scope(e->isolate),env(e){}
};
extern "C" {
// Node-API reserves this for unrecoverable native invariant violations. It is
// not exposed as a script API. Ordinary JS exceptions use napi_throw below.
void napi_fatal_error(const char* location,size_t locationLength,const char* message,size_t messageLength) {
  fprintf(stderr,"Native binding invariant failed at %.*s: %.*s\n",
    int(locationLength==NAPI_AUTO_LENGTH?strlen(location):locationLength),location,
    int(messageLength==NAPI_AUTO_LENGTH?strlen(message):messageLength),message);
  std::abort();
}
napi_status napi_throw_error(napi_env env,const char* code,const char* message) {
  if(!env||!message)return napi_invalid_arg;
  napi_value msg,error,codeValue=nullptr;
  napi_status status=napi_create_string_utf8(env,message,NAPI_AUTO_LENGTH,&msg);if(status!=napi_ok)return status;
  if(code){status=napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&codeValue);if(status!=napi_ok)return status;}
  status=napi_create_error(env,codeValue,msg,&error);return status==napi_ok?napi_throw(env,error):status;
}
napi_status napi_is_array(napi_env env,napi_value value,bool* result) {
  if(!env||!value||!result)return napi_invalid_arg;*result=ToV8(value)->IsArray();return napi_ok;
}
napi_status napi_instanceof(napi_env env,napi_value object,napi_value constructor,bool* result) {
  if(!env||!object||!constructor||!result)return napi_invalid_arg;
  if(!ToV8(constructor)->IsFunction())return napi_function_expected;
  auto answer=ToV8(object)->InstanceOf(env->GetContext(),ToV8(constructor).As<v8::Object>());
  if(answer.IsNothing())return napi_pending_exception;*result=answer.FromJust();return napi_ok;
}
napi_status napi_add_finalizer(napi_env env,napi_value object,void* data,node_api_nogc_finalize callback,void* hint,napi_ref* result) {
  if(!env||!object||!callback)return napi_invalid_arg;
  if(!ToV8(object)->IsObject())return napi_object_expected;
  auto ref=std::make_unique<napi_ref__>(env,ToV8(object),0,data,callback,hint,false,result!=nullptr);
  if(result)*result=ref.get();env->references.push_back(std::move(ref));return napi_ok;
}
napi_status napi_create_external(napi_env env,void* data,node_api_nogc_finalize callback,void* hint,napi_value* result) {
  if(!env||!result)return napi_invalid_arg;
  auto external=v8::External::New(env->isolate,data,v8::kExternalPointerTypeTagDefault);*result=ToNapi(external);
  if(callback)env->references.push_back(std::make_unique<napi_ref__>(env,external,0,data,callback,hint));
  return napi_ok;
}
napi_status napi_get_value_external(napi_env env,napi_value value,void** result) {
  if(!env||!value||!result)return napi_invalid_arg;if(!ToV8(value)->IsExternal())return napi_invalid_arg;
  *result=ToV8(value).As<v8::External>()->Value(v8::kExternalPointerTypeTagDefault);return napi_ok;
}
napi_status napi_open_escapable_handle_scope(napi_env env,napi_escapable_handle_scope* result) {
  if(!env||!result)return napi_invalid_arg;*result=new napi_escapable_handle_scope__(env);return napi_ok;
}
napi_status napi_close_escapable_handle_scope(napi_env env,napi_escapable_handle_scope scope) {
  if(!env||!scope||scope->env!=env)return napi_invalid_arg;delete scope;return napi_ok;
}
napi_status napi_escape_handle(napi_env env,napi_escapable_handle_scope scope,napi_value value,napi_value* result) {
  if(!env||!scope||scope->env!=env||!value||!result)return napi_invalid_arg;
  if(scope->escaped)return napi_escape_called_twice;scope->escaped=true;*result=ToNapi(scope->scope.Escape(ToV8(value)));return napi_ok;
}
}
