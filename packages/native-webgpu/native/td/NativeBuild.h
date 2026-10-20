#pragma once
#include <dlfcn.h>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

// Both plugin binaries load the SAME canonical dylib. Its Rust globals own one
// shared service; sketch V8 state remains per operator. Pin library code for the
// process because third-party Rayon pools have process lifetime. The last project
// subscription still joins the build service and closes all project watchers.
class NativeBuild {
  struct API {
    void* library=nullptr;
    void* (*subscribe)(const char*,const char*,int)=nullptr;
    int (*poll)(void*)=nullptr;
    const char* (*source)(const void*)=nullptr;
    const char* (*status)(const void*)=nullptr;
    const char* (*message)(const void*)=nullptr;
    void (*request)(const void*)=nullptr;
    void (*destroy)(void*)=nullptr;
    void* (*file_create)(const char*)=nullptr;
    int (*file_poll)(void*)=nullptr;
    const char* (*file_source)(const void*)=nullptr;
    const char* (*file_error)(const void*)=nullptr;
    void (*file_destroy)(void*)=nullptr;
    explicit API(const std::string& resources){
      std::ifstream marker(std::filesystem::path(resources)/"native-build.txt");std::string relative;std::getline(marker,relative);
      if(relative.empty())throw std::runtime_error("Native build service is not packaged with this plugin");
      auto path=std::filesystem::canonical(std::filesystem::path(resources)/relative);
      library=dlopen(path.c_str(),RTLD_NOW|RTLD_LOCAL|RTLD_NODELETE);
      if(!library)throw std::runtime_error(dlerror());
#define LOAD(name) name=reinterpret_cast<decltype(name)>(dlsym(library,"avb_" #name));if(!name)throw std::runtime_error("Missing native build ABI: " #name)
      LOAD(subscribe);LOAD(poll);LOAD(source);LOAD(status);LOAD(message);LOAD(request);LOAD(destroy);LOAD(file_create);LOAD(file_poll);LOAD(file_source);LOAD(file_error);LOAD(file_destroy);
#undef LOAD
    }
  };
  API* api=nullptr;void* subscription=nullptr;void* fileWatch=nullptr;std::string fileKey,fileCode,fileError;std::string key,code,state,detail;
 public:
  ~NativeBuild(){clear();clearFile();}
  void clearFile(){if(fileWatch)api->file_destroy(fileWatch);fileWatch=nullptr;fileKey.clear();fileCode.clear();fileError.clear();}
  void clear(){if(subscription)api->destroy(subscription);subscription=nullptr;key.clear();code.clear();state.clear();detail.clear();}
  std::string read(const std::string& resources,const char* project,const char* entry,bool automatic){
    clearFile();
    const auto path=std::filesystem::absolute(project).lexically_normal().string();
    const std::string next=path+"\n"+(entry?entry:"")+"\n"+(automatic?"1":"0");
    if(key!=next){clear();if(!api){static API shared(resources);api=&shared;}subscription=api->subscribe(path.c_str(),entry?entry:"",automatic);if(!subscription)throw std::runtime_error("Cannot subscribe to Project Directory; check the directory and filesystem access");key=next;}
    if(api->poll(subscription)){code=api->source(subscription);state=api->status(subscription);detail=api->message(subscription);}
    return code;
  }
  void request(){if(subscription)api->request(subscription);}
  const std::string& status()const{return state;}
  const std::string& message()const{return detail;}
  std::string warning()const{return !fileError.empty()?fileError:state=="error"?detail:"";}
  std::string readFile(const std::string& resources,const char* path){
    clear();const auto next=std::filesystem::absolute(path).lexically_normal().string();
    if(next!=fileKey){clearFile();if(!api){static API shared(resources);api=&shared;}fileWatch=api->file_create(next.c_str());if(!fileWatch)throw std::runtime_error("Cannot watch Source File directory");fileKey=next;}
    if(api->file_poll(fileWatch)){fileCode=api->file_source(fileWatch);fileError=api->file_error(fileWatch);}
    return fileCode;
  }
  template<class Manager> static void parameters(Manager* manager){
    TD::OP_StringParameter p;p.page="Build";p.name="Projectdir";p.label="Project Directory";manager->appendFolder(p);
    p.name="Entry";p.label="Entry";p.defaultValue="";manager->appendString(p);
    TD::OP_NumericParameter n;n.page="Build";n.name="Autobuild";n.label="Automatic Builds";n.defaultValues[0]=1;manager->appendToggle(n);
    n.name="Buildproject";n.label="Build Project";n.defaultValues[0]=0;manager->appendPulse(n);
  }
};
