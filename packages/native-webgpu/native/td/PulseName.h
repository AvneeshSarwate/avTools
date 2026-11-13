#pragma once
#include "../embedded/Platform.h"
#include <stdexcept>
#include <string>
// pulsePressed has no OP_Inputs. Read the parameter through the documented
// OP_Context Python operator object on this TD callback thread. Resolve the
// resident Python C API, avoiding a new Python runtime/link dependency.
inline std::string capturePulseName(TD::OP_Context* context){
  using Object=void;
  auto ensure=reinterpret_cast<int(*)()>(avtools::platform::hostSymbol("PyGILState_Ensure"));
  auto release=reinterpret_cast<void(*)(int)>(avtools::platform::hostSymbol("PyGILState_Release"));
  auto item=reinterpret_cast<Object*(*)(Object*,long)>(avtools::platform::hostSymbol("PyTuple_GetItem"));
  auto attr=reinterpret_cast<Object*(*)(Object*,const char*)>(avtools::platform::hostSymbol("PyObject_GetAttrString"));
  auto call=reinterpret_cast<Object*(*)(Object*,Object*)>(avtools::platform::hostSymbol("PyObject_CallObject"));
  auto utf8=reinterpret_cast<const char*(*)(Object*)>(avtools::platform::hostSymbol("PyUnicode_AsUTF8"));
  auto decref=reinterpret_cast<void(*)(Object*)>(avtools::platform::hostSymbol("Py_DecRef"));
  auto clear=reinterpret_cast<void(*)()>(avtools::platform::hostSymbol("PyErr_Clear"));
  if(!context||!ensure||!release||!item||!attr||!call||!utf8||!decref||!clear)throw std::runtime_error("Cannot capture pulse Event Name from TD Python API");
  const int state=ensure();struct GIL{void(*release)(int);int state;~GIL(){release(state);}}gil{release,state};
  Object* tuple=context->createArgumentsTuple(0,nullptr);
  Object* node=tuple?item(tuple,0):nullptr;
  Object* pars=node?attr(node,"par"):nullptr;
  Object* par=pars?attr(pars,"Eventname"):nullptr;
  Object* eval=par?attr(par,"eval"):nullptr;
  Object* value=eval?call(eval,nullptr):nullptr;
  const char* text=value?utf8(value):nullptr;bool ok=text!=nullptr;std::string result=text?text:"";
  for(auto* p:{value,eval,par,pars,tuple})if(p)decref(p);
  if(!ok){clear();throw std::runtime_error("Cannot evaluate pulse Event Name");}return result;
}
