#pragma once
#include <v8.h>
#include <algorithm>
#include <array>
#include <cstring>
#include <string>
// Pinned V8: enumerate only a bounded prefix of fast own-property descriptors.
// The public GetOwnPropertyNames API allocates ALL keys, even for giant objects.
#include "src/api/api-inl.h"
#include "src/objects/js-objects-inl.h"
#include "src/objects/descriptor-array-inl.h"
#include "src/objects/string-inl.h"
#include "src/objects/dictionary-inl.h"
#include "src/objects/swiss-name-dictionary-inl.h"

namespace avtools {
class LogFormat {
  v8::Isolate* isolate_;
  v8::Local<v8::Context> context_;
  std::string out_;
  std::array<v8::Local<v8::Object>,4> ancestors_{};
  int visits_=0;
  static constexpr size_t limit=4096;
  void add(const std::string& s){
    auto n=std::min(s.size(),limit-out_.size());
    if(n<s.size()){truncated=true;while(n&&(static_cast<unsigned char>(s[n])&0xc0)==0x80)--n;}
    out_.append(s,0,n);
  }
  void string(v8::Local<v8::String> s){
    // V8 WriteUtf8 flattens the ENTIRE rope, even with a small byte capacity.
    // Walk a bounded prefix instead: <=128 nodes, <=4097 UTF-16 code units.
    namespace i=v8::internal;
    uint16_t units[4097];size_t used=0;const auto wanted=std::min(uint32_t(s->Length()),4097u);
    struct Segment{i::Tagged<i::String> value;uint32_t offset,count;};
    std::array<Segment,128> pending;size_t depth=0;int visits=0;
    {
      i::DisallowGarbageCollection noGC;
      pending[depth++]={*v8::Utils::OpenDirectHandle(*s),0,wanted};
      while(depth&&visits++<128){
        auto [value,offset,count]=pending[--depth];if(!count)continue;
        if(i::IsThinString(value)){pending[depth++]={i::Cast<i::ThinString>(value)->actual(),offset,count};continue;}
        if(i::IsSlicedString(value)){auto slice=i::Cast<i::SlicedString>(value);pending[depth++]={slice->parent(),offset+uint32_t(slice->offset()),count};continue;}
        if(i::IsConsString(value)){
          if(depth+2>pending.size())break;
          auto cons=i::Cast<i::ConsString>(value);auto first=cons->first(),second=cons->second();uint32_t left=first->length();
          if(offset>=left)pending[depth++]={second,offset-left,count};
          else {uint32_t a=std::min(count,left-offset);if(count>a)pending[depth++]={second,0,count-a};pending[depth++]={first,offset,a};}
          continue;
        }
        for(uint32_t n=0;n<count;n++)units[used++]=value->Get(offset+n);
      }
    }
    if(used<size_t(s->Length()))truncated=true;
    char bytes[4096];size_t written=0,capacity=limit-out_.size();
    for(size_t n=0;n<used;n++){
      uint32_t cp=units[n];
      if(cp>=0xd800&&cp<=0xdbff){
        if(n+1<used&&units[n+1]>=0xdc00&&units[n+1]<=0xdfff)cp=0x10000+((cp-0xd800)<<10)+(units[++n]-0xdc00);
        else {if(n+1==used&&used<size_t(s->Length()))break;cp=0xfffd;}
      }else if(cp>=0xdc00&&cp<=0xdfff)cp=0xfffd;
      size_t count=cp==0?2:cp<0x80?1:cp<0x800?2:cp<0x10000?3:4;
      if(written+count>capacity){truncated=true;break;}
      if(!cp){bytes[written++]='\\';bytes[written++]='0';}
      else if(count==1)bytes[written++]=char(cp);
      else {if(count==4)bytes[written++]=char(0xf0|(cp>>18));if(count>=3)bytes[written++]=char((count==3?0xe0:0x80)|((cp>>12)&(count==3?15:63)));bytes[written++]=char((count==2?0xc0:0x80)|((cp>>6)&(count==2?31:63)));bytes[written++]=char(0x80|(cp&63));}
    }
    out_.append(bytes,written);
    if(used<wanted)add("[String preview limit]");
  }
  v8::Local<v8::String> key(const char* s){return v8::String::NewFromUtf8(isolate_,s).ToLocalChecked();}
  void property(v8::Local<v8::Object> object,v8::Local<v8::Name> name,int depth){
    v8::Local<v8::Value> descriptor;
    if(!object->GetOwnPropertyDescriptor(context_,name).ToLocal(&descriptor)||!descriptor->IsObject()){add("<absent>");return;}
    // Descriptor is a fresh ordinary V8 object; never invoke the original getter.
    auto d=descriptor.As<v8::Object>();v8::Local<v8::Value> value;
    if(d->HasOwnProperty(context_,key("value")).FromMaybe(false)&&d->Get(context_,key("value")).ToLocal(&value))preview(value,depth);
    else add("[Accessor]");
  }
  template<class T> void typedValues(const unsigned char* bytes,size_t count){for(size_t n=0;n<count;n++){T value;std::memcpy(&value,bytes+n*sizeof(T),sizeof(T));if(n)add(", ");if constexpr(std::is_floating_point_v<T>)add(std::to_string(double(value)));else if constexpr(std::is_signed_v<T>)add(std::to_string(int64_t(value)));else add(std::to_string(uint64_t(value)));}}
  void preview(v8::Local<v8::Value> value,int depth){
    if(out_.size()>=limit){truncated=true;return;}
    if(++visits_>48){add("[…]");truncated=true;return;}
    if(value->IsString()){string(value.As<v8::String>());return;}
    if(value->IsProxy()){add("[Proxy]");return;}
    if(value->IsFunction()){add("[Function]");return;}
    if(value->IsSymbol()){add("Symbol(");auto description=value.As<v8::Symbol>()->Description(isolate_);if(description->IsString())string(description.As<v8::String>());add(")");return;}
    if(value->IsBigInt()&&value.As<v8::BigInt>()->WordCount()>4){add("[BigInt: >256 bits]");return;}
    if(!value->IsObject()){v8::Local<v8::String> text;if(value->ToString(context_).ToLocal(&text))string(text);if(value->IsBigInt())add("n");return;}
    auto object=value.As<v8::Object>();
    for(int i=0;i<depth;i++)if(ancestors_[i]==object){add("[Circular]");return;}
    if(depth>=2){add("[Object]");return;}ancestors_[depth]=object;
    if(value->IsTypedArray()){
      auto array=value.As<v8::TypedArray>();auto length=array->Length();
      if(array->Buffer()->WasDetached()){add("[TypedArray: detached]");return;}
      const char* name=value->IsFloat32Array()?"Float32Array":value->IsFloat64Array()?"Float64Array":value->IsInt8Array()?"Int8Array":value->IsUint8Array()?"Uint8Array":value->IsUint8ClampedArray()?"Uint8ClampedArray":value->IsInt16Array()?"Int16Array":value->IsUint16Array()?"Uint16Array":value->IsInt32Array()?"Int32Array":value->IsUint32Array()?"Uint32Array":value->IsBigInt64Array()?"BigInt64Array":"BigUint64Array";
      add(std::string(name)+"("+std::to_string(length)+")[");
      alignas(8) unsigned char bytes[64]{};size_t count=std::min(size_t(8),length);size_t width=length?array->ByteLength()/length:1;
      array->CopyContents(bytes,count*width);
      if(value->IsFloat32Array())typedValues<float>(bytes,count);else if(value->IsFloat64Array())typedValues<double>(bytes,count);
      else if(value->IsInt8Array())typedValues<int8_t>(bytes,count);else if(value->IsInt16Array())typedValues<int16_t>(bytes,count);else if(value->IsInt32Array())typedValues<int32_t>(bytes,count);else if(value->IsBigInt64Array())typedValues<int64_t>(bytes,count);
      else if(width==1)typedValues<uint8_t>(bytes,count);else if(width==2)typedValues<uint16_t>(bytes,count);else if(width==4)typedValues<uint32_t>(bytes,count);else typedValues<uint64_t>(bytes,count);
      if(length>count)add(", … +"+std::to_string(length-count));add("]");return;
    }
    if(value->IsArrayBuffer()){add("ArrayBuffer("+std::to_string(value.As<v8::ArrayBuffer>()->ByteLength())+")");return;}
    if(value->IsArray()){
      auto count=value.As<v8::Array>()->Length();add("[");
      for(uint32_t n=0;n<std::min(count,8u);n++){if(n)add(", ");property(object,key(std::to_string(n).c_str()),depth+1);}
      if(count>8)add(", … +"+std::to_string(count-8));add("]");return;
    }
    if(value->IsNativeError()){
      add("Error {name: ");
      auto owner=object;bool named=false;
      for(int n=0;n<3;n++){
        if(owner->HasOwnProperty(context_,key("name")).FromMaybe(false)){property(owner,key("name"),depth+1);named=true;break;}
        auto proto=owner->GetPrototype();if(!proto->IsObject()||proto->IsProxy())break;owner=proto.As<v8::Object>();
      }
      if(!named)add("Error");add(", message: ");property(object,key("message"),depth+1);add("}");
      // V8's captured frames bypass Error.prepareStackTrace and stack getters.
      auto stack=v8::Exception::GetStackTrace(value);
      if(!stack.IsEmpty())for(int n=0;n<std::min(stack->GetFrameCount(),4);n++){auto f=stack->GetFrame(isolate_,n);add("\n  at ");auto script=f->GetScriptName();if(!script.IsEmpty())string(script);add(":"+std::to_string(f->GetLineNumber()));}
      return;
    }
    auto internal=v8::Utils::OpenDirectHandle(*object);
    // Other exotic/native objects are opaque: no interceptors, prototype walks,
    // proxy traps, user conversion, or enumeration of dictionary backing stores.
    if(!v8::internal::IsJSObject(*internal)||internal->map()->instance_type()!=v8::internal::JS_OBJECT_TYPE||object->InternalFieldCount()!=0){add("[Object: opaque]");return;}
    auto plain=v8::internal::Cast<v8::internal::JSObject>(internal);
    std::array<v8::Local<v8::Name>,8> keys;int used=0,count=0;
    auto* internalIsolate=reinterpret_cast<v8::internal::Isolate*>(isolate_);
    auto keep=[&](v8::internal::Tagged<v8::internal::Name> name){keys[used++]=v8::Utils::ToLocal(v8::internal::direct_handle(name,internalIsolate));};
    // No enumeration allocation: inspect <=8 fast keys or <=64 hash slots.
    if(plain->HasFastProperties()){
      auto map=plain->map();count=map->NumberOfOwnDescriptors();
      for(int n=0;n<std::min(count,8);n++)keep(map->instance_descriptors()->GetKey(v8::internal::InternalIndex(n)));
    }else{
      auto scan=[&](auto dictionary){count=dictionary->NumberOfElements();for(int n=0;n<std::min(int(dictionary->Capacity()),64)&&used<8;n++){
        auto candidate=dictionary->KeyAt(v8::internal::InternalIndex(n));
        if(v8::internal::IsName(candidate))keep(v8::internal::Cast<v8::internal::Name>(candidate));
      }};
      if constexpr(V8_ENABLE_SWISS_NAME_DICTIONARY_BOOL)scan(plain->property_dictionary_swiss());else scan(plain->property_dictionary());
    }
    add("{");for(int n=0;n<used;n++){if(n)add(", ");preview(keys[n],depth+1);add(": ");property(object,keys[n],depth+1);}
    if(count>used)add(", … +"+std::to_string(count-used));add("}");
  }
 public:
  bool truncated=false;
  explicit LogFormat(v8::Isolate* isolate):isolate_(isolate),context_(isolate->GetCurrentContext()){out_.reserve(limit);}
  std::string format(const v8::FunctionCallbackInfo<v8::Value>& args,int first){
    v8::TryCatch catcher(isolate_);
    for(int n=first;n<std::min(args.Length(),first+16);n++){if(n>first)add(" ");preview(args[n],0);if(catcher.HasCaught()){add("[unavailable]");break;}}
    if(args.Length()>first+16){add(" … +"+std::to_string(args.Length()-first-16)+" arguments");truncated=true;}
    // The formatter owns this catcher; don't rethrow a preview failure into JS.
    return std::move(out_);
  }
};
}
