#pragma once
#include <dlfcn.h>
#include "TDParameters.h"
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

// Compiler is statically linked into each plugin executable.
#include "../../../../tools/td-native-build/include/avtools_build.h"
class NativeBuild {
  struct API {
    void* library=nullptr;
    void* (*subscribe)(const char*,const char*,int)=nullptr;
    void* (*subscribe_file)(const char*,const char*,int)=nullptr;
    int (*init)(const char*,char*,size_t)=nullptr;
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
      // Rayon owns process-lifetime threads: pin their code before the first call.
      Dl_info info{};
      if(!dladdr(reinterpret_cast<void*>(&avb_init),&info)||!info.dli_fname)throw std::runtime_error("Cannot locate embedded compiler");
      library=dlopen(info.dli_fname,RTLD_NOW|RTLD_LOCAL|RTLD_NODELETE);
      if(!library)throw std::runtime_error(dlerror());
#define LOAD(name) name=&avb_ ## name
      LOAD(subscribe);LOAD(subscribe_file);LOAD(init);LOAD(poll);LOAD(source);LOAD(status);LOAD(message);LOAD(request);LOAD(destroy);LOAD(file_create);LOAD(file_poll);LOAD(file_source);LOAD(file_error);LOAD(file_destroy);
#undef LOAD
    }
  };
  API* api=nullptr;void* subscription=nullptr;void* fileWatch=nullptr;std::string fileKey,fileCode,fileError;std::string key,code,state,detail,setupError;
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
  std::string readTyped(const std::string& resources,const char* file,const char* target,bool automatic,TD::OP_Context* context){
    clearFile();
    // Resolve via TD only when the parameter changes. Keep the subscription stable
    // while an editor temporarily removes a relative entry during atomic saves.
    const std::string next="typescript\n"+std::string(file)+"\n"+target+"\n"+(automatic?"1":"0");
    if(key!=next){TDParameters pars(context);const auto path=std::filesystem::absolute(pars.path("Typescript")).lexically_normal().string();clear();if(!api){static API shared(resources);api=&shared;}subscription=api->subscribe_file(path.c_str(),target,automatic);if(!subscription)throw std::runtime_error("Cannot build TypeScript File: choose a .ts file with an enclosing tsconfig.json (or create a template first)");key=next;}
    if(api->poll(subscription)){code=api->source(subscription);state=api->status(subscription);detail=api->message(subscription);}
    return code;
  }
  void createTemplate(const std::string& resources,TD::OP_Context* context,bool chop){
    try {
      TDParameters pars(context);const auto parent=pars.path("Templatedir");
      if(parent.empty())throw std::runtime_error("Choose a Template Parent Folder first");
      if(!api){static API shared(resources);api=&shared;}
      const auto directory=(std::filesystem::path(parent)/"avtools-project").string();
      // Reserve our child directory atomically, including against existing symlinks.
      // Never scaffold into the selected parent or merge with an existing project.
      if(!std::filesystem::create_directory(directory))throw std::runtime_error("Template would replace "+directory+"; choose another parent folder. Existing files were not changed.");
      char message[4096]{};if(!api->init(directory.c_str(),message,sizeof(message)))throw std::runtime_error(message);
      clear();setupError.clear();
      pars.set("Typescript",(std::filesystem::path(directory)/"sketches"/(chop?"channels":"background")/"main.ts").string());
      if(chop){pars.set("Outputchannels","value ticks");pars.set("Outputsamples",1);}
      else{pars.set("Width",1280);pars.set("Height",720);}
      pars.set("Autobuild",1);
      state="created";detail="Template created in "+directory+". Open this folder in your editor; saving rebuilds this entry.";
    }catch(const std::exception& e){setupError=e.what();}
  }
  void request(){setupError.clear();if(subscription)api->request(subscription);}
  const std::string& status()const{return state;}
  const std::string& message()const{return setupError.empty()?detail:setupError;}
  std::string warning()const{return !setupError.empty()?setupError:!fileError.empty()?fileError:state=="error"?detail:"";}
  std::string readFile(const std::string& resources,const char* path){
    clear();const auto next=std::filesystem::absolute(path).lexically_normal().string();
    if(next!=fileKey){clearFile();if(!api){static API shared(resources);api=&shared;}fileWatch=api->file_create(next.c_str());if(!fileWatch)throw std::runtime_error("Cannot watch Source File directory");fileKey=next;}
    if(api->file_poll(fileWatch)){fileCode=api->file_source(fileWatch);fileError=api->file_error(fileWatch);}
    return fileCode;
  }
  template<class Manager> static void parameters(Manager* manager){
    TD::OP_StringParameter p;p.page="Build";p.name="Typescript";p.label="TypeScript File";manager->appendFile(p);
    TD::OP_NumericParameter n;n.page="Build";n.name="Autobuild";n.label="Automatic Builds";n.defaultValues[0]=1;manager->appendToggle(n);
    n.name="Autoreload";n.label="Automatic Reload";manager->appendToggle(n);
    n.name="Buildproject";n.label="Build Script";n.defaultValues[0]=0;manager->appendPulse(n);
    p.name="Templatedir";p.label="Template Parent Folder";manager->appendFolder(p);
    n.name="Createtemplate";n.label="Create Template Project";manager->appendPulse(n);
    // Keep saved older projects readable; new projects need no manifest.
    p.page="Legacy Build";p.name="Projectdir";p.label="Project Directory";manager->appendFolder(p);
    p.name="Entry";p.label="Entry";p.defaultValue="";manager->appendString(p);
  }
};
