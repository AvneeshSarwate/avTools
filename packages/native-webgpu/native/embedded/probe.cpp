#include "Runtime.h"
#include <fstream>
#include <iostream>
#include <chrono>
#include <thread>
int main(int argc,char**argv) {
  if(argc!=2) { std::cerr<<"Usage: embedded-probe script.js\n";return 2; }
  std::ifstream file(argv[1]);std::string source((std::istreambuf_iterator<char>(file)),{});
  for(int cycle=0;cycle<3;cycle++) {
    avtools::Runtime a,b;
    for(auto* r:{&a,&b}) if(!r->evaluate(source,10000)) {std::cerr<<r->error()<<"\n";return 1;}
    auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(20);
    while((a.value("done")!="true" || b.value("done")!="true") && std::chrono::steady_clock::now()<deadline) {
      for(auto* r:{&a,&b}) if(!r->pump(1000)) {std::cerr<<r->error()<<"\n";return 1;}
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    for(auto* r:{&a,&b}) {
      if(r->value("failure")!="undefined") {std::cerr<<r->value("failure")<<"\n";return 1;}
      if(r->value("done")!="true") {std::cerr<<"Embedding timeout\n";return 1;}
      r->pump(1000); r->collect();
      std::cout<<"Live binding metadata after GC: "<<r->metadataCount()<<"\n";
      if(r->evaluate("throw new Error('expected error')") || r->error().find("expected error")==std::string::npos) return 1;
      if(r->evaluate("while(true) {}",25) || r->error().find("budget")==std::string::npos) return 1;
      if(!r->evaluate("globalThis.recovered=true") || r->value("recovered")!="true") return 1;
    }
    std::cout<<"Two isolated instances passed cycle "<<cycle<<"\n";
  }
}
