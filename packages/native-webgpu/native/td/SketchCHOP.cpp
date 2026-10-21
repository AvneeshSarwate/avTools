#include "CHOP_CPlusPlusBase.h"
#include "../embedded/Bridge.h"
#include "Logging.h"
#include "NativeBuild.h"
#include "SourceActivation.h"
#include "PulseName.h"
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
const std::string& resources(){static const std::string path=[](){Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&resources),&info))throw std::runtime_error("Cannot locate plugin resources");return (std::filesystem::path(info.dli_fname).parent_path().parent_path()/"Resources").string();}();return path;}
std::vector<std::string> channelNames(const OP_Inputs* inputs){
  std::istringstream stream(inputs->getParString("Outputchannels"));std::vector<std::string> names;std::set<std::string> seen;std::string name;
  while(stream>>name){
    if(name.size()>128||!(std::isalpha(static_cast<unsigned char>(name[0]))||name[0]=='_')||!std::all_of(name.begin(),name.end(),[](unsigned char c){return std::isalnum(c)||c=='_';})||!seen.insert(name).second)throw std::runtime_error("Output Channels must be unique identifiers separated by spaces");
    names.push_back(name);if(names.size()>1024)throw std::runtime_error("Maximum 1024 output channels");
  }
  if(names.empty())throw std::runtime_error("Set at least one Output Channel");return names;
}
class SketchCHOP final:public CHOP_CPlusPlusBase {
  AVSketch* runtime=nullptr;NativeBuild nativeBuild;Logging logging;SourceActivation activation;std::string selectionError;AVStats stats{};std::string error,warning;bool reset=false;std::vector<std::string> pulses;TD::OP_Context* context;AVChopDiagnostics diagnostics{};uint64_t localPulseOverflows=0;std::vector<float> values;
  double cookMs=0,outputFrame=-1;
 public:
  explicit SketchCHOP(const OP_NodeInfo* info):context(info->context){}
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
    logging.update(inputs);if(logging.takeRefresh()){for(int c=0;c<output->numChannels;c++)for(int n=0;n<output->numSamples;n++){size_t i=size_t(c)*output->numSamples+n;output->channels[c][n]=i<values.size()?values[i]:0.f;}return;}
    auto start=Clock::now();struct Finish{double& ms;Clock::time_point start;~Finish(){ms=std::chrono::duration<double,std::milli>(Clock::now()-start).count();}}finish{cookMs,start};
    for(int i=0;i<output->numChannels;i++)std::fill_n(output->channels[i],output->numSamples,0.f);
    outputFrame=-1;warning.clear();
    try{
      auto names=channelNames(inputs);
      if(size_t(inputs->getParInt("Outputsamples"))*names.size()>1048576||output->numSamples<1||size_t(output->numChannels)!=names.size()||size_t(output->numSamples)*names.size()>1048576)throw std::runtime_error("Maximum 1M total output samples");
      std::string source,identity;
      const char* typescript=inputs->getParString("Typescript");
      const char* project=inputs->getParString("Projectdir");if((!project||!*project)&&(!typescript||!*typescript))nativeBuild.clear();
      selectionError.clear();try{
      if(typescript&&*typescript){identity="ts:"+std::string(typescript);source=nativeBuild.readTyped(resources(),typescript,"chop",inputs->getParInt("Autobuild")!=0,context);}
      else if(project&&*project){identity="project:"+std::string(project)+":"+inputs->getParString("Entry");source=nativeBuild.read(resources(),project,inputs->getParString("Entry"),inputs->getParInt("Autobuild")!=0);}
      else if(const auto* dat=inputs->getParDAT("Sketch")){identity="dat:"+std::string(inputs->getParString("Sketch"));nativeBuild.clearFile();if(dat->isTable)throw std::runtime_error("Sketch must be a Text DAT");if(dat->numRows&&dat->numCols)source=dat->getCell(0,0);}
      else{const char* file=inputs->getParString("Sourcefile");if(file&&*file){identity="file:"+std::string(file);source=nativeBuild.readFile(resources(),file);}}
      }catch(const std::exception& e){selectionError=e.what();}
      activation.observe(identity,source,inputs->getParInt("Autoreload")!=0);
      auto choice=activation.choose();source=choice.version.code;if(source.empty())return;reset=choice.restart;
      char detail[8192]{};
      if(!runtime){runtime=avChopCreate(resources().c_str(),detail,sizeof(detail));if(!runtime)throw std::runtime_error(detail);logging.attach(runtime);}
      std::vector<AVChopChannel> channels;
      for(int input=0;input<inputs->getNumInputs();input++)if(const auto* chop=inputs->getInputCHOP(input))for(int c=0;c<chop->numChannels;c++)channels.push_back({uint32_t(input),{chop->getChannelName(c),chop->getChannelData(c),uint32_t(chop->numSamples)}});
      std::vector<const char*> outputNames;for(auto& name:names)outputNames.push_back(name.c_str());
      values.resize(names.size()*output->numSamples);std::vector<const char*> events;for(auto& name:pulses)events.push_back(name.c_str());
      const auto* time=inputs->getTimeInfo();
      AVChopFrame frame{source.c_str(),uint32_t(reset),time->frame,time->rate,time->deltaMS/1000,double(time->absFrame),channels.data(),uint32_t(channels.size()),outputNames.data(),uint32_t(names.size()),values.data(),events.data(),uint32_t(events.size()),uint32_t(output->numSamples)};
      const auto priorRequest=diagnostics.submitted;
      const int ready=avChopExecute(runtime,&frame,inputs->getParInt("Samecook")!=0,&stats,&diagnostics,detail,sizeof(detail));if(diagnostics.submitted>priorRequest){activation.accepted(choice);reset=false;pulses.clear();}error=(!ready&&inputs->getParInt("Samecook"))?detail:"";warning=error.empty()?detail:"";
      if(ready){for(size_t i=0;i<names.size();i++)std::copy_n(values.data()+i*output->numSamples,output->numSamples,output->channels[i]);outputFrame=diagnostics.sourceFrame;}
    }catch(const std::exception& e){error=e.what();}
  }
  void setupParameters(OP_ParameterManager* manager,void*)override{
    NativeBuild::parameters(manager);Logging::parameters(manager);
    {OP_NumericParameter p;p.name="Samecook";p.label="Wait for Current Result";p.page="Script";p.defaultValues[0]=1;manager->appendToggle(p);}
    OP_StringParameter p;p.page="Script";p.name="Sketch";p.label="Sketch DAT";manager->appendDAT(p);
    p.name="Sourcefile";p.label="Source File";manager->appendFile(p);
    p.name="Outputchannels";p.label="Output Channels";p.defaultValue="out";manager->appendString(p);
    OP_NumericParameter samples;samples.name="Outputsamples";samples.label="Output Samples";samples.page="Script";samples.defaultValues[0]=1;samples.minValues[0]=1;samples.maxValues[0]=1048576;samples.clampMins[0]=true;samples.clampMaxes[0]=true;manager->appendInt(samples);
    p.name="Eventname";p.label="Event Name";p.defaultValue="Trigger";manager->appendString(p);
    for(const auto* name:{"Sendpulse","Reset","Reload"}){OP_NumericParameter n;n.name=name;n.label=std::string(name)=="Sendpulse"?"Send Pulse":name;n.page="Script";manager->appendPulse(n);}
  }
  void pulsePressed(const char* name,void*)override{if(logging.pulse(name,context))return;
    if(std::string(name)=="Createtemplate"){nativeBuild.createTemplate(resources(),context,true);return;}
    if(std::string(name)=="Buildproject"){nativeBuild.request();return;}
    if(std::string(name)=="Sendpulse"){
      try{if(pulses.size()>=256){++localPulseOverflows;throw std::runtime_error("Pulse queue full (256); event rejected");}pulses.push_back(capturePulseName(context));}
      catch(const std::exception& e){error=e.what();}
    }else if(std::string(name)=="Reload"||std::string(name)=="Reset"){try{activation.request(std::string(name)=="Reload");}catch(const std::exception& e){error=e.what();}}
  }
  void getWarningString(OP_String* value,void*)override{auto buildWarning=nativeBuild.warning();if(buildWarning.empty())buildWarning=selectionError;value->setString(buildWarning.empty()?warning.c_str():buildWarning.c_str());}
  void getErrorString(OP_String* value,void*)override{value->setString(error.c_str());}
  bool getInfoDATSize(OP_InfoDATSize* size,void*)override{return logging.size(size,context,5);}
  void getInfoDATEntries(int32_t index,int32_t,OP_InfoDATEntries* entries,void*)override{if(logging.row(index,entries,5))return;if(index>=3){entries->values[0]->setString(index==3?"reload_state":"source_identity");entries->values[1]->setString((index==3?activation.status():activation.identities()).c_str());return;}if(index==2){entries->values[0]->setString("execution");entries->values[1]->setString(diagnostics.blocking?"Blocking: waits for current inputs":"Buffered: latest complete output; pending inputs coalesce");return;}entries->values[0]->setString(index==0?"build_state":"build_diagnostics");entries->values[1]->setString(index==0?nativeBuild.status().c_str():nativeBuild.message().c_str());}
  int32_t getNumInfoCHOPChans(void*)override{return 27;}
  void getInfoCHOPChan(int32_t i,OP_InfoCHOPChan* channel,void*)override{
    const auto& d=diagnostics;
    const char* names[]={"cooks","cook_ms","input_copy_ms","script_ms","output_abs_frame","ready",
      "wait_for_current","worker_busy","submitted_request","accepted_request","completed_request","published_sequence","consumed_sequence","source_request",
      "publication_age_ms","input_age_ms","reused_cooks","same_request_results","coalesced_inputs","pulse_queue_depth","pulse_overflows","runtime_generation",
      "output_copy_ms","blocking_wait_ms","worker_ms","repeated_percent_120","schema_generation"};
    const double values[]={double(stats.cooks),cookMs,d.inputCopyMs+stats.inputMs,stats.drawMs,outputFrame,double(d.ready),
      double(d.blocking),double(d.busy),double(d.submitted),double(d.accepted),double(d.completed),double(d.published),double(d.consumed),double(d.sourceRequest),
      d.publicationAgeMs,d.inputAgeMs,double(d.reused),double(d.sameRequest),double(d.coalesced),double(d.pulseDepth+pulses.size()),double(d.pulseOverflows+localPulseOverflows),double(d.generation),
      d.outputCopyMs,d.waitMs,d.workerMs,d.repeatedPercent,double(d.schema)};
    if(i>=0&&i<27){channel->name->setString(names[i]);channel->value=float(values[i]);}
  }
};
}
extern "C" {
__attribute__((visibility("default"))) DLLEXPORT void FillCHOPPluginInfo(CHOP_PluginInfo* info){if(!info->setAPIVersion(CHOPCPlusPlusAPIVersion))return;info->customOPInfo.opType->setString("Avtoolschannels");info->customOPInfo.opLabel->setString("avTools Channels");info->customOPInfo.opIcon->setString("AVC");info->customOPInfo.authorName->setString("avTools");info->customOPInfo.minInputs=0;info->customOPInfo.maxInputs=4;info->customOPInfo.cookOnStart=true;}
__attribute__((visibility("default"))) DLLEXPORT CHOP_CPlusPlusBase* CreateCHOPInstance(const OP_NodeInfo* info){return new SketchCHOP(info);}
__attribute__((visibility("default"))) DLLEXPORT void DestroyCHOPInstance(CHOP_CPlusPlusBase* instance){delete static_cast<SketchCHOP*>(instance);}
}
