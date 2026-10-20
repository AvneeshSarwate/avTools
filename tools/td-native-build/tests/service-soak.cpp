#include "../include/avtools_build.h"
#include <mach/mach.h>
#include <chrono>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <cstring>
int main(int argc,char**argv){
 if(argc!=3)return 2;int count=std::atoi(argv[2]);
 auto handle=avb_subscribe(argv[1],"channels",0);if(!handle)return 3;
 for(int i=0;i<count;i++){
  if(i)avb_request(handle);
  bool building=false,ready=false;auto start=std::chrono::steady_clock::now();
  while(std::chrono::steady_clock::now()-start<std::chrono::seconds(15)){
   avb_poll(handle);if(!std::strcmp(avb_status(handle),"building"))building=true;
   if(building&&!std::strcmp(avb_status(handle),"ready")){ready=true;break;}
   if(!std::strcmp(avb_status(handle),"error")){std::fprintf(stderr,"%s\n",avb_message(handle));return 4;}
   std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  if(!ready)return 5;
  task_vm_info_data_t info{};mach_msg_type_number_t size=TASK_VM_INFO_COUNT;
  if(task_info(mach_task_self(),TASK_VM_INFO,(task_info_t)&info,&size)!=KERN_SUCCESS)return 6;
  std::printf("{\"iteration\":%d,\"memory_bytes\":%llu,\"ms\":%.3f}\n",i,info.phys_footprint,std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count());
 }
 avb_destroy(handle);
}
