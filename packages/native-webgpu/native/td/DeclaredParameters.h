#pragma once
#include "TDParameters.h"
#include "../embedded/Bridge.h"
#include <chrono>
#include "SourceActivation.h"
#include <cmath>
#include <iomanip>
#include <locale>
#include <map>
#include <vector>

// Metadata/reinit runs on TD's callback thread. Per-frame reads use OP_Inputs
// directly; workers receive only owned JSON snapshots.
class DeclaredParameters {
  struct Parameter {std::string name,type,label,page;int count=0;};
  struct Handoff {SourceActivation activation;std::vector<std::string> pulses;};
  inline static std::map<uint32_t,Handoff> handoffs;
  TD::OP_Context* context;uint32_t id;std::string resources,checked,error;bool scheduled=false;
  std::vector<Parameter> parameters;
  std::string lastMidi,menuRows;AVSketch* lastMidiRuntime=nullptr;
  std::chrono::steady_clock::time_point menuChecked{};
  static std::string unhex(const std::string& value){std::string out;for(size_t i=0;i+1<value.size();i+=2)out+=char(std::stoi(value.substr(i,2),nullptr,16));return out;}
  static std::vector<std::string> split(const std::string& text,char delimiter){std::vector<std::string> out;size_t start=0;for(;;){auto end=text.find(delimiter,start);out.push_back(text.substr(start,end==std::string::npos?end:end-start));if(end==std::string::npos)break;start=end+1;}return out;}
  std::string call(const char* action,const std::string& payload="")const{
    const auto path=quote(resources+"/DeclaredParameters.py"),key=quote("_avtools_parameters_"+resources);
    // A module per immutable plugin bundle. Keep scheduled function objects alive.
    std::string loader="(lambda s,k,p: s.modules.get(k) or (lambda m: (exec(compile(open(p,encoding='utf-8').read(),p,'exec'),m.__dict__),s.modules.__setitem__(k,m),m)[2])(__import__('types').ModuleType(k)))(__import__('sys'),"+key+","+path+")";
    auto result=TDParameters(context).moduleCall(loader,"dispatch",action,payload);
    if(result.rfind("ERROR:",0)==0)throw std::runtime_error("Script parameters: "+result.substr(6));
    return result;
  }
 public:
  static std::string quote(const std::string& s){std::string out="\"";const char* hex="0123456789abcdef";for(unsigned char c:s){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){out+="\\u00";out+=hex[c>>4];out+=hex[c&15];}else out+=c;}return out+'"';}
  DeclaredParameters(TD::OP_Context* c,uint32_t opId,std::string r):context(c),id(opId),resources(std::move(r)){}
  void restore(SourceActivation& activation,std::vector<std::string>& pulses){auto it=handoffs.find(id);if(it!=handoffs.end()){activation=std::move(it->second.activation);pulses=std::move(it->second.pulses);handoffs.erase(it);}}
  void preserve(SourceActivation& activation,std::vector<std::string>& pulses)noexcept{
    if(!scheduled)return;
    try{if(call("rebuilding")=="1")handoffs.insert_or_assign(id,Handoff{std::move(activation),std::move(pulses)});}catch(...){}
  }
  const std::string& warning()const{return error;}
  bool pulse(const char* name)const{for(const auto& p:parameters)if(p.name==name&&p.type=="pulse")return true;return false;}
  // Returns false while deferred reinit is pending. Invalid metadata continues
  // the previously active source and reports a warning, without changing its UI.
  bool prepare(SourceActivation& activation,SourceActivation::Choice& choice){
    if(scheduled)return false;
    // A saved schema must survive startup while its source is unavailable.
    // Empty source is not an accepted script declaring an empty UI.
    if(choice.version.code.empty())return true;
    static const std::string prefix="// avtools-parameters-v1:";
    const auto& source=choice.version.code;
    auto metadata=source.rfind(prefix,0)==0?source.substr(prefix.size(),source.find('\n')-prefix.size()):"{}";
    if(metadata!=checked){
      checked=metadata;error.clear();
      try{if(metadata.size()>32768)throw std::runtime_error("Script parameters exceed 32 KiB");
        if(call("schedule",metadata)=="scheduled"){activation.pin(choice);scheduled=true;return false;}
      }catch(const std::exception& e){error=e.what();}
    }
    if(!error.empty()){activation.reject(choice);choice=activation.current();}
    return true;
  }
  void setup(TD::OP_ParameterManager* manager){
    parameters.clear();
    try{auto data=call("setup");if(data.empty())return;
      for(auto& line:split(data,'\n')){
        auto f=split(line,'\t');if(f.size()<14)throw std::runtime_error("Invalid stored parameter data");
        Parameter p{f[0],f[1],unhex(f[2]),unhex(f[3]),std::stoi(f[4])};
        TD::OP_ParAppendResult result=TD::OP_ParAppendResult::InvalidName;
        if(p.type=="string"||p.type=="menu"||p.type=="midiInput"){
          TD::OP_StringParameter s;s.name=p.name.c_str();s.label=p.label.c_str();s.page=p.page.c_str();auto value=unhex(f[12]);if(p.type=="midiInput"&&value.empty())value="__avtools_none__";s.defaultValue=value.c_str();
          if(p.type=="midiInput")result=manager->appendDynamicStringMenu(s);
          else if(p.type=="string")result=manager->appendString(s);
          else{int count=std::stoi(f[13]);std::vector<std::string> names,labels;std::vector<const char*> np,lp;
            for(int i=0;i<count;i++){names.push_back(unhex(f.at(14+i*2)));labels.push_back(unhex(f.at(15+i*2)));}
            for(int i=0;i<count;i++){np.push_back(names[i].c_str());lp.push_back(labels[i].c_str());}result=manager->appendMenu(s,count,np.data(),lp.data());}
        }else{
          TD::OP_NumericParameter n;n.name=p.name.c_str();n.label=p.label.c_str();n.page=p.page.c_str();
          for(int i=0;i<4;i++){n.defaultValues[i]=std::stod(f[5+i]);n.minValues[i]=n.minSliders[i]=std::stod(f[9]);n.maxValues[i]=n.maxSliders[i]=std::stod(f[10]);n.clampMins[i]=n.clampMaxes[i]=f[11]=="1";}
          if(p.type=="float")result=manager->appendFloat(n);else if(p.type=="int")result=manager->appendInt(n);else if(p.type=="toggle")result=manager->appendToggle(n);else if(p.type=="pulse")result=manager->appendPulse(n);else if(p.type=="rgb")result=manager->appendRGB(n);else if(p.type=="rgba")result=manager->appendRGBA(n);else if(p.type=="xy")result=manager->appendXY(n);else if(p.type=="xyz")result=manager->appendXYZ(n);
        }
        if(result!=TD::OP_ParAppendResult::Success)throw std::runtime_error("TD rejected script parameter "+p.name);
        parameters.push_back(std::move(p));
      }
    }catch(const std::exception& e){error=e.what();}
  }
  void midi(AVSketch* runtime,const TD::OP_Inputs* inputs){
    if(!runtime)return;
    std::string json="{";bool first=true;
    for(const auto& p:parameters)if(p.type=="midiInput"){
      if(!first)json+=',';first=false;const char* value=inputs->getParString(p.name.c_str());json+=quote(p.name)+":"+quote(value&&std::string(value)!="__avtools_none__"?value:"");
    }
    json+='}';if(json!=lastMidi||runtime!=lastMidiRuntime){avMidiSelections(runtime,json.c_str());lastMidi=json;lastMidiRuntime=runtime;}
  }
  void menu(TD::OP_BuildDynamicMenuInfo* info){
    bool match=false;for(const auto& p:parameters)if(p.type=="midiInput"&&p.name==info->name)match=true;if(!match)return;
    // TD rejects an empty menu entry name (and drops the entire menu).
    // Keep the internal sentinel out of the script-facing parameter snapshot.
    info->addMenuEntry("__avtools_none__","None");
    try{
      auto now=std::chrono::steady_clock::now();
      if(now-menuChecked>std::chrono::seconds(1)){
        std::string json;for(int retry=0;retry<3;retry++){auto size=avMidiInputs(nullptr,0);json.resize(size);auto written=avMidiInputs(json.data(),size);if(written<=size){json.resize(written);break;}}
        menuRows=call("midi_menu",json);menuChecked=now;
      }
      for(const auto& line:split(menuRows,'\n')){auto row=split(line,'\t');if(row.size()==2){auto id=unhex(row[0]),label=unhex(row[1]);info->addMenuEntry(id.c_str(),label.c_str());}}
    }catch(const std::exception& e){error=e.what();}
  }
  std::string snapshot(const TD::OP_Inputs* inputs)const{
    if(parameters.empty())return "{}";
    std::ostringstream json;json.imbue(std::locale::classic());json.precision(17);json<<'{';bool first=true;
    for(const auto& p:parameters){if(p.type=="pulse")continue;if(!first)json<<',';first=false;json<<quote(p.name)<<':';
      if(p.type=="string"||p.type=="menu"||p.type=="midiInput"){const char* value=inputs->getParString(p.name.c_str());json<<quote(value&&!(p.type=="midiInput"&&std::string(value)=="__avtools_none__")?value:"");}
      else if(p.type=="toggle")json<<(inputs->getParInt(p.name.c_str())?"true":"false");
      else{double values[4]{};
        if(p.type=="rgb")inputs->getParRGB(p.name.c_str(),values[0],values[1],values[2]);
        else if(p.type=="rgba")inputs->getParRGBA(p.name.c_str(),values[0],values[1],values[2],values[3]);
        else for(int i=0;i<p.count;i++)values[i]=inputs->getParDouble(p.name.c_str(),i);
        if(p.count>1)json<<'[';for(int i=0;i<p.count;i++){if(i)json<<',';json<<(std::isfinite(values[i])?values[i]:0);}if(p.count>1)json<<']';}
    }json<<'}';return json.str();
  }
};
