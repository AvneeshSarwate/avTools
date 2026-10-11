#include "TOP_CPlusPlusBase.h"
#include "../embedded/Bridge.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>
using namespace TD;
namespace {
std::string resources(){Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&resources),&info))throw std::runtime_error("Could not locate plugin resources");return (std::filesystem::path(info.dli_fname).parent_path().parent_path()/"Resources").string();}
class SketchTOP final:public TOP_CPlusPlusBase {
  TOP_Context* context;AVSketch* runtime=nullptr;AVStats stats{};std::string error;bool reset=true;double inputDownloadMs=0;uint32_t pendingPulses=0;bool syphonOnly=false;
 public:
  explicit SketchTOP(TOP_Context* c):context(c){}
  ~SketchTOP() override {avDestroy(runtime);}
  void getGeneralInfo(TOP_GeneralInfo* info,const OP_Inputs* inputs,void*)override{info->cookEveryFrameIfAsked=true;info->cookEveryFrame=inputs->getParInt("Syphonenabled")!=0;}
  void execute(TOP_Output* output,const OP_Inputs* inputs,void*)override{
    try {
      char detail[8192]{};
      if(!runtime){runtime=avCreate(resources().c_str(),detail,sizeof(detail));if(!runtime)throw std::runtime_error(detail);}
      std::string source;
      if(const auto* dat=inputs->getParDAT("Sketch")){if(dat->isTable)throw std::runtime_error("Sketch must reference a Text DAT");if(dat->numRows&&dat->numCols)source=dat->getCell(0,0);}
      else {const char* path=inputs->getParString("Sourcefile");if(path&&*path){std::ifstream file(path);if(!file)throw std::runtime_error("Cannot open source file");source.assign(std::istreambuf_iterator<char>(file),{});}}
      if(source.empty())throw std::runtime_error("Set Sketch to a JavaScript Text DAT or choose Source File");
      AVFrame frame{};frame.source=source.c_str();frame.width=std::clamp(inputs->getParInt("Width"),1,4096);frame.height=std::clamp(inputs->getParInt("Height"),1,4096);frame.reset=reset;reset=false;
      std::string syphonName=inputs->getParInt("Syphonenabled")?inputs->getParString("Syphonname"):"";frame.syphonName=syphonName.c_str();frame.syphonOnly=inputs->getParInt("Syphononly");syphonOnly=frame.syphonOnly;
      std::string eventName=inputs->getParString("Eventname");std::vector<const char*> pulses(pendingPulses,eventName.c_str());pendingPulses=0;frame.pulses=pulses.data();frame.pulseCount=static_cast<uint32_t>(pulses.size());
      const auto* time=inputs->getTimeInfo();frame.frame=time->frame;frame.rate=time->rate;frame.deltaSeconds=time->deltaMS/1000;frame.absFrame=time->absFrame;
      std::vector<AVChannel> channels;
      if(const auto* chop=inputs->getParCHOP("Controls")){frame.sampleRate=chop->sampleRate;frame.startIndex=chop->startIndex;for(int i=0;i<chop->numChannels;i++)channels.push_back({chop->getChannelName(i),chop->getChannelData(i),static_cast<uint32_t>(chop->numSamples)});}
      frame.channels=channels.data();frame.channelCount=static_cast<uint32_t>(channels.size());
      auto start=std::chrono::steady_clock::now();std::vector<OP_SmartRef<OP_TOPDownloadResult>> downloads;std::vector<AVImage> images;
      for(int i=0;i<inputs->getNumInputs();i++)if(const auto* top=inputs->getInputTOP(i)){
        OP_TOPInputDownloadOptions options;options.pixelFormat=OP_PixelFormat::RGBA8Fixed;options.verticalFlip=true;
        auto download=top->downloadTexture(options,nullptr);if(!download)throw std::runtime_error("TOP download failed");
        if(download->textureDesc.texDim!=OP_TexDim::e2D)throw std::runtime_error("Only 2D TOP inputs are supported");
        images.push_back({static_cast<const uint8_t*>(download->getData()),download->textureDesc.width,download->textureDesc.height,download->size});downloads.push_back(std::move(download));
      }
      inputDownloadMs=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
      frame.images=images.data();frame.imageCount=static_cast<uint32_t>(images.size());frame.outputSize=frame.syphonOnly?4:size_t(frame.width)*frame.height*4;
      auto buffer=context->createOutputBuffer(frame.outputSize,TOP_BufferFlags::None,nullptr);if(!buffer)throw std::runtime_error("Could not allocate TD output buffer");frame.output=static_cast<uint8_t*>(buffer->data);
      int ready=avCook(runtime,&frame,&stats,detail,sizeof(detail));error=detail;
      if(ready==2){std::memset(buffer->data,0,4);frame.width=frame.height=1;}
      if(ready){TOP_UploadInfo upload;upload.textureDesc.width=frame.width;upload.textureDesc.height=frame.height;upload.textureDesc.texDim=OP_TexDim::e2D;upload.textureDesc.pixelFormat=OP_PixelFormat::RGBA8Fixed;upload.firstPixel=TOP_FirstPixel::TopLeft;output->uploadBuffer(&buffer,upload,nullptr);}
    }catch(const std::exception& e){error=e.what();}
  }
  void setupParameters(OP_ParameterManager* manager,void*)override{
    OP_StringParameter source;source.name="Sketch";source.label="Sketch DAT";source.page="Sketch";manager->appendDAT(source);
    source.name="Sourcefile";source.label="Source File";manager->appendFile(source);
    source.name="Controls";source.label="Controls CHOP";manager->appendCHOP(source);
    for(const char* name:{"Width","Height"}){OP_NumericParameter p;p.name=name;p.label=name;p.page="Sketch";p.defaultValues[0]=512;p.minValues[0]=1;p.maxValues[0]=4096;p.minSliders[0]=1;p.maxSliders[0]=1920;p.clampMins[0]=p.clampMaxes[0]=true;manager->appendInt(p);}
    source.name="Eventname";source.label="Event Name";source.defaultValue="Trigger";manager->appendString(source);
    source.page="Output";source.name="Syphonname";source.label="Syphon Name";source.defaultValue="avTools Sketch";manager->appendString(source);
    for(const char* name:{"Syphonenabled","Syphononly"}){OP_NumericParameter p;p.name=name;p.label=!strcmp(name,"Syphonenabled")?"Enable Syphon":"Syphon Only (1px TOP)";p.page="Output";p.defaultValues[0]=0;manager->appendToggle(p);}
    for(const char* name:{"Reset","Reload","Sendpulse"}){OP_NumericParameter p;p.name=name;p.label=!strcmp(name,"Sendpulse")?"Send Pulse":name;p.page="Sketch";manager->appendPulse(p);}
  }
  void pulsePressed(const char* name,void*)override{if(!strcmp(name,"Reset")||!strcmp(name,"Reload"))reset=true;else if(!strcmp(name,"Sendpulse")){if(pendingPulses<256)pendingPulses++;else error="Pulse queue full (256); cook before sending more events";}}
  void getErrorString(OP_String* result,void*)override{result->setString(error.c_str());}
  int32_t getNumInfoCHOPChans(void*)override{return 10;}
  void getInfoCHOPChan(int32_t index,OP_InfoCHOPChan* channel,void*)override{
    const char* names[]={"cooks","ready","input_download_ms","input_upload_ms","draw_submit_ms","readback_wait_ms","runtime_ms","syphon_clients","syphon_published","syphon_dropped"};
    double values[]={double(stats.cooks),double(stats.ready),inputDownloadMs,stats.inputMs,stats.drawMs,stats.readbackMs,stats.totalMs,double(stats.syphonClients),double(stats.syphonPublished),double(stats.syphonDropped)};
    if(index>=0&&index<10){channel->name->setString(names[index]);channel->value=float(values[index]);}
  }
  bool getInfoDATSize(OP_InfoDATSize* size,void*)override{size->rows=4;size->cols=2;size->byColumn=false;return true;}
  void getInfoDATEntries(int32_t index,int32_t,OP_InfoDATEntries* entries,void*)override{
    std::string publication="clients="+std::to_string(stats.syphonClients)+" published="+std::to_string(stats.syphonPublished)+" dropped="+std::to_string(stats.syphonDropped);
    const char* keys[]={"transport","status","runtime","syphon"};const char* values[]={syphonOnly?"Syphon GPU output; 1px placeholder TOP; wired inputs use CPU":"RGBA8 CPU input/output; same cook",error.empty()?"ready":error.c_str(),"V8 + Dawn Metal + Rust text; one worker/isolate per TOP",publication.c_str()};
    if(index>=0&&index<4){entries->values[0]->setString(keys[index]);entries->values[1]->setString(values[index]);}
  }
};
}
extern "C" {
__attribute__((visibility("default"))) DLLEXPORT void FillTOPPluginInfo(TOP_PluginInfo* info){if(!info->setAPIVersion(TOPCPlusPlusAPIVersion))return;info->executeMode=TOP_ExecuteMode::CPUMem;info->customOPInfo.opType->setString("Avtoolssketch");info->customOPInfo.opLabel->setString("avTools Sketch");info->customOPInfo.opIcon->setString("AVS");info->customOPInfo.authorName->setString("avTools");info->customOPInfo.minInputs=0;info->customOPInfo.maxInputs=4;info->customOPInfo.cookOnStart=true;}
__attribute__((visibility("default"))) DLLEXPORT TOP_CPlusPlusBase* CreateTOPInstance(const OP_NodeInfo*,TOP_Context* context){return new SketchTOP(context);}
__attribute__((visibility("default"))) DLLEXPORT void DestroyTOPInstance(TOP_CPlusPlusBase* instance,TOP_Context*){delete instance;}
}
