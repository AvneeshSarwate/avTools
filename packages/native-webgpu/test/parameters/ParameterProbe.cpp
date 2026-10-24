#include "CHOP_CPlusPlusBase.h"
#include <fstream>
#include <string>
using namespace TD;
static int generations=0;
class ParameterProbe:public CHOP_CPlusPlusBase {
 int generation=++generations, version=1, cooks=0, pulses=0;
 public:
 void setupParameters(OP_ParameterManager* m,void*)override {
  std::ifstream(PROBE_SCHEMA)>>version;
  auto number=[&](const char* name,double value){OP_NumericParameter p;p.name=name;p.label=name;p.page="Declared";p.defaultValues[0]=value;p.minSliders[0]=0;p.maxSliders[0]=version==1?10:100;m->appendFloat(p);};
  number("Speed",version==1?1:2);number("Expr",2);number("Exportvalue",3);number("Boundvalue",4);
  if(version==1)number("Gone",5);else number("Added",9);
  if(version<3)number("Typetest",6);else{OP_StringParameter p;p.name="Typetest";p.label="Type test string";p.page="Declared";p.defaultValue="new default";m->appendString(p);}
  OP_NumericParameter p;p.name="Trigger";p.label="Trigger";p.page="Declared";m->appendPulse(p);
 }
 bool getOutputInfo(CHOP_OutputInfo* i,const OP_Inputs*,void*)override{i->numChannels=8;i->numSamples=1;i->sampleRate=60;return true;}
 void getChannelName(int32_t i,OP_String* s,const OP_Inputs*,void*)override{const char* names[]={"generation","schema","cooks","speed","expr","exported","bound","pulses"};s->setString(names[i]);}
 void execute(CHOP_Output* o,const OP_Inputs* in,void*)override{double v[]={double(generation),double(version),double(++cooks),in->getParDouble("Speed"),in->getParDouble("Expr"),in->getParDouble("Exportvalue"),in->getParDouble("Boundvalue"),double(pulses)};for(int i=0;i<8;i++)o->channels[i][0]=float(v[i]);}
 void pulsePressed(const char* name,void*)override{if(std::string(name)=="Trigger")pulses++;}
};
extern "C" {
DLLEXPORT void FillCHOPPluginInfo(CHOP_PluginInfo* i){if(!i->setAPIVersion(CHOPCPlusPlusAPIVersion))return;i->customOPInfo.opType->setString("Avparameterprobe");i->customOPInfo.opLabel->setString("Parameter Probe");i->customOPInfo.minInputs=0;i->customOPInfo.maxInputs=0;}
DLLEXPORT CHOP_CPlusPlusBase* CreateCHOPInstance(const OP_NodeInfo*){return new ParameterProbe;}
DLLEXPORT void DestroyCHOPInstance(CHOP_CPlusPlusBase* i){delete static_cast<ParameterProbe*>(i);}
}
