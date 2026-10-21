#include "../../native/embedded/ChopExchange.h"
#include <atomic>
#include <thread>
#include <cassert>
#include <iostream>
int main(){
  {ChopExchange bounded;const char* names[]={"out"};AVChopFrame f{};f.source="x";f.reset=1;f.names=names;f.outputCount=1;f.rate=60;
   for(int i=0;i<16;i++){auto r=std::make_unique<ChopRequest>(f);bounded.offer(r);}
   bool rejected=false;try{auto r=std::make_unique<ChopRequest>(f);bounded.offer(r);}catch(const std::runtime_error&){rejected=true;}
   assert(rejected&&bounded.submitted==16&&bounded.controls.size()==16);
  }
  ChopExchange exchange;std::atomic<bool> done=false;
  std::thread worker([&]{while(!done||exchange.hasWork()){
    auto request=exchange.take();if(!request){std::this_thread::yield();continue;}
    exchange.spare->values.assign(20000,float(request->id));AVStats stats{};stats.ready=1;
    exchange.publish(*request,stats);exchange.finish(*request,true,"",0);
  }});
  const char* names[]={"x","y"};std::vector<float> output(20000);AVChopFrame f{};
  f.source="script";f.names=names;f.outputCount=2;f.outputSamples=10000;f.output=output.data();f.rate=60;
  AVStats stats{};AVChopDiagnostics d{};std::string error;
  for(int i=0;i<20000;i++){
    f.frame=f.absFrame=i;auto r=std::make_unique<ChopRequest>(f);auto id=exchange.offer(r);
    if(exchange.collect(output.data(),output.size(),id,false,stats,d,error))for(float v:output)assert(v==output[0]);
  }
  done=true;worker.join();assert(exchange.submitted==20000);std::cout<<"PASS 20k concurrent 10k XY exchanges; coherent snapshots and bounded queue\n";
}
