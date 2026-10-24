#include "TOP_CPlusPlusBase.h"
#include "../embedded/Bridge.h"
#include "Logging.h"
#include "NativeBuild.h"
#include "SourceActivation.h"
#include "DeclaredParameters.h"
#include "PulseName.h"
#include <condition_variable>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef AVTOOLS_TOP_TRACE_PATH
#include <cstdio>
#endif
using namespace TD;
namespace {
using Clock=std::chrono::steady_clock;
double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
const std::string& resources(){static const std::string path=[](){Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&resources),&info))throw std::runtime_error("Could not locate plugin resources");return (std::filesystem::path(info.dli_fname).parent_path().parent_path()/"Resources").string();}();return path;}
class SketchTOP final:public TOP_CPlusPlusBase {
  struct Channel {std::string name;std::vector<float> samples;};
  struct Job {
    AVFrame frame{};std::string source,syphonName,eventName,error,parameterValues;
    std::vector<Channel> channels;std::vector<OP_SmartRef<OP_TOPDownloadResult>> downloads;
    std::vector<std::string> events;AVStats stats{};OP_SmartRef<TOP_Buffer> buffer;
    double inputDownloadMs=0,workerMs=0;int ready=0;
    int64_t startNs=0,endNs=0;
  };
  TOP_Context* context;AVSketch* runtime=nullptr;NativeBuild nativeBuild;Logging logging;SourceActivation activation;DeclaredParameters declared;std::string selectionError;
  // Only the short ownership exchanges take this lock. GPU waits and buffer
  // allocation happen on workers, never while holding it.
  std::mutex mutex;std::condition_variable completionCV;bool busy=false;std::unique_ptr<Job> pending,completed,fallback;
  AVStats stats{};std::string error;bool reset=true,syphonOnly=false,sameCook=false,pretrigger=false,triggerPending=false;
  double lastTriggerFrame=-1,submittedFrame=-1;int phase=0;int64_t cookStartNs=0;
  std::vector<std::string> pendingPulses;TD::OP_Context* opContext;uint64_t skipped=0;
  double blockingWaitMs=0,publicationAgeMs=-1;bool requestedWait=false;
  double inputDownloadMs=0,workerMs=0,cookMs=0,uploadMs=0,outputFrame=-1,currentFrame=0;
  int64_t workerStartNs=0,workerEndNs=0;

