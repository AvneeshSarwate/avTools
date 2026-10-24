#include "CHOP_CPlusPlusBase.h"
#include "TDParameters.h"
#include <fstream>
#include <iomanip>
using namespace TD;
class BootstrapProbe:public CHOP_CPlusPlusBase {
 OP_Context* context;int version=1;
 public:
 explicit BootstrapProbe(const OP_NodeInfo* i):context(i->context){}
 void setupParameters(OP_ParameterManager* m,void*)override {
  std::string source,error;
  try{TDParameters p(context);source=p.get("Entryfile");}catch(const std::exception& e){error=e.what();}
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
DLLEXPORT void FillCHOPPluginInfo(CHOP_PluginInfo* i){if(!i->setAPIVersion(CHOPCPlusPlusAPIVersion))return;i->customOPInfo.opType->setString("Avbootstrap");i->customOPInfo.opLabel->setString("Bootstrap Probe");i->customOPInfo.minInputs=0;i->customOPInfo.maxInputs=0;}
DLLEXPORT CHOP_CPlusPlusBase* CreateCHOPInstance(const OP_NodeInfo* i){return new BootstrapProbe(i);}
DLLEXPORT void DestroyCHOPInstance(CHOP_CPlusPlusBase* i){delete static_cast<BootstrapProbe*>(i);}
}
