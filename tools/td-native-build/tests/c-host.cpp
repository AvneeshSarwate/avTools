#include "../include/avtools_build.h"
#include <chrono>
#include <thread>
#include <cstring>
#include <cstdio>
#include <string>
int main(int argc,char**argv){
 if(argc!=2)return 2;
 void* a=avb_subscribe(argv[1],"channels",1);void* b=avb_subscribe(argv[1],"background",1);
 if(!a||!b){fprintf(stderr,"subscription failed\n");return 3;}
 std::string copied;
 auto start=std::chrono::steady_clock::now();
 while(std::chrono::steady_clock::now()-start<std::chrono::seconds(60)){
  avb_poll(a);avb_poll(b);
  if(!strcmp(avb_status(a),"error")){fprintf(stderr,"%s\n",avb_message(a));return 4;}
  if(strlen(avb_source(a))&&strlen(avb_source(b))){copied=avb_source(a);break;}
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
 }
 avb_destroy(a);avb_destroy(b);
 if(copied.find("function onCook")==std::string::npos)return 5;
 printf("PASS C ABI: shared TOP/CHOP project, copied result survives service destruction (%zu bytes)\n",copied.size());
}