  void render(Job& job){
    const auto start=Clock::now();job.startNs=std::chrono::duration_cast<std::chrono::nanoseconds>(start.time_since_epoch()).count();
    try {
      auto& frame=job.frame;frame.source=job.source.c_str();frame.parametersJSON=job.parameterValues.c_str();frame.syphonName=job.syphonName.c_str();
      std::vector<const char*> pulses;for(auto& name:job.events)pulses.push_back(name.c_str());frame.pulses=pulses.data();frame.pulseCount=uint32_t(pulses.size());
      std::vector<AVChannel> channels;
      for(const auto& channel:job.channels)channels.push_back({channel.name.c_str(),channel.samples.data(),static_cast<uint32_t>(channel.samples.size())});
      frame.channels=channels.data();frame.channelCount=static_cast<uint32_t>(channels.size());
      std::vector<AVImage> images;
      for(auto& download:job.downloads)images.push_back({static_cast<const uint8_t*>(download->getData()),download->textureDesc.width,download->textureDesc.height,download->size});
      job.inputDownloadMs=elapsed(start);frame.images=images.data();frame.imageCount=static_cast<uint32_t>(images.size());
      frame.outputSize=frame.syphonOnly?4:size_t(frame.width)*frame.height*4;
      job.buffer=context->createOutputBuffer(frame.outputSize,TOP_BufferFlags::None,nullptr);
      if(!job.buffer)throw std::runtime_error("Could not allocate TD output buffer");
      frame.output=static_cast<uint8_t*>(job.buffer->data);
      char detail[8192]{};job.ready=avCook(runtime,&frame,&job.stats,detail,sizeof(detail));job.error=detail;
      if(job.ready==2){std::memset(job.buffer->data,0,4);frame.width=frame.height=1;}
    }catch(const std::exception& e){job.error=e.what();}
    // Release input textures on their consumer thread, before publishing completion.
    job.downloads.clear();job.workerMs=elapsed(start);
    job.endNs=std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count();
  }
  static void work(AVSketch*,void* user){
    auto& self=*static_cast<SketchTOP*>(user);std::unique_ptr<Job> job;
    {std::lock_guard lock(self.mutex);job=std::move(self.pending);}
    self.render(*job);
    {std::lock_guard lock(self.mutex);self.completed=std::move(job);self.busy=false;}self.completionCV.notify_one();
  }
  void publish(TOP_Output* output,Job& job){
    stats=job.stats;error=job.error;inputDownloadMs=job.inputDownloadMs;workerMs=job.workerMs;
    workerStartNs=job.startNs;workerEndNs=job.endNs;
    if(job.ready){
      TOP_UploadInfo upload;upload.textureDesc.width=job.frame.width;upload.textureDesc.height=job.frame.height;upload.textureDesc.texDim=OP_TexDim::e2D;upload.textureDesc.pixelFormat=OP_PixelFormat::RGBA8Fixed;upload.firstPixel=TOP_FirstPixel::TopLeft;
      auto start=Clock::now();output->uploadBuffer(&job.buffer,upload,nullptr);uploadMs=elapsed(start);outputFrame=job.frame.absFrame;
    }
  }
 public:
  explicit SketchTOP(TOP_Context* c,const OP_NodeInfo* info):context(c),declared(info->context,info->opId,resources()),opContext(info->context){declared.restore(activation,pendingPulses);}
  ~SketchTOP() override {declared.preserve(activation,pendingPulses);avDestroy(runtime);}
  void getGeneralInfo(TOP_GeneralInfo* info,const OP_Inputs* inputs,void*)override{info->cookEveryFrameIfAsked=true;info->cookEveryFrame=inputs->getParInt("Syphonenabled")!=0;}
  void execute(TOP_Output* output,const OP_Inputs* inputs,void*)override{
    logging.update(inputs);if(logging.takeRefresh())return;
    const auto cookStart=Clock::now();uploadMs=0;blockingWaitMs=0;currentFrame=inputs->getTimeInfo()->absFrame;
    cookStartNs=std::chrono::duration_cast<std::chrono::nanoseconds>(cookStart.time_since_epoch()).count();
    pretrigger=inputs->getParInt("Pretrigger")!=0;
    const bool submitOnly=pretrigger&&triggerPending;triggerPending=false;
    phase=pretrigger?(submitOnly?1:2):0;
    requestedWait=inputs->getParInt("Samecook")!=0;sameCook=!pretrigger&&requestedWait;
    inputs->enablePar("Samecook",!pretrigger);
    struct Finish {SketchTOP& self;Clock::time_point start;~Finish(){self.cookMs=elapsed(start);self.publicationAgeMs=self.workerEndNs?double(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count()-self.workerEndNs)/1e6:-1;
#ifdef AVTOOLS_TOP_TRACE_PATH
      if(FILE* file=fopen(AVTOOLS_TOP_TRACE_PATH,"a")){fprintf(file,"{\"phase\":%d,\"cookStartNs\":%lld,\"instance\":\"%p\",\"frame\":%.0f,\"outputFrame\":%.0f,\"cookMs\":%.6f,\"uploadMs\":%.6f,\"workerMs\":%.6f,\"inputDownloadMs\":%.6f,\"inputUploadMs\":%.6f,\"drawMs\":%.6f,\"readbackMs\":%.6f,\"workerStartNs\":%lld,\"workerEndNs\":%lld,\"skipped\":%llu,\"error\":%d}\n",self.phase,(long long)self.cookStartNs,(void*)&self,self.currentFrame,self.outputFrame,self.cookMs,self.uploadMs,self.workerMs,self.inputDownloadMs,self.stats.inputMs,self.stats.drawMs,self.stats.readbackMs,(long long)self.workerStartNs,(long long)self.workerEndNs,(unsigned long long)self.skipped,!self.error.empty());fclose(file);}
#endif
    }} finish{*this,cookStart};
    try {
      // Build controls must take effect even on a collection-only cook or while
      // the rendering worker is busy (including a parameter edit while paused).
      const char* typescript=inputs->getParString("Typescript");
      const char* project=inputs->getParString("Projectdir");std::string builtSource,identity;
      selectionError.clear();try{
      if(typescript&&*typescript){identity="ts:"+std::string(typescript);builtSource=nativeBuild.readTyped(resources(),typescript,"top",inputs->getParInt("Autobuild")!=0,opContext);}
      else if(project&&*project){identity="project:"+std::string(project)+":"+inputs->getParString("Entry");builtSource=nativeBuild.read(resources(),project,inputs->getParString("Entry"),inputs->getParInt("Autobuild")!=0);}
      else {
        nativeBuild.clear();
        if(const auto* dat=inputs->getParDAT("Sketch")){identity="dat:"+std::string(inputs->getParString("Sketch"));nativeBuild.clearFile();if(dat->isTable)throw std::runtime_error("Sketch must reference a Text DAT");if(dat->numRows&&dat->numCols)builtSource=dat->getCell(0,0);}
        else {const char* path=inputs->getParString("Sourcefile");if(path&&*path){identity="file:"+std::string(path);builtSource=nativeBuild.readFile(resources(),path);}}
      }
      }catch(const std::exception& e){selectionError=e.what();}
      activation.observe(identity,builtSource,inputs->getParInt("Autoreload")!=0);
      // A duplicated coordinator/pulse must not run draw or consume events twice.
      if(submitOnly){if(lastTriggerFrame==currentFrame)return;lastTriggerFrame=currentFrame;}
      std::unique_ptr<Job> ready;bool inFlight;
      {std::unique_lock lock(mutex);
        if(sameCook&&busy){auto waitStart=Clock::now();completionCV.wait(lock,[&]{return !busy;});blockingWaitMs=elapsed(waitStart);}
        ready=std::move(completed);inFlight=busy;}
      if(submitOnly){
        if(ready)fallback=std::move(ready);
      }else{
        // Keep an unpublished previous result available while the new job runs.
        if(!ready)ready=std::move(fallback);
        else {
          if(!ready->ready&&fallback&&fallback->ready)publish(output,*fallback);
          fallback.reset();
        }
        if(ready)publish(output,*ready);
        if(pretrigger)return; // Ordinary/collection cooks never submit in this mode.
      }
      // No pending frame queue: when late, retain TD's last output and take a
      // fresh snapshot at the next opportunity. Pulses/reset stay pending.
      if(inFlight){skipped++;return;}
      char detail[8192]{};
      if(!runtime){runtime=avCreateDeferred(resources().c_str(),detail,sizeof(detail));if(!runtime)throw std::runtime_error(detail);logging.attach(runtime);}
      auto job=std::make_unique<Job>();
      auto choice=activation.choose();if(!declared.prepare(activation,choice))return;job->parameterValues=declared.snapshot(inputs);job->source=choice.version.code;if(job->source.empty())return;reset=choice.restart;
      auto& frame=job->frame;frame.width=std::clamp(inputs->getParInt("Width"),1,4096);frame.height=std::clamp(inputs->getParInt("Height"),1,4096);frame.reset=reset;
      job->syphonName=inputs->getParInt("Syphonenabled")?inputs->getParString("Syphonname"):"";frame.syphonOnly=inputs->getParInt("Syphononly");syphonOnly=frame.syphonOnly;
      job->events=pendingPulses;
      const auto* time=inputs->getTimeInfo();frame.frame=time->frame;frame.rate=time->rate;frame.deltaSeconds=time->deltaMS/1000;frame.absFrame=time->absFrame;
      if(const auto* chop=inputs->getParCHOP("Controls")){frame.sampleRate=chop->sampleRate;frame.startIndex=chop->startIndex;for(int i=0;i<chop->numChannels;i++)job->channels.push_back({chop->getChannelName(i),std::vector<float>(chop->getChannelData(i),chop->getChannelData(i)+chop->numSamples)});}
      for(int i=0;i<inputs->getNumInputs();i++)if(const auto* top=inputs->getInputTOP(i)){
        OP_TOPInputDownloadOptions options;options.pixelFormat=OP_PixelFormat::RGBA8Fixed;options.verticalFlip=true;
        auto download=top->downloadTexture(options,nullptr);if(!download)throw std::runtime_error("TOP download failed");
        if(download->textureDesc.texDim!=OP_TexDim::e2D)throw std::runtime_error("Only 2D TOP inputs are supported");
        job->downloads.push_back(std::move(download));
      }
      if(sameCook){activation.accepted(choice);submittedFrame=currentFrame;reset=false;pendingPulses.clear();auto waitStart=Clock::now();render(*job);blockingWaitMs+=elapsed(waitStart);publish(output,*job);}
      else {
        {std::lock_guard lock(mutex);pending=std::move(job);busy=true;}
        if(!avDispatch(runtime,work,this)){std::lock_guard lock(mutex);pending.reset();busy=false;throw std::runtime_error("Could not dispatch sketch frame");}
        activation.accepted(choice);submittedFrame=currentFrame;reset=false;pendingPulses.clear();
        if(!pretrigger){std::unique_ptr<Job> fresh;{std::unique_lock lock(mutex,std::try_to_lock);if(lock.owns_lock())fresh=std::move(completed);}if(fresh)publish(output,*fresh);}
      }
    }catch(const std::exception& e){error=e.what();}
  }
  void setupParameters(OP_ParameterManager* manager,void*)override{
    NativeBuild::parameters(manager);Logging::parameters(manager);declared.setup(manager);
    OP_StringParameter source;source.name="Sketch";source.label="Sketch DAT";source.page="Sketch";manager->appendDAT(source);
    source.name="Sourcefile";source.label="Source File";manager->appendFile(source);
    source.name="Controls";source.label="Controls CHOP";manager->appendCHOP(source);
    for(const char* name:{"Width","Height"}){OP_NumericParameter p;p.name=name;p.label=name;p.page="Sketch";p.defaultValues[0]=512;p.minValues[0]=1;p.maxValues[0]=4096;p.minSliders[0]=1;p.maxSliders[0]=1920;p.clampMins[0]=p.clampMaxes[0]=true;manager->appendInt(p);}
    source.name="Eventname";source.label="Event Name";source.defaultValue="Trigger";manager->appendString(source);
    source.page="Output";source.name="Syphonname";source.label="Syphon Name";source.defaultValue="avTools Sketch";manager->appendString(source);
    for(const char* name:{"Syphonenabled","Syphononly"}){OP_NumericParameter p;p.name=name;p.label=!strcmp(name,"Syphonenabled")?"Enable Syphon":"Syphon Only (1px TOP)";p.page="Output";p.defaultValues[0]=0;manager->appendToggle(p);}
    {OP_NumericParameter p;p.name="Samecook";p.label="Wait for Current Result";p.page="Output";p.defaultValues[0]=0;manager->appendToggle(p);}
    {OP_NumericParameter p;p.name="Pretrigger";p.label="Pre-trigger Mode";p.page="Output";p.defaultValues[0]=0;manager->appendToggle(p);}
    {OP_NumericParameter p;p.name="Pretriggerpulse";p.label="Submit Early (Coordinator)";p.page="Output";manager->appendPulse(p);}
    for(const char* name:{"Reset","Reload","Sendpulse"}){OP_NumericParameter p;p.name=name;p.label=!strcmp(name,"Sendpulse")?"Send Pulse":name;p.page="Sketch";manager->appendPulse(p);}
  }
  void pulsePressed(const char* name,void*)override{if(logging.pulse(name,opContext))return;if(std::string(name)=="Createtemplate"){nativeBuild.createTemplate(resources(),opContext,false);return;}if(std::string(name)=="Buildproject"){nativeBuild.request();return;}if(!strcmp(name,"Pretriggerpulse")){triggerPending=true;return;}if(!strcmp(name,"Reset")||!strcmp(name,"Reload")){try{activation.request(!strcmp(name,"Reload"));}catch(const std::exception& e){error=e.what();}}else if(!strcmp(name,"Sendpulse")||declared.pulse(name)){try{if(pendingPulses.size()>=256)throw std::runtime_error("Pulse queue full (256); event rejected");pendingPulses.push_back(declared.pulse(name)?name:capturePulseName(opContext));}catch(const std::exception& e){error=e.what();}}}
  void getWarningString(OP_String* result,void*)override{auto buildWarning=nativeBuild.warning();if(buildWarning.empty())buildWarning=selectionError;if(buildWarning.empty())buildWarning=declared.warning();if(!buildWarning.empty()){result->setString(buildWarning.c_str());return;}result->setString(pretrigger&&lastTriggerFrame<currentFrame-1?"Pre-trigger Mode needs an active pretrigger Execute DAT; no recent submission received.":"");}
  void getErrorString(OP_String* result,void*)override{result->setString(error.c_str());}
  int32_t getNumInfoCHOPChans(void*)override{return 22;}
  void getInfoCHOPChan(int32_t index,OP_InfoCHOPChan* channel,void*)override{
    const char* names[]={"cooks","ready","input_download_ms","input_upload_ms","draw_submit_ms","readback_wait_ms","runtime_ms","syphon_clients","syphon_published","syphon_dropped","cook_ms","upload_enqueue_ms","output_age_frames","skipped_frames","worker_ms","pretrigger_enabled","submitted_frame","wait_for_current","effective_wait","worker_busy","blocking_wait_ms","publication_age_ms"};
    bool workerBusy;{std::lock_guard lock(mutex);workerBusy=busy;}
    double values[]={double(stats.cooks),double(stats.ready),inputDownloadMs,stats.inputMs,stats.drawMs,stats.readbackMs,stats.totalMs,double(stats.syphonClients),double(stats.syphonPublished),double(stats.syphonDropped),cookMs,uploadMs,outputFrame<0||currentFrame<outputFrame?-1:currentFrame-outputFrame,double(skipped),workerMs,double(pretrigger),submittedFrame,double(requestedWait),double(sameCook),double(workerBusy),blockingWaitMs,publicationAgeMs};
    if(index>=0&&index<22){channel->name->setString(names[index]);channel->value=float(values[index]);}
  }
  bool getInfoDATSize(OP_InfoDATSize* size,void*)override{return logging.size(size,opContext,8);}
  void getInfoDATEntries(int32_t index,int32_t,OP_InfoDATEntries* entries,void*)override{if(logging.row(index,entries,8))return;
    if(index>=6){entries->values[0]->setString(index==6?"reload_state":"source_identity");entries->values[1]->setString((index==6?activation.status():activation.identities()).c_str());return;}
    if(index==4||index==5){entries->values[0]->setString(index==4?"build_state":"build_diagnostics");entries->values[1]->setString(index==4?nativeBuild.status().c_str():nativeBuild.message().c_str());return;}
    std::string publication="clients="+std::to_string(stats.syphonClients)+" published="+std::to_string(stats.syphonPublished)+" dropped="+std::to_string(stats.syphonDropped);
    const char* keys[]={"transport","status","runtime","syphon"};const char* values[]={syphonOnly?"Syphon GPU output; 1px placeholder TOP; wired inputs use CPU":(pretrigger?"RGBA8 CPU output; pre-trigger submit/collect; nonblocking":sameCook?"RGBA8 CPU input/output; same cook (blocking)":"RGBA8 CPU input/output; buffered worker; normally one frame latency"),error.empty()?(outputFrame<0?"initializing":"ready"):error.c_str(),"V8 + Dawn Metal + Rust text; one worker/isolate per TOP",publication.c_str()};
    if(index>=0&&index<4){entries->values[0]->setString(keys[index]);entries->values[1]->setString(values[index]);}
  }
};
}
extern "C" {
__attribute__((visibility("default"))) DLLEXPORT void FillTOPPluginInfo(TOP_PluginInfo* info){if(!info->setAPIVersion(TOPCPlusPlusAPIVersion))return;info->executeMode=TOP_ExecuteMode::CPUMem;info->customOPInfo.opType->setString("Avtoolssketch");info->customOPInfo.opLabel->setString("avTools Sketch");info->customOPInfo.opIcon->setString("AVS");info->customOPInfo.authorName->setString("avTools");info->customOPInfo.minInputs=0;info->customOPInfo.maxInputs=4;info->customOPInfo.cookOnStart=true;}
__attribute__((visibility("default"))) DLLEXPORT TOP_CPlusPlusBase* CreateTOPInstance(const OP_NodeInfo* info,TOP_Context* context){return new SketchTOP(context,info);}
__attribute__((visibility("default"))) DLLEXPORT void DestroyTOPInstance(TOP_CPlusPlusBase* instance,TOP_Context*){delete instance;}
}
