// Reuse the isolated CoreMIDI send helpers; no physical devices are touched.
#define main integration_main
#include "bridge.cpp"
#undef main
#include <algorithm>
#include <vector>
static double cpu(){rusage r{};getrusage(RUSAGE_SELF,&r);return r.ru_utime.tv_sec+r.ru_utime.tv_usec/1e6+r.ru_stime.tv_sec+r.ru_stime.tv_usec/1e6;}
int main(int argc,char** argv){try{
 check(argc==3,"benchmark runtime resources");auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,"dlopen");
 auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");auto selection=(decltype(&avMidiSelections))dlsym(lib,"avMidiSelections");
 MIDIClientRef client;MIDIEndpointRef source;check(!MIDIClientCreate(CFSTR("avTools MIDI timing"),nullptr,nullptr,&client),"MIDI client");check(!MIDISourceCreate(client,CFSTR("avTools isolated benchmark"),&source),"MIDI source");
 const auto selected="{\"Controller\":\""+portId(source)+"\"}";
 for(bool raw:{true,false})for(int count:{1,4}){
  std::string code=std::string("function setup(h){let n=0;h.midi.bindInput('Controller',{rawCC:")+(raw?"true":"false")+"}).on('cc',()=>h.outputs.set('count',++n));}";
  AVSketch* sketches[4]{};float out[4]{};const char* names[]={"count"};char error[8192]{};AVStats stats{};AVChopDiagnostics diag{};
  for(int i=0;i<count;i++){sketches[i]=create(argv[2],error,sizeof(error));check(sketches[i],error);selection(sketches[i],selected.c_str());AVChopFrame f{};f.source=code.c_str();f.names=names;f.outputCount=1;f.output=&out[i];f.rate=60;f.parametersJSON=selected.c_str();check(cook(sketches[i],&f,&stats,error,sizeof(error)),error);}
  auto start=steady_clock::now();double c=cpu();pause(3000);double idle=(cpu()-c)/duration<double>(steady_clock::now()-start).count()*100;
  start=steady_clock::now();c=cpu();auto next=start;
  for(int i=0;i<3000;i++){send(source,i);next+=milliseconds(1);std::this_thread::sleep_until(next);}pause(30);
  double active=(cpu()-c)/duration<double>(steady_clock::now()-start).count()*100;
  for(int i=0;i<count;i++){collect(sketches[i],&out[i],1,&stats,&diag,error,sizeof(error));check(raw?out[i]==3000:(out[i]>100&&out[i]<3000),"active benchmark delivery");}
  std::vector<double> latencies;
  for(int n=0;n<50;n++){
   float wanted[4];for(int i=0;i<count;i++)wanted[i]=out[i]+1;start=steady_clock::now();send(source,n);
   for(;;){bool ready=true;for(int i=0;i<count;i++){collect(sketches[i],&out[i],1,&stats,&diag,error,sizeof(error));ready=ready&&out[i]>=wanted[i];}if(ready)break;check(steady_clock::now()-start<seconds(1),"latency timeout");std::this_thread::sleep_for(microseconds(100));}
   latencies.push_back(duration<double,std::milli>(steady_clock::now()-start).count());pause(8);
  }
  std::sort(latencies.begin(),latencies.end());std::cout<<"instances="<<count<<" raw_cc="<<raw<<" idle_cpu_percent="<<idle<<" active_1khz_cpu_percent="<<active<<" all_instances_latency_median_ms="<<latencies[25]<<" p95_ms="<<latencies[47]<<" delivered_per_instance="<<out[0]<<"\n";
  for(int i=0;i<count;i++)destroy(sketches[i]);
 }
 MIDIEndpointDispose(source);MIDIClientDispose(client);return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}}
