#include "CHOP_CPlusPlusBase.h"
#include "../embedded/Bridge.h"
#include <algorithm>
#include <chrono>
#include <cctype>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
using namespace TD;
namespace {
using Clock=std::chrono::steady_clock;
std::string resources(){Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&resources),&info))throw std::runtime_error("Cannot locate plugin resources");return (std::filesystem::path(info.dli_fname).parent_path().parent_path()/"Resources").string();}
std::vector<std::string> channelNames(const OP_Inputs* inputs){
  std::istringstream stream(inputs->getParString("Outputchannels"));std::vector<std::string> names;std::set<std::string> seen;std::string name;
  while(stream>>name){
    if(name.size()>128||!(std::isalpha(static_cast<unsigned char>(name[0]))||name[0]=='_')||!std::all_of(name.begin(),name.end(),[](unsigned char c){return std::isalnum(c)||c=='_';})||!seen.insert(name).second)throw std::runtime_error("Output Channels must be unique identifiers separated by spaces");
    names.push_back(name);if(names.size()>1024)throw std::runtime_error("Maximum 1024 output channels");
  }
  if(names.empty())throw std::runtime_error("Set at least one Output Channel");return names;
}
class SketchCHOP final:public CHOP_CPlusPlusBase {
  AVSketch* runtime=nullptr;AVStats stats{};std::string error,warning;bool reset=true;uint32_t pulses=0;
  double cookMs=0,outputFrame=-1;
 public:
  ~SketchCHOP()override{avDestroy(runtime);}
  void getGeneralInfo(CHOP_GeneralInfo* info,const OP_Inputs*,void*)override{info->cookEveryFrameIfAsked=true;info->timeslice=false;}
  bool getOutputInfo(CHOP_OutputInfo* info,const OP_Inputs* inputs,void*)override{
    info->numSamples=std::clamp(inputs->getParInt("Outputsamples"),1,1048576);info->startIndex=0;info->sampleRate=float(inputs->getTimeInfo()->rate);
    try{info->numChannels=int(channelNames(inputs).size());if(size_t(info->numChannels)*info->numSamples>1048576)throw std::runtime_error("Maximum 1M total output samples");}catch(const std::exception& e){error=e.what();info->numChannels=1;info->numSamples=1;}return true;
  }
  void getChannelName(int32_t index,OP_String* name,const OP_Inputs* inputs,void*)override{
    try{auto names=channelNames(inputs);name->setString(index>=0&&size_t(index)<names.size()?names[index].c_str():"out");}catch(...){name->setString("out");}
  }
  void execute(CHOP_Output* output,const OP_Inputs* inputs,void*)override{
    auto start=Clock::now();struct Finish{double& ms;Clock::time_point start;~Finish(){ms=std::chrono::duration<double,std::milli>(Clock::now()-start).count();}}finish{cookMs,start};
    for(int i=0;i<output->numChannels;i++)std::fill_n(output->channels[i],output->numSamples,0.f);
    outputFrame=-1;warning.clear();
    try{
      auto names=channelNames(inputs);
      if(size_t(inputs->getParInt("Outputsamples"))*names.size()>1048576||output->numSamples<1||size_t(output->numChannels)!=names.size()||size_t(output->numSamples)*names.size()>1048576)throw std::runtime_error("Maximum 1M total output samples");
      std::string source;
      if(const auto* dat=inputs->getParDAT("Sketch")){if(dat->isTable)throw std::runtime_error("Sketch must be a Text DAT");if(dat->numRows&&dat->numCols)source=dat->getCell(0,0);}
      else{const char* file=inputs->getParString("Sourcefile");if(file&&*file){std::ifstream stream(file);if(!stream)throw std::runtime_error("Cannot open Source File");source.assign(std::istreambuf_iterator<char>(stream),{});}}
      if(source.empty())throw std::runtime_error("Set Sketch DAT or Source File");
      char detail[8192]{};
      if(!runtime){runtime=avChopCreate(resources().c_str(),detail,sizeof(detail));if(!runtime)throw std::runtime_error(detail);}
      std::vector<AVChopChannel> channels;
      for(int input=0;input<inputs->getNumInputs();input++)if(const auto* chop=inputs->getInputCHOP(input))for(int c=0;c<chop->numChannels;c++)channels.push_back({uint32_t(input),{chop->getChannelName(c),chop->getChannelData(c),uint32_t(chop->numSamples)}});
      std::vector<const char*> outputNames;for(auto& name:names)outputNames.push_back(name.c_str());
      std::vector<float> values(names.size()*output->numSamples);std::vector<const char*> events(pulses,inputs->getParString("Eventname"));
      const auto* time=inputs->getTimeInfo();
      AVChopFrame frame{source.c_str(),uint32_t(reset),time->frame,time->rate,time->deltaMS/1000,double(time->absFrame),channels.data(),uint32_t(channels.size()),outputNames.data(),uint32_t(names.size()),values.data(),events.data(),uint32_t(events.size()),uint32_t(output->numSamples)};
      const int ready=avChopCook(runtime,&frame,&stats,detail,sizeof(detail));reset=false;pulses=0;error=ready?"":detail;warning=ready?detail:"";
      if(ready){for(size_t i=0;i<names.size();i++)std::copy_n(values.data()+i*output->numSamples,output->numSamples,output->channels[i]);outputFrame=time->absFrame;}
    }catch(const std::exception& e){error=e.what();}
  }
  void setupParameters(OP_ParameterManager* manager,void*)override{
    OP_StringParameter p;p.page="Script";p.name="Sketch";p.label="Sketch DAT";manager->appendDAT(p);
    p.name="Sourcefile";p.label="Source File";manager->appendFile(p);
    p.name="Outputchannels";p.label="Output Channels";p.defaultValue="out";manager->appendString(p);
    OP_NumericParameter samples;samples.name="Outputsamples";samples.label="Output Samples";samples.page="Script";samples.defaultValues[0]=1;samples.minValues[0]=1;samples.maxValues[0]=1048576;samples.clampMins[0]=true;samples.clampMaxes[0]=true;manager->appendInt(samples);
    p.name="Eventname";p.label="Event Name";p.defaultValue="Trigger";manager->appendString(p);
    for(const auto* name:{"Sendpulse","Reset","Reload"}){OP_NumericParameter n;n.name=name;n.label=std::string(name)=="Sendpulse"?"Send Pulse":name;n.page="Script";manager->appendPulse(n);}
  }
  void pulsePressed(const char* name,void*)override{if(std::string(name)=="Sendpulse"){if(pulses<256)pulses++;else error="Pulse queue full; cook before sending more events";}else reset=true;}
  void getWarningString(OP_String* value,void*)override{value->setString(warning.c_str());}
  void getErrorString(OP_String* value,void*)override{value->setString(error.c_str());}
  int32_t getNumInfoCHOPChans(void*)override{return 6;}
  void getInfoCHOPChan(int32_t i,OP_InfoCHOPChan* channel,void*)override{
    const char* names[]={"cooks","cook_ms","input_copy_ms","script_ms","output_abs_frame","ready"};
    const double values[]={double(stats.cooks),cookMs,stats.inputMs,stats.drawMs,outputFrame,outputFrame>=0?1.:0.};
    if(i>=0&&i<6){channel->name->setString(names[i]);channel->value=float(values[i]);}
  }
};
}
extern "C" {
__attribute__((visibility("default"))) DLLEXPORT void FillCHOPPluginInfo(CHOP_PluginInfo* info){if(!info->setAPIVersion(CHOPCPlusPlusAPIVersion))return;info->customOPInfo.opType->setString("Avtoolschannels");info->customOPInfo.opLabel->setString("avTools Channels");info->customOPInfo.opIcon->setString("AVC");info->customOPInfo.authorName->setString("avTools");info->customOPInfo.minInputs=0;info->customOPInfo.maxInputs=4;info->customOPInfo.cookOnStart=true;}
__attribute__((visibility("default"))) DLLEXPORT CHOP_CPlusPlusBase* CreateCHOPInstance(const OP_NodeInfo*){return new SketchCHOP();}
__attribute__((visibility("default"))) DLLEXPORT void DestroyCHOPInstance(CHOP_CPlusPlusBase* instance){delete static_cast<SketchCHOP*>(instance);}
}
