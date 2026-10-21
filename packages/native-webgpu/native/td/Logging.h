#pragma once
#include "../embedded/Bridge.h"
#include "TDParameters.h"
#include <memory>
#include <algorithm>
#include <string>
#include <cstring>

// TD owns one logger and one immutable read snapshot. SDK requests a size then
// rows on its callback thread; no runtime/storage lock spans those callbacks.
class Logging {
  AVLog* log_=avLogCreate();
  std::unique_ptr<AVLogSnapshot> snapshot_=std::make_unique<AVLogSnapshot>();
  bool logsView_=false,requestedLogsView_=false,refresh_=false;
 public:
  ~Logging(){avLogDestroy(log_);}
  void attach(AVSketch* runtime){avLogAttach(runtime,log_);}
  void update(const TD::OP_Inputs* inputs){avLogLevel(log_,inputs->getParInt("Loglevel"));requestedLogsView_=inputs->getParInt("Infoview")==1;}
  bool takeRefresh(){bool value=refresh_;refresh_=false;return value;}
  bool pulse(const char* name,TD::OP_Context* context){
    if(std::strcmp(name,"Clearlogs")&&std::strcmp(name,"Refreshlogs"))return false;
    if(!std::strcmp(name,"Clearlogs"))avLogClear(log_);
    // TD caches custom Info DAT data on the SOURCE, not the observer. Request a
    // metadata-only native cook. execute consumes this flag before touching JS,
    // exchange controls, frame submission, output collection, or build state.
    refresh_=true;try{TDParameters p(context);p.refreshMetadata();}catch(...){}
    return true;
  }
  static void parameters(TD::OP_ParameterManager* manager){
    TD::OP_StringParameter p;p.page="Diagnostics";p.name="Infoview";p.label="Info DAT View";p.defaultValue="diagnostics";
    const char* views[]={"diagnostics","logs"};const char* labels[]={"Diagnostics","Logs"};manager->appendMenu(p,2,views,labels);
    p.name="Loglevel";p.label="Log Level";p.defaultValue="info";
    const char* levels[]={"debug","info","warning","error","off"};const char* levelLabels[]={"Debug","Info","Warning","Error","Off"};manager->appendMenu(p,5,levels,levelLabels);
    TD::OP_NumericParameter clear;clear.page="Diagnostics";clear.name="Clearlogs";clear.label="Clear Logs";manager->appendPulse(clear);
    clear.name="Refreshlogs";clear.label="Refresh Logs (No Script)";manager->appendPulse(clear);
  }
  bool size(TD::OP_InfoDATSize* size,TD::OP_Context* context,int diagnosticRows){
    // TD controls are cached in execute, including metadata-only refresh.
    // No Python bridge, worker mutex, or message copies for Diagnostics view.
    logsView_=requestedLogsView_;
    if(logsView_)avLogRead(log_,snapshot_.get());else avLogStats(log_,snapshot_.get());
    size->rows=logsView_?int(snapshot_->count+1):diagnosticRows+4;size->cols=logsView_?5:2;size->byColumn=false;return true;
  }
  bool row(int index,TD::OP_InfoDATEntries* entries,int diagnosticRows){
    if(logsView_){
      if(index==0){const char* keys[]={"sequence","time_ms","generation","level","message"};for(int n=0;n<5;n++)entries->values[n]->setString(keys[n]);}
      else if(index>0&&uint32_t(index)<=snapshot_->count){const auto& e=snapshot_->entries[index-1];const char* levels[]={"debug","info","warning","error"};
        entries->values[0]->setString(std::to_string(e.sequence).c_str());entries->values[1]->setString(std::to_string(e.timeMs).c_str());entries->values[2]->setString(std::to_string(e.generation).c_str());entries->values[3]->setString(levels[std::clamp(e.level,0,3)]);entries->values[4]->setString(e.message);
      }return true;
    }
    if(index<diagnosticRows)return false;
    int n=index-diagnosticRows;if(n>=4)return true;
    const char* keys[]={"log_retained","log_evicted","log_dropped","log_truncated"};uint64_t values[]={snapshot_->count,snapshot_->evicted,snapshot_->dropped,snapshot_->truncated};
    entries->values[0]->setString(keys[n]);entries->values[1]->setString(std::to_string(values[n]).c_str());return true;
  }
};
