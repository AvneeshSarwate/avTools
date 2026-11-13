#include <dlfcn.h>
#include <cstdio>
#include <thread>
#include <chrono>
#include <cstring>
// Regression: independently loaded compiler versions must not reserve the same address range.
int main(int argc,char**argv){if(argc!=4)return 2;void* previous=nullptr;for(int i=1;i<3;i++){
 auto lib=dlopen(argv[i],RTLD_NOW|RTLD_LOCAL|RTLD_NODELETE); if(!lib){puts(dlerror());return 2;}
 if(lib==previous){puts("Expected two independently loaded libraries");return 6;}previous=lib;
 auto sub=(void*(*)(const char*,const char*,int))dlsym(lib,"avb_subscribe");
 auto poll=(int(*)(void*))dlsym(lib,"avb_poll");
 auto status=(const char*(*)(void*))dlsym(lib,"avb_status");
 auto message=(const char*(*)(void*))dlsym(lib,"avb_message");
 auto destroy=(void(*)(void*))dlsym(lib,"avb_destroy");
 auto h=sub(argv[3],"channels",1);if(!h)return 3;bool ready=false;
 for(int j=0;j<1000;j++){poll(h);if(!strcmp(status(h),"ready")){printf("library %d ready\n",i);ready=true;break;}if(!strcmp(status(h),"error")){puts(message(h));return 4;}std::this_thread::sleep_for(std::chrono::milliseconds(10));}
 destroy(h);if(!ready)return 5;}
}
