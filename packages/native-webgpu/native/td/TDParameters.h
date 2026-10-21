#pragma once
#include <dlfcn.h>
#include <filesystem>
#include <stdexcept>
#include <string>
// Only used on TD's callback thread. OP_Context supplies the operator object;
// use TD's resident Python C API without loading another interpreter.
class TDParameters {
  using Object=void;
  template<class T> static T symbol(const char* name){auto p=reinterpret_cast<T>(dlsym(RTLD_DEFAULT,name));if(!p)throw std::runtime_error("TD Python API unavailable");return p;}
  int (*ensure)()=symbol<int(*)()>("PyGILState_Ensure");
  void (*release)(int)=symbol<void(*)(int)>("PyGILState_Release");
  Object* (*item)(Object*,long)=symbol<Object*(*)(Object*,long)>("PyTuple_GetItem");
  Object* (*attr)(Object*,const char*)=symbol<Object*(*)(Object*,const char*)>("PyObject_GetAttrString");
  int (*setAttr)(Object*,const char*,Object*)=symbol<int(*)(Object*,const char*,Object*)>("PyObject_SetAttrString");
  Object* (*call)(Object*,Object*)=symbol<Object*(*)(Object*,Object*)>("PyObject_CallObject");
  Object* (*callArgs)(Object*,...)=symbol<Object*(*)(Object*,...)>("PyObject_CallFunctionObjArgs");
  Object* (*string)(const char*)=symbol<Object*(*)(const char*)>("PyUnicode_FromString");
  Object* (*integer)(long)=symbol<Object*(*)(long)>("PyLong_FromLong");
  const char* (*utf8)(Object*)=symbol<const char*(*)(Object*)>("PyUnicode_AsUTF8");
  void (*decref)(Object*)=symbol<void(*)(Object*)>("Py_DecRef");
  void (*clear)()=symbol<void(*)()>("PyErr_Clear");
  int gil;Object* tuple=nullptr;Object* node=nullptr;Object* pars=nullptr;
  void drop(Object* p){if(p)decref(p);}
  [[noreturn]] void fail(const char* message){clear();throw std::runtime_error(message);}
  std::string text(Object* value){const char* p=value?utf8(value):nullptr;std::string out=p?p:"";bool ok=p;drop(value);if(!ok)fail("Cannot evaluate TD parameter");return out;}
  void setValue(const char* name,Object* value){Object* par=pars?attr(pars,name):nullptr;int result=(par&&value)?setAttr(par,"val",value):-1;drop(par);drop(value);if(result<0)fail("Cannot set TD parameter");}
 public:
  explicit TDParameters(TD::OP_Context* context):gil(ensure()){
    tuple=context?context->createArgumentsTuple(0,nullptr):nullptr;node=tuple?item(tuple,0):nullptr;pars=node?attr(node,"par"):nullptr;
    if(!pars){drop(tuple);clear();release(gil);throw std::runtime_error("Cannot access operator parameters");}
  }
  ~TDParameters(){drop(pars);drop(tuple);clear();release(gil);}
  TDParameters(const TDParameters&)=delete;
  TDParameters& operator=(const TDParameters&)=delete;
  std::string get(const char* name){Object* par=attr(pars,name);Object* eval=par?attr(par,"eval"):nullptr;Object* value=eval?call(eval,nullptr):nullptr;drop(eval);drop(par);return text(value);}
  void set(const char* name,const std::string& value){setValue(name,string(value.c_str()));}
  void set(const char* name,int value){setValue(name,integer(value));}
  void refreshMetadata(){
    Object* fn=attr(node,"evalExpression");Object* expression=string("me.cook(force=True)");
    Object* result=(fn&&expression)?callArgs(fn,expression,nullptr):nullptr;
    bool ok=result;drop(result);drop(expression);drop(fn);if(!ok)fail("Cannot refresh operator metadata");
  }
  std::string path(const char* name){
    auto value=get(name);if(value.empty())return value;
    // Let TD expand project-relative paths and variables using its normal path API.
    Object* fn=attr(node,"evalExpression");Object* expression=string((std::string("tdu.expandPath(me.par.")+name+".eval())").c_str());
    Object* result=(fn&&expression)?callArgs(fn,expression,nullptr):nullptr;drop(expression);drop(fn);return text(result);
  }
};
