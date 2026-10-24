#include "CHOP_CPlusPlusBase.h"
#include "TDParameters.h"
#include <fstream>
#include <iomanip>
using namespace TD;
class StorageProbe:public CHOP_CPlusPlusBase {
 OP_Context* context;int version=1;
 public:
 explicit StorageProbe(const OP_NodeInfo* i):context(i->context){}
 void setupParameters(OP_ParameterManager* m,void*)override {
  std::string source,error;
  using Object=void;
  auto ensure=(int(*)())dlsym(RTLD_DEFAULT,"PyGILState_Ensure");auto release=(void(*)(int))dlsym(RTLD_DEFAULT,"PyGILState_Release");
  auto item=(Object*(*)(Object*,long))dlsym(RTLD_DEFAULT,"PyTuple_GetItem");auto attr=(Object*(*)(Object*,const char*))dlsym(RTLD_DEFAULT,"PyObject_GetAttrString");
  auto dict=(Object*(*)(Object*,const char*))dlsym(RTLD_DEFAULT,"PyDict_GetItemString");auto integer=(long(*)(Object*))dlsym(RTLD_DEFAULT,"PyLong_AsLong");
  auto drop=(void(*)(Object*))dlsym(RTLD_DEFAULT,"Py_DecRef");auto clear=(void(*)())dlsym(RTLD_DEFAULT,"PyErr_Clear");
  int gil=ensure();Object* tuple=context->createArgumentsTuple(0,nullptr);Object* node=tuple?item(tuple,0):nullptr;Object* storage=node?attr(node,"storage"):nullptr;Object* saved=storage?dict(storage,"declaredSchema"):nullptr;
  source=saved&&integer(saved)==2?"schema2":"schema1";if(!storage)error="No storage";
  if(storage)drop(storage);if(tuple)drop(tuple);clear();release(gil);
  version=source=="schema2"?2:1;
  std::ofstream(PROBE_LOG,std::ios::app)<<"{\"entry\":"<<std::quoted(source)<<",\"error\":"<<std::quoted(error)<<",\"schema\":"<<version<<"}\n";
  OP_StringParameter s;s.name="Entryfile";s.label="Entry File";s.page="Build";m->appendString(s);
  OP_NumericParameter p;p.name=version==1?"First":"Second";p.label=p.name;p.page="Declared";m->appendFloat(p);
 }
 bool getOutputInfo(CHOP_OutputInfo* i,const OP_Inputs*,void*)override{i->numChannels=1;i->numSamples=1;return true;}
 void getChannelName(int32_t,OP_String* n,const OP_Inputs*,void*)override{n->setString("schema");}
 void execute(CHOP_Output* o,const OP_Inputs*,void*)override{o->channels[0][0]=version;}
};
extern "C" {
DLLEXPORT void FillCHOPPluginInfo(CHOP_PluginInfo* i){if(!i->setAPIVersion(CHOPCPlusPlusAPIVersion))return;i->customOPInfo.opType->setString("Avstorage");i->customOPInfo.opLabel->setString("Storage Probe");i->customOPInfo.minInputs=0;i->customOPInfo.maxInputs=0;}
DLLEXPORT CHOP_CPlusPlusBase* CreateCHOPInstance(const OP_NodeInfo* i){return new StorageProbe(i);}
DLLEXPORT void DestroyCHOPInstance(CHOP_CPlusPlusBase* i){delete static_cast<StorageProbe*>(i);}
}
