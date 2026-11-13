#include "Runtime.h"
#include <fstream>
#include <iostream>
#include <chrono>
#include <thread>
#include <algorithm>
int main(int argc,char**argv) {
  if(argc!=2) { std::cerr<<"Usage: embedded-probe script.js\n";return 2; }
  std::ifstream file(argv[1]);std::string source((std::istreambuf_iterator<char>(file)),{});
  // A foreground post from another thread must wake a sleeping owner promptly.
  {
    auto wake=std::make_shared<avtools::Wake>();
    auto runner=std::make_shared<avtools::Foreground>(wake);
    struct Task final:v8::Task { bool& ran;explicit Task(bool& value):ran(value){}void Run()override{ran=true;} };
    bool ran=false;
    std::thread producer([&]{std::this_thread::sleep_for(std::chrono::milliseconds(10));runner->PostTask(std::make_unique<Task>(ran));});
    auto start=avtools::Clock::now();wake->wait(start+std::chrono::seconds(1));producer.join();
    auto task=runner->take();if(!task)return 1;task->Run();
    if(!ran||avtools::Clock::now()-start>std::chrono::milliseconds(250))return 1;
    runner->close();
  }
  for(int cycle=0;cycle<1;cycle++) {
    auto wake=std::make_shared<avtools::Wake>();
    avtools::Runtime a(wake),b(wake);
    for(auto* r:{&a,&b}) if(!r->evaluate(source,10000)) {std::cerr<<r->error()<<"\n";return 1;}
    auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(120);
    while((a.value("done")!="true" || b.value("done")!="true") && std::chrono::steady_clock::now()<deadline) {
      for(auto* r:{&a,&b}) if(!r->pump(1000)) {std::cerr<<r->error()<<"\n";return 1;}
      if(a.value("done")!="true" || b.value("done")!="true")wake->wait(std::min({deadline,a.deadline(),b.deadline()}));
    }
    for(auto* r:{&a,&b}) {
      if(r->value("failure")!="undefined") {std::cerr<<r->value("failure")<<"\n";return 1;}
      if(r->value("done")!="true") {std::cerr<<"Embedding timeout\n";return 1;}
      r->pump(1000); r->collect();
      if(r->taskCount()!=0){std::cerr<<"Leaked host tasks: "<<r->taskCount()<<"\n";return 1;}
      // Repeated cancellation + full GC must not retain callback handles/closures.
      size_t firstHeap=0,lastHeap=0;
      for(int pass=0;pass<10;pass++){
        if(!r->evaluate("for(let n=0;n<10000;n++){const id=setTimeout(()=>{},60000);clearTimeout(id);}"))return 1;
        r->collect();if(r->taskCount())return 1;
        if(!r->evaluate("globalThis.probeHeap=__hostStats().heapUsed"))return 1;
        lastHeap=std::stoull(r->value("probeHeap"));if(!pass)firstHeap=lastHeap;
      }
      if(lastHeap>firstHeap+1024*1024){std::cerr<<"Retained heap grew after cancellation/GC\n";return 1;}
      std::cout<<"Cancellation GC heap first="<<firstHeap<<" last="<<lastHeap<<"\n";
      std::cout<<"Live binding metadata after GC: "<<r->metadataCount()<<"\n";
      if(r->evaluate("throw new Error('expected error')") || r->error().find("expected error")==std::string::npos) return 1;
      if(r->evaluate(r==&a?"while(true) {}":"queueMicrotask(function spin(){queueMicrotask(spin)})",25) || r->error().find("budget")==std::string::npos) return 1;
      if(r->evaluate("globalThis.recovered=true") || !r->poisoned()) return 1;
    }
    std::cout<<"Two isolated instances passed cycle "<<cycle<<"\n";
  }
}
